import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runClientLoop } from "./reading-client-loop.mjs";
import { readMaterial } from "../server/reading/material.mjs";
const observations = [];
for (const quota of [500 * 1024 * 1024, 1]) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const directory = await mkdtemp(
      join(tmpdir(), "shixu-original-benchmark-"),
    );
    const start = performance.now();
    try {
      const result = await runClientLoop({
        directory,
        reader: async (f) => readMaterial(f),
        originalQuota: quota,
        sourceByMini: true,
        verifyLifecycle: true,
      });
      samples.push({ elapsedMs: performance.now() - start, ...result });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const sorted = samples.map((s) => s.elapsedMs).sort((a, b) => a - b);
  observations.push({
    mode: quota === 1 ? "temporary" : "retained",
    repeats: 5,
    p50Ms: sorted[2],
    p95Ms: sorted[4],
    samples,
  });
}
const result = {
  synthetic: true,
  realProviderCalls: 0,
  node: process.version,
  platform: process.platform,
  reader: "in-process deterministic text reader, not Linux isolation",
  p95Method:
    "nearest rank; five independent synthetic account/profile fixtures per mode, P95=max",
  scope:
    "Page manifest/upload/commit, signed Windows download/task, stop/drain/continue with reupload for temporary, full tail/results/coverage equality, renew/download/delete, cleanup; includes fixed polling and synthetic provider waits",
  maxProcessRssKiB: process.resourceUsage().maxRSS,
  observations,
};
const output = JSON.stringify(result, null, 2) + "\n";
if (process.argv[2]) await writeFile(resolve(process.argv[2]), output);
else process.stdout.write(output);
