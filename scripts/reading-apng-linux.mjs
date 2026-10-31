import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, chmod, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";

const base = resolve(process.argv[2] || ""),
  runtime = join(base, "runtime");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDirectory = await mkdtemp("/run/shixu-apng-socket-"),
  staging = await mkdtemp("/run/shixu-apng-input-");
await chown(socketDirectory, 0, 65534);
await chmod(socketDirectory, 0o750);
const socketPath = join(socketDirectory, "reader.sock"),
  directories = [];
let broker;
const run = (user, code) =>
  new Promise((done, reject) => {
    const child = spawn(
      "/usr/sbin/runuser",
      ["-u", user, "--", process.execPath, "--input-type=module", "-e", code],
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
try {
  broker = await createBrokerService({
    socketPath,
    runtime,
    staging,
  });
  const cases = [];
  for (const deleted of [false, true]) {
    const directory = await mkdtemp("/tmp/shixu-apng-client-");
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const result = await run(
      "nobody",
      `import {runApngClients} from './scripts/reading-apng-clients.mjs';
      import {createBrokerClient} from './server/reading/broker-service.mjs';
      const report=await runApngClients({directory:${JSON.stringify(directory)},deleted:${deleted},archive:${deleted},
      reader:createBrokerClient(${JSON.stringify(socketPath)})});console.log(JSON.stringify(report));`,
    );
    assert.equal(result.exit, 0, result.errors);
    cases.push(JSON.parse(result.output));
  }
  const denied = await run(
    "daemon",
    `import {createBrokerClient} from './server/reading/broker-service.mjs';
    try{await createBrokerClient(${JSON.stringify(socketPath)})({id:'a',name:'a.docx',body:Buffer.from('x'),size:1,hash:'x'},{officeWindow:{text:1,image:0,tile:1,offset:0}});process.exit(2);}
    catch(e){if(!/EACCES|permission/i.test(String(e)))throw e;}`,
  );
  assert.equal(denied.exit, 0, denied.errors);
  const { apngBytes } = await import("../server/reading/apng-fixtures.mjs"),
    { decodePng } = await import("../server/reading/image.mjs"),
    { sha256 } = await import("../server/reading/material.mjs");
  const rgba = Buffer.alloc(2048 * 2048 * 4, 255);
  for (let y = 0; y < 2048; y++)
    for (let x = 0; x < 2048; x++) {
      const p = (y * 2048 + x) * 4;
      rgba[p] = x % 251;
      rgba[p + 1] = y % 251;
      rgba[p + 2] = (x + y) % 251;
    }
  const body = apngBytes({
      width: 2048,
      height: 2048,
      frames: [{ pixels: rgba }, { pixels: rgba, disposal: 2 }],
    }),
    expected = Buffer.alloc(1024 * 1024 * 4);
  for (let y = 0; y < 1024; y++)
    rgba.copy(
      expected,
      y * 1024 * 4,
      ((y + 1024) * 2048 + 1024) * 4,
      ((y + 1024) * 2048 + 2048) * 4,
    );
  const started = performance.now(),
    read = await createLinuxReader({ runtime, staging })(
      {
        id: "resource",
        name: "animation.apng",
        body,
        size: body.length,
        hash: sha256(body),
      },
      { imageWindow: { tile: 8 } },
    );
  assert.equal(read.material.imagePagination.nextTile, null);
  assert.equal(read.material.covered[0].frame, 2);
  const pixels = decodePng(
    Buffer.from(read.material.segments[0].image.data, "base64"),
  ).pixels;
  assert.deepEqual(pixels, expected);
  const resource = {
    width: 2048,
    height: 2048,
    frames: 2,
    tile: 8,
    inputBytes: body.length,
    inputHash: sha256(body),
    expectedPixelsHash: sha256(expected),
    actualPixelsHash: sha256(pixels),
    elapsedMs: performance.now() - started,
    ...read.metrics,
  };
  const report = {
    resource,
    synthetic: true,
    realProviderCalls: 0,
    linuxBrokerUnprivilegedClient: true,
    unauthorizedUidDenied: true,
    cases,
  };
  await writeFile(
    join(base, "apng-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of [...directories, socketDirectory, staging]) {
    if (!/^\/(tmp|run)\/shixu-apng-[\w-]+$/.test(directory))
      throw Error("UNSAFE_TEST_CLEANUP");
    await rm(directory, { recursive: true, force: true });
  }
}
