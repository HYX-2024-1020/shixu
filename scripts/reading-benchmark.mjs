import assert from "node:assert/strict";
import { join, resolve, basename } from "node:path";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";

const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_LINUX_ROOT_REQUIRED");
const reader = createLinuxReader({
  runtime: join(base, "runtime"),
  staging: "/run/" + basename(base),
});
const samples = [
  ["small.txt", "会议😀通知\n".repeat(400)],
  ["medium.txt", "中文😀段落 abc\n".repeat(14000)],
  ["long.txt", "中文😀段落 abc\n".repeat(380000) + "不可遗漏的尾部"],
  ["table.csv", "名称,说明,空列\n" + '"甲,乙","多行\n说明",\n'.repeat(10000)],
  ["dense.csv", "\n".repeat(100000)],
  ["partial.csv", 'a,b\n1,2\n"broken'],
];
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const report = {
  synthetic: true,
  repetitions: 5,
  providerCalls: 0,
  samples: [],
};
for (const [name, text] of samples) {
  const body = Buffer.from(text),
    file = { id: "a", name, body, size: body.length, hash: sha256(body) };
  const expected = readMaterial(file),
    outputs = [];
  if (expected.state === "read") {
    assert.equal(
      expected.segments.map((s) => s.text).join(""),
      text.replace(/\r\n?/g, "\n"),
      "independent full-text golden",
    );
    let end = 0;
    for (const range of expected.covered) {
      assert.equal(range.start, end);
      end = range.end;
    }
    if (name === "table.csv")
      assert.equal(expected.covered.at(-1).rowEnd, 10001);
    if (name === "dense.csv")
      assert.equal(expected.covered.at(-1).rowEnd, 100000);
  } else {
    assert.equal(expected.segments.map((s) => s.text).join(""), "a,b\n1,2\n");
    assert.equal(expected.uncovered[0].start, 8);
  }
  for (let n = 0; n < 5; n++) {
    const actual = await reader(file);
    assert.deepEqual(actual.material, expected);
    outputs.push(actual);
  }
  const elapsed = outputs.reduce((n, r) => n + r.timing.isolatedMs, 0);
  report.samples.push({
    name,
    bytes: body.length,
    state: expected.state,
    segments: expected.segments.length,
    coveredCodepoints: expected.covered.reduce(
      (n, s) => n + s.end - s.start,
      0,
    ),
    exactMatch: true,
    transferP95Ms: percentile(
      outputs.map((r) => r.metrics.serializationAndTransferMs),
      0.95,
    ),
    inputTemporaryBytes: body.length,
    parserScratchBytes: 0,
    parseP50Ms: percentile(
      outputs.map((r) => r.metrics.parseMs),
      0.5,
    ),
    parseP95Ms: percentile(
      outputs.map((r) => r.metrics.parseMs),
      0.95,
    ),
    isolatedP50Ms: percentile(
      outputs.map((r) => r.timing.isolatedMs),
      0.5,
    ),
    isolatedP95Ms: percentile(
      outputs.map((r) => r.timing.isolatedMs),
      0.95,
    ),
    peakWorkerRssKiB: Math.max(...outputs.map((r) => r.metrics.maxRssKiB)),
    throughputMiBPerSecond: (body.length * 5) / 1024 ** 2 / (elapsed / 1000),
    legacyV3Eligible: body.length <= 400000 && text.length <= 60000,
  });
}
console.log(JSON.stringify(report, null, 2));
