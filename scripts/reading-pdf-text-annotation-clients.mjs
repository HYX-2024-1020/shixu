import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import { annotationPdfBytes } from "../server/reading/pdf-annotation-fixtures.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { sourceLocation } from "../shared/reading-view.mjs";
export async function runPdfAnnotationTextClients({directory,reader,archive=false}) {
  const pdf=annotationPdfBytes({pages:9,kind:"choice"}),body=archive?zipBytes({'annot.pdf':pdf}):pdf;
  return runClientLoop({directory,
    reader:reader || Object.assign((f,o)=>readMaterial(f,o),{pdfWindows:true,archiveWindows:true}),
    sourceByMini:true,startByMini:true,reviseAfterPublication:true,
    ...(archive?{deleteBeforeStart:true}:{originalQuota:1,expireBeforeStart:true}),
    original:{name:archive?'批注.zip':'批注.pdf',type:'application/octet-stream',body,tailSourceSuffix:'_p9_a1_0_m0',verify({win,mini}) {
      const a=win.readingCoverage[0];assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(mini.readingCoverage[0])));
      assert.equal(a.state,'partial');assert.ok(a.reasons.includes('PDF_ANNOTATION_UNREAD'));assert.ok(a.reasons.includes('PDF_VISUAL_UNREAD'));
      const notes=a.covered.filter(r=>r.annotation);
      assert.deepEqual(notes.map(r=>[r.page,r.annotation,r.annotationType]),Array.from({length:9},(_,i)=>[i+1,1,'Widget']));
      assert.ok(notes.every(r=>JSON.stringify(r.annotationRect)==='[20,20,60,40]'));
      assert.equal(a.covered.some(r=>r.kind==='image'),false);
      assert.match(sourceLocation(win.readingCoverage,notes.at(-1).sourceId),/PDF 第 9 页.*表单字段 1/);
      if(archive)assert.ok(notes.every(r=>r.archivePath==='annot.pdf'));
    }},
  });
}
