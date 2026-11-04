import assert from "node:assert/strict";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { jpegSample } from "../server/reading/jpeg-fixtures.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-jpeg-strict-input";
await mkdir(staging, { mode: 0o700 });
try {
  const isolated = createLinuxReader({
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const f = jpegSample({ width: 4, height: 2051, orientation: 6 });
  const restart = await readFile(
    new URL("../server/reading/fixtures/jpeg-restart.jpg", import.meta.url),
  );
  const samples = [];
  for (const [name, body, tile, valid] of [
    ["rotated-tail", f.body, 3, true],
    ["progressive-restart", restart, 1, true],
    [
      "unused-entropy",
      Buffer.concat([
        f.body.subarray(0, -2),
        Buffer.from([1, 2, 3]),
        f.body.subarray(-2),
      ]),
      1,
      false,
    ],
  ]) {
    const file = {
        id: "strict",
        name: name + ".jpg",
        body,
        size: body.length,
        hash: sha256(body),
      },
      options = { imageWindow: { tile } };
    const read = await isolated(file, options),
      expected = await readMaterial(file, options);
    assert.deepEqual(read.material, expected);
    assert.equal(read.material.segments.length, valid ? 1 : 0);
    samples.push({
      name,
      tile,
      valid,
      inputHash: file.hash,
      state: expected.state,
      reasons: expected.reasons,
      normalizedImageHash: expected.covered[0]?.imageHash,
      ...read.metrics,
    });
  }
  const report = {
    synthetic: true,
    realProviderCalls: 0,
    actualLinuxIsolation: true,
    postStrictGuard: true,
    samples,
  };
  await writeFile(
    join(base, "jpeg-strict-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await rm(staging, { recursive: true, force: true });
}
