import assert from "node:assert/strict";
import { mkdir, chmod, writeFile, rm } from "node:fs/promises";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { pdfBytes } from "../server/reading/pdf-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
import { PDF_TEXT_UNITS } from "../server/reading/pdf.mjs";
const base = process.argv[2];
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-pdf-safety";
await mkdir(staging, { mode: 0o700 });
await chmod(staging, 0o700);
const read = createLinuxReader({
  runtime: "/opt/shixu-bcd-test-20261028/runtime",
  staging,
});
const body = pdfBytes(
  [
    ...Array.from({ length: 240 }, () => ({
      text: ("资源".repeat(50) + "\n").repeat(400),
    })),
    { text: "不可假称已读的尾页" },
  ],
  { compress: true },
);
const file = {
  id: "pdf",
  name: "resource.pdf",
  body,
  size: body.length,
  hash: sha256(body),
};
const started = performance.now();
let report;
try {
  const out = await read(file),
    m = out.material;
  assert.equal(m.state, "partial");
  assert.ok(
    m.uncovered.some(
      (r) => r.code === "PDF_RESOURCE_LIMIT" && r.pageEnd === 241,
    ),
  );
  assert.ok(m.covered.every((r) => r.page < 241));
  assert.ok(!m.segments.some((s) => s.text.includes("不可假称已读的尾页")));
  const pageText = ("资源".repeat(50) + "\n").repeat(400);
  const expectedPages = Math.floor(PDF_TEXT_UNITS / pageText.length);
  const expectedHash = sha256(pageText.repeat(expectedPages));
  assert.equal(sha256(m.segments.map(s => s.text).join("")), expectedHash);
  assert.deepEqual(m.covered.map(r => r.page), Array.from({length:expectedPages}, (_, i) => i + 1));
  assert.ok(m.covered.every((r,i) => r.start === i * pageText.length && r.end === (i+1) * pageText.length));
  report = {
    synthetic: true,
    realProviderCalls: 0,
    originalBytes: body.length,
    expandedResourceLimit: true,
    completePages: expectedPages,
    independentPrefixHash: expectedHash,
    fullPrefixAndCoordinatesChecked: true,
    unreadSuffix: m.uncovered.at(-1),
    elapsedMs: performance.now() - started,
    ...out.metrics,
  };
} catch (e) {
  if (!["READING_TIMEOUT", "ISOLATED_READING_FAILED"].includes(e.message))
    throw e;
  // A killed process produces no trusted page prefix. This is a separate
  // outer resource rejection, never evidence that the inner limit was reached.
  report = {
    synthetic: true,
    realProviderCalls: 0,
    originalBytes: body.length,
    expandedResourceLimit: false,
    outerResourceRejection: e.message,
    elapsedMs: performance.now() - started,
  };
} finally {
  await rm(staging, { recursive: true, force: true });
}
await writeFile(
  base + "/pdf-safety.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
