import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Operates exclusively on an explicit synthetic runtime prepared by the
// companion script, never the production service or tenant directories.
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("EXPLICIT_SYNTHETIC_LINUX_ROOT_REQUIRED");
const staging = "/run/" + basename(base);
await mkdir(staging, { recursive: true, mode: 0o755 });
const reader = createLinuxReader({ runtime: join(base, "runtime"), staging });
const file = (text, name = "合成.txt") => {
  const body = Buffer.from(text);
  return { id: "a", name, body, size: body.length, hash: sha256(body) };
};
if (process.argv.includes("--crash-child")) {
  await reader(file("synthetic crash cleanup"), { probe: "timeout" });
  process.exit(0);
}
const samples = [
  file("第一行\r\n A😀é \r最后\n"),
  file('名称,内容,空列\n"甲,乙","跨\n行""引号",\n尾部,,完毕', "结构.csv"),
  file("中文😀abc".repeat(60000) + "最后唯一标记"),
  file('a,b\n1,2\n"损坏', "部分.csv"),
];
const report = { synthetic: true, providerCalls: 0, samples: [], probes: {} };
for (const sample of samples) {
  const expected = readMaterial(sample),
    actual = await reader(sample);
  assert.deepEqual(actual.material, expected);
  report.samples.push({
    name: sample.name,
    bytes: sample.size,
    state: actual.material.state,
    segments: actual.material.segments.length,
    exactMatch: true,
    ...actual.metrics,
    ...actual.timing,
  });
}
const boundary = await reader(file("synthetic"), { probe: "boundary" });
assert.ok(boundary.uid > 0);
for (const key of [
  "noNewPrivileges",
  "noCapabilities",
  "hostDenied",
  "symlinkDenied",
  "otherTaskDenied",
  "inputReadOnly",
  "runtimeReadOnly",
  "networkDenied",
  "diskDenied",
])
  assert.equal(boundary[key], true, key);
assert.deepEqual(boundary.envKeys, ["LANG", "PATH"]);
assert.ok(boundary.scratchBytes <= 256 * 1024 * 1024);
report.probes.boundary = boundary;
for (const probe of ["memory", "timeout"]) {
  const started = performance.now();
  await assert.rejects(
    reader(file("synthetic"), { probe }),
    /ISOLATED_READING_FAILED/,
  );
  report.probes[probe] = {
    terminated: true,
    elapsedMs: performance.now() - started,
  };
}
const processProbe = await reader(file("synthetic"), { probe: "process" });
assert.equal(processProbe.processLimitDenied, true);
report.probes.process = processProbe;
assert.deepEqual(await readdir(staging), []);
const crashed = spawn(
  process.execPath,
  [fileURLToPath(import.meta.url), base, "--crash-child"],
  { stdio: "ignore" },
);
for (let n = 0; n < 100 && !(await readdir(staging)).length; n++)
  await new Promise((r) => setTimeout(r, 20));
assert.ok(
  (await readdir(staging)).length > 0,
  "child created only its synthetic input",
);
await new Promise((r) => setTimeout(r, 300));
const exited = once(crashed, "exit");
crashed.kill("SIGKILL");
await exited;
await new Promise((r) => setTimeout(r, 2500));
assert.deepEqual(
  await readdir(staging),
  [],
  "systemd removed input after broker crash without JS finally",
);
report.probes.brokerCrashCleanup = true;
report.stagingClean = true;
console.log(JSON.stringify(report, null, 2));
