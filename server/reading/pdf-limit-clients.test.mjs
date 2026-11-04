import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { pdfLimitSample } from "./pdf-fixtures.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { readingView, sourceLocation } from "../../shared/reading-view.mjs";
test("PDF bounded complete-page prefix survives temporary cleanup, resume and dual-client publication with an explicit unread suffix", {timeout:30000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-pdf-limit-clients-"));
  const sample = pdfLimitSample();
  try {
    await runClientLoop({ directory, sourceByMini:true, originalQuota:1,
      reader: async f => {
        const material = await readMaterial(f, {pdfTextUnits:sample.textUnitLimit});
        assert.equal(sha256(material.segments.map(s => s.text).join("")), sha256(sample.expectedText));
        return material;
      },
      original: { ...sample, verify({win,mini,page}) {
        assert.deepEqual(win.readingCoverage, mini.readingCoverage);
        const c = win.readingCoverage[0];
        assert.equal(c.state, "partial");
        assert.equal(c.covered.at(-1).page, 4);
        assert.match(sourceLocation([c], c.covered.at(-1).sourceId), /第 4 页/);
        assert.match(readingView([c])[0].missing, /第 5–6 页.*安全资源限制/);
        assert.match(page._detail(win.itemIds[0]).reading[0].missing, /第 5–6 页/);
        assert.ok(!JSON.stringify(win.result).includes("不得假称已读的后缀"));
      } },
    });
  } finally { await rm(directory, {recursive:true,force:true}); }
});
