import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { sha256 } from "../server/reading/material.mjs";
const base = resolve(process.argv[2] || "");
if (process.platform !== "linux" || process.getuid() !== 0 || !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)) throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-zip-benchmark";
await mkdir(staging, { mode: 0o700 });
const read = createLinuxReader({ runtime: "/opt/shixu-bcd-test-20261028/runtime", staging });
const report = { synthetic: true, realProviderCalls: 0, node: process.version, repetitions: 5, samples: [] };
try {
  for (const sample of JSON.parse(await readFile(base + "/zip-samples.json", "utf8"))) {
    const file = { ...sample.file, body: Buffer.from(sample.file.body, "base64") };
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now(), output = await read(file);
      assert.equal(sha256(output.material.segments.map(s => s.text).join("")), sample.textHash);
      assert.deepEqual(output.material, sample.golden);
      runs.push({ elapsedMs: performance.now() - start, ...output.metrics });
    }
    const times = runs.map(r => r.elapsedMs).sort((a,b) => a-b);
    report.samples.push({ name: file.name, originalBytes: file.size, originalHash: file.hash,
      textHash: sample.textHash, state: sample.golden.state, covered: sample.golden.covered.length,
      uncovered: sample.golden.uncovered, p50Ms: times[2], p95Ms: times[4], runs });
  }
  await writeFile(base + "/zip-benchmark.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await rm(staging, { recursive: true, force: true }); }
