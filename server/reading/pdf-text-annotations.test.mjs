import test from "node:test";
import assert from "node:assert/strict";
import { annotationPdfBytes } from "./pdf-annotation-fixtures.mjs";
import { readMaterial,sha256 } from "./material.mjs";
import { ReadingWindows } from "./windows.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { sourceLocation } from "../../shared/reading-view.mjs";
const file=(body,name='annotations.pdf')=>({id:'annotations',name,body,size:body.length,hash:sha256(body)});
test('text-only PDF windows recover all annotation text, field values and choices with stable unique sources and explicit unrendered appearances',async()=>{
  const oldMap=Map.prototype.getOrInsertComputed;
  for(const kind of ['stamp','text','choice','checkbox']) {
    const f=file(annotationPdfBytes({kind,pages:9}));
    const full=await readMaterial(f),segments=[];let cursor={page:1,offset:0};
    while(cursor) {
      const m=await readMaterial(f,{pdfWindow:cursor});ReadingWindows.prototype.verify(m,cursor);
      assert.equal(m.state,'partial');assert.ok(m.reasons.includes('PDF_VISUAL_UNREAD'));
      assert.ok(m.reasons.includes('PDF_ANNOTATION_UNREAD'));assert.equal(m.segments.some(s=>s.image),false);
      segments.push(...m.segments);cursor=m.pagination.nextPage?{page:m.pagination.nextPage,offset:m.pagination.nextOffset}:null;
    }
    assert.deepEqual(segments,full.segments);
    assert.equal(segments.length,9);assert.equal(new Set(segments.map(s=>s.sourceId)).size,9);
    assert.deepEqual(segments.map(s=>s.range.page),[1,2,3,4,5,6,7,8,9]);
    assert.ok(segments.every(s=>s.range.annotation===1));assert.match(sourceLocation([full],segments.at(-1).sourceId),/第 9 页.*原页坐标/);
    if(kind==='text')assert.match(segments[0].text,/保存值：Alice 42/);
    if(kind==='choice')assert.match(segments[0].text,/保存值：Blue\n可选值：Red\n可选值：Blue/);
    if(kind==='checkbox')assert.match(segments[0].text,/保存值：Yes/);
  }
  assert.equal(Map.prototype.getOrInsertComputed,oldMap);
});
test('body and annotation sources on one page stay distinct and share the exact normalized text budget atomically',async()=>{
  const f=file(annotationPdfBytes({bodyText:'Body text'})),cursor={page:1,offset:0};
  const all=await readMaterial(f,{pdfWindow:cursor});
  assert.equal(all.segments.length,2);assert.equal(all.segments[0].text,'Body text\n');
  assert.equal(all.segments[0].range.annotation,undefined);assert.equal(all.segments[1].range.annotation,1);
  assert.equal(new Set(all.segments.map(s=>s.sourceId)).size,2);ReadingWindows.prototype.verify(all,cursor);
  const size=all.segments.reduce((n,s)=>n+s.text.length,0);
  const exact=await readMaterial(f,{pdfWindow:cursor,pdfTextUnits:size});assert.deepEqual(exact.segments,all.segments);
  const short=await readMaterial(f,{pdfWindow:cursor,pdfTextUnits:size-1});assert.equal(short.segments.length,0);
  assert.ok(short.reasons.includes('PDF_RESOURCE_LIMIT'));assert.equal(short.pagination.nextPage,1);
});
test('text-only annotation size boundaries commit no partial page, preserve full Unicode fragments, and do not disclose password values',async()=>{
  const contents='note😀'.repeat(30000),f=file(annotationPdfBytes({contents}));
  const all=await readMaterial(f,{pdfWindow:{page:1,offset:0}});
  assert.equal(all.segments.length,2);assert.equal(all.segments.map(s=>s.text).join(''),'批注内容：'+contents+'\n');
  ReadingWindows.prototype.verify(all,{page:1,offset:0});
  const limited=await readMaterial(f,{pdfWindow:{page:1,offset:0},pdfTextUnits:100});
  assert.equal(limited.segments.length,0);assert.equal(limited.pagination.nextPage,1);assert.equal(limited.pagination.nextOffset,0);
  assert.ok(limited.reasons.includes('PDF_RESOURCE_LIMIT'));
  const password=await readMaterial(file(annotationPdfBytes({kind:'password'})));
  assert.equal(password.segments.length,0);assert.ok(!JSON.stringify(password).includes('never-send-to-model'));
  for(const [count,reason] of [[2,'PDF_ANNOTATION_INVALID'],[1001,'PDF_ANNOTATION_LIMIT']]) {
    const m=await readMaterial(file(annotationPdfBytes({count})));assert.equal(m.segments.length,0);assert.ok(m.reasons.includes(reason));
  }
});
test('archived text-only annotations retain absolute offsets after an earlier member, then resume to the final member',async()=>{
  const body=zipBytes({'01.txt':Buffer.from('前言😀'),'02.pdf':annotationPdfBytes({pages:9}),'03.txt':Buffer.from('尾部唯一标记')}),f=file(body,'notes.zip');
  let cursor={...FIRST_ARCHIVE_WINDOW};const seen=[];
  while(cursor) {
    const m=await readMaterial(f,{archiveWindow:cursor});ReadingWindows.prototype.verify(m,undefined,cursor);
    seen.push(...m.segments);cursor=m.archivePagination.next;
  }
  assert.equal(seen[0].text,'前言😀');assert.equal(seen.at(-1).text,'尾部唯一标记');
  const notes=seen.filter(s=>s.range.annotation);assert.equal(notes.length,9);
  assert.equal(notes[0].range.start,3);assert.ok(notes.every(s=>s.range.archivePath==='02.pdf'));
  assert.equal(new Set(seen.map(s=>s.sourceId)).size,seen.length);
});
test('text window verification rejects forged source lengths, duplicate IDs, mismatched ranges and malformed annotation metadata',async()=>{
  const cursor={page:1,offset:0},m=await readMaterial(file(annotationPdfBytes({pages:2})),{pdfWindow:cursor});
  for(const mutate of [v=>v.segments[0].text+='x',v=>v.segments[0].range.annotation=0,v=>{v.segments[1].sourceId=v.segments[0].sourceId;v.segments[1].range.sourceId=v.segments[0].sourceId;v.covered[1].sourceId=v.segments[0].sourceId;},v=>{v.segments[0].range.annotationRect=[0,0,Infinity,1];v.covered[0]=structuredClone(v.segments[0].range);}]) {
    const changed=structuredClone(m);mutate(changed);assert.throws(()=>ReadingWindows.prototype.verify(changed,cursor),/INVALID_READER_WINDOW/);
  }
});
