import test from "node:test";
import assert from "node:assert/strict";
import { pdfBytes } from "./pdf-fixtures.mjs";
import {
  readMaterial,
  sha256,
  modelMaterial,
  coverageOnly,
} from "./material.mjs";
import { readingView, sourceLocation } from "../../shared/reading-view.mjs";
import { execFileSync } from "node:child_process";
const read = (body, options) =>
  readMaterial(
    {
      id: "pdf",
      name: "合成.pdf",
      body,
      size: body.length,
      hash: sha256(body),
    },
    options,
  );
test("PDF text resource limit drains queued chunks and exits normally with a complete-page prefix", async () => {
  // A child makes unhandled stream enqueue errors observable as a process exit.
  const source = `import {readMaterial,sha256} from './server/reading/material.mjs';
    import {pdfBytes} from './server/reading/pdf-fixtures.mjs';
    const body=pdfBytes([{text:'安全前页😀'},{text:('资源'.repeat(50)+'\\n').repeat(400)},{text:'不得标成已读的尾页'}],{compress:true});
    const result=await readMaterial({id:'pdf',name:'a.pdf',body,size:body.length,hash:sha256(body)},{pdfTextUnits:120});
    console.log(JSON.stringify({text:result.segments.map(s=>s.text).join(''),covered:result.covered.map(r=>r.page),unread:result.uncovered.at(-1),state:result.state}));`;
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 10000,
  }));
  assert.deepEqual(out, { text: "安全前页😀\n", covered: [1],
    unread: { kind: "pdf", page: 2, pageEnd: 3, code: "PDF_RESOURCE_LIMIT" }, state: "partial" });
});
test("PDF preserves complete Unicode, page order, rotation and honest missing visual ranges", async () => {
  const m = await read(
    pdfBytes([
      { text: "中文😀第一页\n第二行" },
      { text: "旋转页尾部", rotation: 90 },
      { text: "" },
    ]),
  );
  assert.equal(m.state, "partial");
  assert.equal(
    m.segments.map((s) => s.text).join(""),
    "中文😀第一页\n第二行\n旋转页尾部\n",
  );
  assert.deepEqual(
    m.covered.map((r) => [r.page, r.rotation]),
    [
      [1, 0],
      [2, 90],
    ],
  );
  assert.deepEqual(
    m.uncovered.map((r) => [r.page, r.code]),
    [
      [1, "PDF_VISUAL_UNREAD"],
      [2, "PDF_VISUAL_UNREAD"],
      [3, "PDF_NO_TEXT"],
    ],
  );
  assert.ok(!JSON.stringify(coverageOnly(m)).includes("中文"));
  assert.match(sourceLocation([m], m.covered[1].sourceId), /第 2 页/);
  assert.match(readingView([m])[0].missing, /第 3 页/);
});
test("PDF long text windows exhaust pages and preserve codepoint offsets and tail", async () => {
  const text = "长文😀".repeat(40000) + "唯一尾部";
  // Many short lines avoid clipping outside the media box.
  const pages = Array.from({ length: 40 }, (_, i) => ({
    text: text
      .slice(i * 4000, (i + 1) * 4000)
      .match(/.{1,100}/gu)
      .join("\n"),
  }));
  pages.push({ text: text.slice(160000) });
  const m = modelMaterial(
    await read(pdfBytes(pages, { compress: true }), { windowCodepoints: 700 }),
  );
  assert.equal(
    sha256(
      m.segments
        .map((s) => s.text)
        .join("")
        .replaceAll("\n", ""),
    ),
    sha256(text),
  );
  assert.ok(
    m.segments.every((s) => [...s.text].length === s.range.end - s.range.start),
  );
  assert.match(m.segments.at(-1).text, /唯一尾部/);
});
test("PDF corrupt page does not publish a prefix and following pages remain readable", async () => {
  const m = await read(
    pdfBytes([{ text: "前页" }, { broken: true }, { text: "后页尾部" }]),
  );
  assert.equal(m.segments.map((s) => s.text).join(""), "前页\n后页尾部\n");
  assert.ok(
    m.uncovered.some(
      (r) =>
        r.page === 2 && ["PDF_PAGE_FAILED", "PDF_NO_TEXT"].includes(r.code),
    ),
  );
  assert.equal((await read(Buffer.from("%PDF-broken"))).state, "failed");
  assert.equal(
    (await read(Buffer.from("not a PDF"))).reasons[0],
    "FORMAT_MISMATCH",
  );
});

test("PDF actions are inert and content order is not silently replaced with a visual table order", async () => {
  const m = await read(
    pdfBytes([{ text: "先画在右\n后画在左", reverse: true }], {
      catalog:
        "/OpenAction << /S /JavaScript /JS (globalThis.__shixuPdfExecuted = true) >> /AA << /WC << /S /URI /URI (https://example.invalid/) >> >>",
    }),
  );
  assert.equal(globalThis.__shixuPdfExecuted, undefined);
  assert.equal(m.segments.map((s) => s.text).join(""), "先画在右\n后画在左\n");
  assert.equal(m.state, "partial");
  assert.ok(m.reasons.includes("PDF_VISUAL_UNREAD"));
});
