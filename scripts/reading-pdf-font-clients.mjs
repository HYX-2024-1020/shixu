import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import { fontPdfBytes } from "../server/reading/pdf-font-fixtures.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import { readMaterial } from "../server/reading/material.mjs";
export async function runPdfFontClients({directory,reader,archive=false}) {
  const pdf=fontPdfBytes({pages:2}),body=archive?zipBytes({'font.pdf':pdf}):pdf;
  return runClientLoop({
    directory,
    reader:reader || Object.assign((f,o)=>readMaterial(f,o),{pdfWindows:true,pdfVisualWindows:true,imageWindows:true,archiveWindows:true}),
    sourceByMini:true,startByMini:true,reviseAfterPublication:true,
    ...(archive?{deleteBeforeStart:true}:{originalQuota:1,expireBeforeStart:true}),
    original:{name:archive?'字体资源.zip':'字体资源.pdf',type:'application/octet-stream',body,tailSourceSuffix:'_vp2_i1',
      verify({win,mini}) {
        const a=win.readingCoverage[0];
        assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(mini.readingCoverage[0])));
        assert.equal(a.state,'read');
        const image=a.covered.find(r=>r.kind==='image');assert.ok(image);
        assert.deepEqual(a.covered.filter(r=>r.kind==='image').map(r=>r.page),[1,2]);
        assert.equal(image.page,1);assert.equal(image.tile,1);assert.equal(image.width,384);assert.equal(image.height,108);
        assert.ok(a.covered.some(r=>r.kind==='pdf'));
        assert.equal(a.uncovered.length,0);
        if(archive)assert.equal(image.archivePath,'font.pdf');
      },
    },
  });
}
