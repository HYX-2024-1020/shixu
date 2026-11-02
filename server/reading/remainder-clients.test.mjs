import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
import { pdfWindowSample } from "./pdf-fixtures.mjs";

for (const startByMini of [false, true]) test(`${startByMini ? "mini" : "Windows"} explicitly completes remaining PDF pages without republishing edited accepted cards, including a lost response`, { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-remainder-clients-"));
  try {
    const report = await runClientLoop({ directory, sourceByMini: true, startByMini, partialRemainder: true,
      originalQuota: 1, original: pdfWindowSample(), reader: Object.assign(readMaterial, { pdfWindows: true }) });
    assert.equal(report.pdfPages, 19);
    assert.equal(report.rootCalls, 4);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
