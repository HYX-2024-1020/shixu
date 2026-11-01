import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import { annotationPdfBytes } from "../server/reading/pdf-annotation-fixtures.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { sourceLocation } from "../shared/reading-view.mjs";
export async function runPdfAnnotationClients({directory,reader,archive=false}) {
  const pdf=annotationPdfBytes({pages:2}),body=archive?zipBytes({'annot.pdf':pdf}):pdf;
  return runClientLoop({directory,
    reader:reader || Object.assign((f,o)=>readMaterial(f,o),{pdfWindows:true,pdfVisualWindows:true,imageWindows:true,archiveWindows:true}),
    sourceByMini:true,startByMini:true,reviseAfterPublication:true,
    ...(archive?{deleteBeforeStart:true}:{originalQuota:1,expireBeforeStart:true}),
    original:{name:archive?'批注.zip':'批注.pdf',type:'application/octet-stream',body,tailSourceSuffix:'_vp2_i1',verify({win,mini}) {
      const a=win.readingCoverage[0];assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(mini.readingCoverage[0])));
      assert.equal(a.state,'read');assert.equal(a.uncovered.length,0);
      const notes=a.covered.filter(r=>r.annotation);
      assert.deepEqual(notes.map(r=>[r.page,r.annotation,r.annotationType]),[[1,1,'Stamp'],[2,1,'Stamp']]);
      assert.ok(notes.every(r=>JSON.stringify(r.annotationRect)==='[20,20,60,40]'));
      assert.deepEqual(a.covered.filter(r=>r.kind==='image').map(r=>r.page),[1,2]);
      assert.match(sourceLocation(win.readingCoverage,notes[1].sourceId),/PDF 第 2 页.*批注 1/);
      if(archive)assert.ok(notes.every(r=>r.archivePath==='annot.pdf'));
    }},
  });
}
