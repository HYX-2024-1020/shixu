import test from "node:test";
import assert from "node:assert/strict";
import { annotationPdfBytes } from "./pdf-annotation-fixtures.mjs";
import { readMaterial,sha256 } from "./material.mjs";
import { decodePng } from "./image.mjs";
import { ReadingWindows } from "./windows.mjs";
import { sourceLocation } from "../../shared/reading-view.mjs";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
const cursor={page:1,tile:1,offset:0};
const parse=body=>readMaterial({id:'annotation',name:'annotation.pdf',body,size:body.length,hash:sha256(body)},{pdfVisualWindow:cursor});
function expectedPixels(rotation,crop) {
  const bw=crop?150:192,bh=crop?90:120,w=rotation%180?bh:bw,h=rotation%180?bw:bh;
  const pixels=Buffer.alloc(w*h*4,255);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    let sx=x,sy=y;
    if(rotation===90){sx=y;sy=bh-1-x;}
    if(rotation===180){sx=bw-1-x;sy=bh-1-y;}
    if(rotation===270){sx=bw-1-y;sy=x;}
    const px=(sx+0.5)/1.5+(crop?10:0),py=(crop?70:80)-(sy+0.5)/1.5;
    const red=px>=20&&px<60&&py>=20&&py<40,i=(y*w+x)*4;
    pixels[i]=red?255:0;pixels[i+1]=0;pixels[i+2]=red?0:255;
  }
  return {width:w,height:h,pixels};
}
test('annotation appearances flatten into the actual page with exact independent pixels under rotation/CropBox and individual text sources',async()=>{
  for(const crop of [false,true])for(const rotation of [0,90,180,270]) {
    const m=await parse(annotationPdfBytes({crop,rotation}));
    assert.equal(m.state,'read',JSON.stringify(m.reasons));
    ReadingWindows.prototype.verifyPdfVisual(m,cursor);
    const text=m.segments.find(s=>!s.image),image=m.segments.find(s=>s.image);
    assert.equal(text.text,'批注内容：合成批注😀\n');
    assert.equal(text.range.annotation,1);assert.equal(text.range.annotationType,'Stamp');
    assert.deepEqual(text.range.annotationRect,[20,20,60,40]);
    assert.match(sourceLocation([m],text.sourceId),/PDF 第 1 页.*批注 1/);
    assert.match(sourceLocation([m],text.sourceId),/原页坐标\(20,20,60,40\)/);
    const expected=expectedPixels(rotation,crop),actual=decodePng(Buffer.from(image.image.data,'base64'));
    assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);assert.deepEqual(actual.pixels,expected.pixels);
  }
});
test('saved text/checkbox values have explicit field sources while their existing appearances are rendered',async()=>{
  for(const kind of ['text','checkbox']) {
    const m=await parse(annotationPdfBytes({kind}));assert.equal(m.state,'read');
    ReadingWindows.prototype.verifyPdfVisual(m,cursor);
    const text=m.segments.find(s=>!s.image);
    assert.match(text.text,kind==='text'?/Student\n保存值：Alice 42/:/Consent\n保存值：Yes/);
    assert.match(sourceLocation([m],text.sourceId),/表单字段 1/);
    assert.deepEqual(decodePng(Buffer.from(m.segments.find(s=>s.image).image.data,'base64')).pixels,expectedPixels(0,false).pixels);
  }
});
test('NeedAppearances text and choice fields use verified local font outlines and actual generated operators',async()=>{
  for(const kind of ['text','choice']) {
    const m=await parse(annotationPdfBytes({kind,appearance:false,needAppearances:true}));
    assert.equal(m.state,'read',kind+JSON.stringify(m.reasons));ReadingWindows.prototype.verifyPdfVisual(m,cursor);
    assert.match(m.segments[0].text,kind==='text'?/保存值：Alice 42/:/保存值：Blue/);
    const pixels=decodePng(Buffer.from(m.segments.find(s=>s.image).image.data,'base64')).pixels;
    let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]<200)ink++;
    assert.ok(ink>10,kind+' has no generated glyphs');
    if(kind==='choice')assert.match(m.segments[0].text,/可选值：Red\n可选值：Blue/);
    if(kind==='text') {
      const g=JSON.parse(await readFile(new URL('./fixtures/pdf-form-text-golden.json',import.meta.url)));
      assert.equal(g.pdfHash,sha256(annotationPdfBytes({kind,appearance:false,needAppearances:true})));
      const expected=inflateSync(Buffer.from(g.maskDeflateHex,'hex'),{maxOutputLength:g.width*g.height});
      const actual=Uint8Array.from(expected,(_,i)=>pixels[i*4+2]<200?1:0);
      const near=(mask,i)=>{const x=i%g.width,y=Math.floor(i/g.width);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<g.width&&y+dy>=0&&y+dy<g.height&&mask[(y+dy)*g.width+x+dx])return true;return false;};
      let count=0,hit=0,covered=0;
      for(let i=0;i<actual.length;i++){count+=expected[i];if(actual[i]&&near(expected,i))hit++;if(expected[i]&&near(actual,i))covered++;}
      assert.ok(hit/ink>=0.97&&covered/count>=0.97);
    }
  }
  const unsupported=await parse(annotationPdfBytes({kind:'text',appearance:false,needAppearances:true,fieldValue:'中文😀'}));
  assert.equal(unsupported.state,'partial');
  assert.ok(unsupported.reasons.includes('PDF_VISUAL_RENDER_WARNING'));
  assert.equal(unsupported.segments.some(s=>s.image),false);
});
test('unflattened links, missing/hidden appearance, signatures and masked password values keep an explicit unread range; URLs stay inert',async()=>{
  const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('UNEXPECTED_NETWORK');};
  try {
    for(const options of [{kind:'link'},{appearance:false},{flags:2},{kind:'signature'},{kind:'password'}]) {
      const m=await parse(annotationPdfBytes(options));assert.equal(m.state,'partial');
      assert.ok(m.reasons.includes('PDF_ANNOTATION_UNREAD'),JSON.stringify(m.reasons));
      assert.equal(m.uncovered.find(r=>r.code==='PDF_ANNOTATION_UNREAD').annotation,1);
      assert.ok(!JSON.stringify(m).includes('never-send-to-model'));
      ReadingWindows.prototype.verifyPdfVisual(m,cursor);
    }
  } finally {globalThis.fetch=oldFetch;}
});
test('long annotation Unicode crosses 120k source fragments without truncation or offset reset',async()=>{
  const contents='note😀'.repeat(30000),m=await parse(annotationPdfBytes({contents}));
  assert.equal(m.state,'read');ReadingWindows.prototype.verifyPdfVisual(m,cursor);
  const text=m.segments.filter(s=>!s.image);assert.equal(text.length,2);
  assert.equal(text.map(s=>s.text).join(''),'批注内容：'+contents+'\n');
  assert.equal([...text[0].text].length,120000);assert.equal(text[1].range.start,120000);
  assert.ok(text.every(s=>s.range.annotation===1));
});
test('bad appearance commands, duplicate annotation identities and annotation resource ceilings cannot certify page pixels',async()=>{
  for(const [options,code] of [[{broken:true},'PDF_VISUAL_RENDER_WARNING'],[{count:2},'PDF_ANNOTATION_INVALID'],[{count:1001},'PDF_ANNOTATION_LIMIT']]) {
    const m=await parse(annotationPdfBytes(options));assert.ok(m.reasons.includes(code),JSON.stringify(m.reasons));
    assert.equal(m.segments.some(s=>s.image),false);ReadingWindows.prototype.verifyPdfVisual(m,cursor);
  }
  const material=await parse(annotationPdfBytes());
  for(const mutate of [r=>r.annotation=0,r=>r.annotationType='Injected',r=>r.annotationRect=[0,0,Infinity,1],r=>r.annotationRect=[2,0,1,1]]) {
    const m=structuredClone(material);mutate(m.segments[0].range);m.covered[0]=structuredClone(m.segments[0].range);
    assert.throws(()=>ReadingWindows.prototype.verifyPdfVisual(m,cursor),/INVALID_READER_WINDOW/);
  }
});
