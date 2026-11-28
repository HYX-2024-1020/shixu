import test from "node:test";
import assert from "node:assert/strict";
import { createPdfResources } from "./pdf-resources.mjs";
import { PDF_RESOURCE_CATALOG } from "./pdf-resource-catalog.mjs";
import { fontPdfBytes, BASE14_FONTS } from "./pdf-font-fixtures.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { decodePng } from "./image.mjs";
import { readFile, mkdtemp, copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const parse=(body,visual=true)=>readMaterial({id:"font",name:"font.pdf",body,size:body.length,hash:sha256(body)},visual?{pdfVisualWindow:{page:1,tile:1,offset:0}}:{});
test("fixed standard font and CMap resources load by exact names only, with bounded copies and no URL fallback", async () => {
  const policy=createPdfResources(),factory=new policy.BinaryDataFactory();
  assert.equal(Object.keys(PDF_RESOURCE_CATALOG.files).length,185);
  const font=await factory.fetch({kind:"standardFontDataUrl",filename:"FoxitSerif.pfb"});
  assert.equal(font.length,PDF_RESOURCE_CATALOG.files["standard_fonts/FoxitSerif.pfb"].bytes);
  font.fill(0);
  assert.notEqual(sha256(await factory.fetch({kind:"standardFontDataUrl",filename:"FoxitSerif.pfb"})),sha256(font));
  for(const [name,expected] of Object.entries(PDF_RESOURCE_CATALOG.files)) {
    if(name.includes('LICENSE'))continue;
    const [group,filename]=name.split('/');
    const data=await factory.fetch({kind:group==='cmaps'?'cMapUrl':'standardFontDataUrl',filename});
    assert.equal(data.length,expected.bytes);assert.equal(sha256(data),expected.sha256);
  }
  for(const request of [
    {kind:"standardFontDataUrl",filename:"../FoxitSerif.pfb"},
    {kind:"standardFontDataUrl",filename:"file:///etc/passwd"},
    {kind:"cMapUrl",filename:"https://example.invalid/a.bcmap"},
    {kind:"cMapUrl",filename:"unknown.bcmap"},
    {kind:"cMapUrl",filename:"FoxitSerif.pfb"},
    {kind:"wasmUrl",filename:"openjpeg.wasm"},
    {kind:"standardFontDataUrl",filename:"__proto__"},
  ]) await assert.rejects(factory.fetch(request),/PDF_RESOURCE_UNAVAILABLE/);
  assert.equal(policy.failed,true);
});
test("all 14 PDF standard fonts render real outlines without host font families", async () => {
  const golden=JSON.parse(await readFile(new URL('./fixtures/pdf-base14-golden.json',import.meta.url)));
  for(const baseFont of BASE14_FONTS) {
    const body=fontPdfBytes({baseFont}),m=await parse(body);
    assert.equal(m.state,"read",baseFont+JSON.stringify(m.reasons));
    const image=m.segments.find(s=>s.image);
    assert.ok(image,baseFont);
    const {pixels,width,height}=decodePng(Buffer.from(image.image.data,"base64"));
    assert.equal(width,384);assert.equal(height,108);
    let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<200)dark++;
    assert.ok(dark>100,baseFont+" empty glyphs");
    const g=golden.fonts[baseFont];
    assert.equal(sha256(body),g.pdfHash);
    if (!g.diagnosticOnly) {
      const expected=inflateSync(Buffer.from(g.maskDeflateHex,'hex'),{maxOutputLength:width*height});
      assert.equal(expected.length,width*height);
      const actual=Uint8Array.from({length:width*height},(_,i)=>pixels[i*4]<200?1:0);
      const dilate = mask => {
        const out=new Uint8Array(mask.length);
        for(let i=0;i<mask.length;i++)if(mask[i]) {
          const x=i%width,y=Math.floor(i/width);
          for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)
            if(x+dx>=0&&x+dx<width&&y+dy>=0&&y+dy<height)out[(y+dy)*width+x+dx]=1;
        }
        return out;
      };
      const a=dilate(actual),e=dilate(expected);let count=0,hit=0,covered=0;
      for(let i=0;i<actual.length;i++) {count+=expected[i];if(actual[i]&&e[i])hit++;if(expected[i]&&a[i])covered++;}
      assert.ok(hit/dark>=0.97&&covered/count>=0.97,`${baseFont}: independent 2px mask precision ${hit/dark}, recall ${covered/count}`);
      assert.ok(dark/count>0.85&&dark/count<1.2,baseFont+' glyph area');
    }
  }
  const {canvas}=await import('./pdf-canvas.mjs');
  assert.equal(canvas.GlobalFonts.families.length,0);
});
test("missing, oversized and same-size modified bundled resource data fail closed", async () => {
  const directory=await mkdtemp(join(tmpdir(),'shixu-pdf-resources-'));
  try {
    for(const name of ['pdf-resources.mjs','pdf-resource-catalog.mjs'])await copyFile(new URL(name,import.meta.url),join(directory,name));
    const {createPdfResources:local}=await import(pathToFileURL(join(directory,'pdf-resources.mjs')));
    const resource=join(directory,'generated-pdf-visual',process.platform+'-'+process.arch,'resources','standard_fonts');
    const request={kind:'standardFontDataUrl',filename:'FoxitSerif.pfb'};
    await assert.rejects(new (local().BinaryDataFactory)().fetch(request),/PDF_RESOURCE_UNAVAILABLE/);
    await mkdir(resource,{recursive:true});
    for(const size of [1,PDF_RESOURCE_CATALOG.files['standard_fonts/FoxitSerif.pfb'].bytes,1024*1024]) {
      await writeFile(join(resource,'FoxitSerif.pfb'),Buffer.alloc(size));
      await assert.rejects(new (local().BinaryDataFactory)().fetch(request),/PDF_RESOURCE_UNAVAILABLE/);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});
test("built-in Chinese CMaps recover exact Unicode without pretending missing CJK outlines are rendered", async () => {
  const body=fontPdfBytes({cmap:true}),text=await parse(body,false);
  assert.equal(text.segments.map(s=>s.text).join(""),"中文\n");
  const visual=await parse(body);
  assert.ok(visual.segments.some(s=>s.text.includes("中文")));
  assert.equal(visual.segments.some(s=>s.image),false);
  assert.ok(visual.reasons.includes("PDF_VISUAL_FONT_UNSUPPORTED"));
});
test("Zapf default-encoded pencil/nib/check glyphs preserve their Unicode meaning in text and visual sources", async () => {
  const body=fontPdfBytes({baseFont:"ZapfDingbats",text:"0123"});
  for(const visual of [false,true]) {
    const m=await parse(body,visual);
    assert.equal(m.segments.filter(s=>!s.image).map(s=>s.text).join(""),"✐✑✒✓\n");
  }
});
