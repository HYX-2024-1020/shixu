import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  nativeArchiveSample,
  rarBytes,
  sevenZipBytes,
} from "../server/reading/native-archive-fixtures.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
const base = resolve(process.argv[2] || "");
if (!base.includes("shixu-")) throw Error("SYNTHETIC_OUTPUT_REQUIRED");
const samples = [];
for (const format of ["rar", "7z"]) {
  const f = await nativeArchiveSample(format, { long: true });
  samples.push({ ...f, textHash: sha256(f.expectedText) });
}
samples.push({
  name: "拒绝.rar",
  body: rarBytes({ "safe.txt": "never", "bad\nname.txt": "no" }),
  expectedText: "",
  textHash: sha256(""),
});
samples.push({
  name: "压缩.7z",
  body: await sevenZipBytes(
    {
      "a.txt": Buffer.from(
        Array.from({ length: 3000 }, (_, i) => sha256("line" + i)).join("\n"),
      ),
    },
    ["-mx=1"],
  ),
  expectedText: Array.from({ length: 3000 }, (_, i) => sha256("line" + i)).join(
    "\n",
  ),
});
samples.at(-1).textHash = sha256(samples.at(-1).expectedText);
const report = { synthetic: true, realProviderCalls: 0, samples: [] };
let reader = async (file) => ({
    material: await readMaterial(file),
    metrics: {},
  }),
  staging;
if (process.platform === "linux") {
  if (process.getuid() !== 0 || !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base))
    throw Error("SYNTHETIC_ROOT_REQUIRED");
  const { createLinuxReader } = await import(
    "../server/reading/linux-broker.mjs"
  );
  staging = "/run/shixu-native-verification";
  await mkdir(staging, { mode: 0o700 });
  reader = createLinuxReader({
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
}
try {
  for (const s of samples) {
    const file = {
      id: "native",
      name: s.name,
      body: s.body,
      size: s.body.length,
      hash: sha256(s.body),
    };
    const baseline = await readMaterial(file);
    assert.equal(
      sha256(baseline.segments.map((s) => s.text).join("")),
      s.textHash,
    );
    const runs = [];
    for (
      let i = 0;
      i <
      (process.platform === "linux" &&
      !process.argv.includes("--once") &&
      s.name.startsWith("合成")
        ? 5
        : 1);
      i++
    ) {
      const start = performance.now(),
        r = await reader(file);
      assert.deepEqual(r.material, baseline);
      assert.equal(
        sha256(r.material.segments.map((s) => s.text).join("")),
        s.textHash,
      );
      runs.push({ elapsedMs: performance.now() - start, ...r.metrics });
    }
    const times = runs.map((r) => r.elapsedMs).sort((a, b) => a - b);
    report.samples.push({
      name: s.name,
      originalBytes: file.size,
      originalHash: file.hash,
      textHash: s.textHash,
      state: baseline.state,
      segments: baseline.segments.length,
      covered: baseline.covered,
      uncovered: baseline.uncovered,
      runs,
      ...(runs.length === 5 ? { p50Ms: times[2], p95Ms: times[4] } : {}),
    });
  }
  report.memoryBoundary =
    "maxRssKiB measures Node worker only; native child shares unchanged 512MiB cgroup, not measured individually";
  await writeFile(
    join(base, "native-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      samples: report.samples.map(({ name, state, runs, p50Ms, p95Ms }) => ({
        name,
        state,
        runs,
        p50Ms,
        p95Ms,
      })),
    }),
  );
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
}
