import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { encodePng, decodePng } from "../server/reading/image.mjs";
import { sha256 } from "../server/reading/material.mjs";
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDir = "/run/shixu-image-socket",
  staging = "/run/shixu-image-input";
await mkdir(socketDir, { mode: 0o750 });
await chown(socketDir, 0, 65534);
await mkdir(staging, { mode: 0o700 });
const socketPath = socketDir + "/reader.sock",
  directories = [];
let broker;
try {
  broker = await createBrokerService({
    socketPath,
    staging,
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
  });
  const cases = [];
  for (const deleted of [false, true]) {
    const directory = await mkdtemp(join(base, "clients-"));
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const code = `import {runImageClients} from './scripts/reading-image-clients.mjs';import {createBrokerClient} from './server/reading/broker-service.mjs';
      console.log(JSON.stringify(await runImageClients({directory:${JSON.stringify(directory)},deleted:${deleted},reader:createBrokerClient('${socketPath}')})));`;
    const started = performance.now();
    const result = await new Promise((done, reject) => {
      const child = spawn(
        "/usr/sbin/runuser",
        [
          "-u",
          "nobody",
          "--",
          process.execPath,
          "--input-type=module",
          "-e",
          code,
        ],
        {
          cwd: base,
          env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        errors = "";
      child.stdout.on("data", (b) => (output += b));
      child.stderr.on("data", (b) => (errors += b));
      child.on("error", reject);
      child.on("close", (exit) => done({ exit, output, errors }));
    });
    assert.equal(result.exit, 0, result.errors);
    cases.push({
      ...JSON.parse(result.output),
      elapsedMs: performance.now() - started,
    });
  }
  const isolated = createLinuxReader({
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const samples = [];
  for (const [width, height, tile] of [
    [1024, 1024, 1],
    [8000, 4000, 32],
  ]) {
    const body = encodePng(
      width,
      height,
      Buffer.alloc(width * height * 4, 255),
    );
    const file = {
      id: "pressure",
      name: "pressure.png",
      body,
      size: body.length,
      hash: sha256(body),
    };
    const started = performance.now(),
      result = await isolated(file, { imageWindow: { tile } }),
      range = result.material.covered[0];
    assert.ok(range);
    assert.equal(range.tile, tile);
    assert.equal(range.imageWidth, width);
    assert.equal(range.imageHeight, height);
    const png = decodePng(
      Buffer.from(result.material.segments[0].image.data, "base64"),
    );
    assert.equal(png.pixels.length, range.width * range.height * 4);
    assert.ok(png.pixels.every((b) => b === 255));
    samples.push({
      width,
      height,
      tile,
      inputBytes: body.length,
      elapsedMs: performance.now() - started,
      ...result.metrics,
    });
  }
  const report = {
    synthetic: true,
    realProviderCalls: 0,
    ordinaryUidProtectedBroker: true,
    cases,
    samples,
    note: "Single fixed measurements, not P95 or production SLO; model simulation and real API evidence are separate",
  };
  await writeFile(
    join(base, "image-clients-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
  await rm(socketDir, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
}
