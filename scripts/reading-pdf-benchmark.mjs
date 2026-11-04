import assert from "node:assert/strict";
import { mkdir, chmod, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
import { pdfSamples } from "./reading-pdf-samples.mjs";
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-pdf-benchmark";
await mkdir(staging, { mode: 0o700 });
await chmod(staging, 0o700);
const read = createLinuxReader({
  runtime: "/opt/shixu-bcd-test-20261028/runtime",
  staging,
});
const report = {
  synthetic: true,
  realProviderCalls: 0,
  node: process.version,
  repetitions: 5,
  samples: [],
};
try {
  for (const sample of pdfSamples) {
    const file = {
      id: "pdf",
      name: sample.name,
      body: sample.body,
      size: sample.body.length,
      hash: sha256(sample.body),
    };
    const golden = await readMaterial(file);
    assert.equal(
      sha256(golden.segments.map((s) => s.text).join("")),
      sample.textHash,
      "independent golden",
    );
    assert.equal(golden.state, sample.state);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now(),
        out = await read(file);
      assert.deepEqual(out.material, golden);
      runs.push({ elapsedMs: performance.now() - started, ...out.metrics });
    }
    const times = runs.map((r) => r.elapsedMs).sort((a, b) => a - b);
    report.samples.push({
      name: sample.name,
      originalBytes: file.size,
      originalHash: file.hash,
      textHash: sample.textHash,
      state: golden.state,
      pages: sample.pages?.length,
      covered: golden.covered.length,
      uncovered: golden.uncovered.length,
      p50Ms: times[2],
      p95Ms: times[4],
      runs,
    });
  }
  report.hostMaxRssKiB = process.resourceUsage().maxRSS;
  await writeFile(
    base + "/pdf-benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(staging, { recursive: true, force: true });
}
