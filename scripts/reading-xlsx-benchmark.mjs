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
const staging = "/run/shixu-xlsx-benchmark";
await mkdir(staging, { mode: 0o700 });
await chmod(staging, 0o700);
try {
  const baseline = await import(
    pathToFileURL(join(root, "baseline/server/reading/linux-broker.mjs"))
  );
  const runtime = "/opt/shixu-bcd-test-20261028/runtime";
  const oldReader = baseline.createLinuxReader({ runtime, staging }),
    reader = createLinuxReader({ runtime, staging });
  const report = {
    synthetic: true,
    repetitions: 5,
    baselineCommit: "46e942651e9065093d9f52fe06bbb47ef2094a44",
    realProviderCalls: 0,
    samples: [],
  };
  const fixtures = JSON.parse(
    await readFile(join(root, "xlsx-benchmark-fixtures.json"), "utf8"),
  );
  for (const f of fixtures) {
    if(process.argv.includes("--xlsx-only")&&!f.name.endsWith(".xlsx"))continue;
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
      "independent full-text golden",
    );
    assert.equal(expected.state, f.state);
    if (f.name === "long.xlsx") {
      assert.equal(expected.covered.at(-1).row, 3000);
      assert.equal(expected.covered.at(-1).sheet, "长资料表");
      assert.equal(
        expected.segments.filter((s) => s.range.row > 1 && s.range.row < 3000)
          .length,
        2000,
      );
    }
    const variants = f.name.endsWith(".xlsx")
      ? [["xlsx", reader]]
      : [
          ["baseline", oldReader],
          ["current", reader],
        ];
    for (const [variant, read] of variants) {
      const outputs = [];
      for (let i = 0; i < 5; i++) {
        const result = await read(file);
        assert.deepEqual(
          { ...result.material, readerVersion: expected.readerVersion },
          expected,
        );
        outputs.push(result);
      }
      const p95 = (values) =>
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
      report.samples.push({
        name: f.name,
        variant,
        bytes: body.length,
        state: expected.state,
        segments: expected.segments.length,
        exactTextAndRanges: true,
        isolatedP95Ms: p95(outputs.map((r) => r.timing.isolatedMs)),
        parseP95Ms: p95(outputs.map((r) => r.metrics.parseMs)),
        peakWorkerRssKiB: Math.max(...outputs.map((r) => r.metrics.maxRssKiB)),
      });
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
