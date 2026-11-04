import assert from "node:assert/strict";
import { readFile, mkdir, chmod, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
const root = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(root)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-docx-benchmark";
await mkdir(staging, { mode: 0o700 });
await chmod(staging, 0o700);
try {
  const baseline = await import(
    pathToFileURL(join(root, "baseline/server/reading/linux-broker.mjs"))
  );
  const oldReader = baseline.createLinuxReader({
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const reader = createLinuxReader({
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const fixtures = JSON.parse(
    await readFile(join(root, "docx-benchmark-fixtures.json"), "utf8"),
  );
  const report = {
    synthetic: true,
    repetitions: 5,
    realProviderCalls: 0,
    samples: [],
  };
  for (const f of fixtures) {
    const body = Buffer.from(f.body, "base64"),
      file = {
        id: "a",
        name: f.name,
        body,
        size: body.length,
        hash: sha256(body),
      };
    const expected = readMaterial(file);
    assert.equal(
      sha256(expected.segments.map((s) => s.text).join("")),
      f.textHash,
    );
    assert.equal(expected.state, f.state);
    const variants = f.name.endsWith(".docx")
      ? [["docx", reader]]
      : [
          ["baseline", oldReader],
          ["current", reader],
        ];
    for (const [variant, read] of variants) {
      const outputs = [];
      for (let i = 0; i < 5; i++) {
        const r = await read(file);
        // Baseline only differs in reader-version metadata.
        assert.deepEqual(
          { ...r.material, readerVersion: expected.readerVersion },
          expected,
        );
        outputs.push(r);
      }
      const percentile = (values) =>
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
      report.samples.push({
        name: f.name,
        variant,
        bytes: body.length,
        state: expected.state,
        segments: expected.segments.length,
        exactTextAndRanges: true,
        isolatedP95Ms: percentile(outputs.map((r) => r.timing.isolatedMs)),
        parseP95Ms: percentile(outputs.map((r) => r.metrics.parseMs)),
        peakWorkerRssKiB: Math.max(...outputs.map((r) => r.metrics.maxRssKiB)),
      });
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
