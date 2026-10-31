import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, chmod, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { officeImageBytes } from "../server/reading/office-fixtures.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { encodePng, decodePng } from "../server/reading/image.mjs";
import { sha256 } from "../server/reading/material.mjs";

const base = resolve(process.argv[2] || ""),
  runtime = join(base, "runtime");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDirectory = await mkdtemp("/run/shixu-office-socket-"),
  staging = await mkdtemp("/run/shixu-office-input-");
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
  for (const [format, archiveFormat] of [
    ["docx", undefined],
    ["xlsx", "rar4"],
  ]) {
    const directory = await mkdtemp("/tmp/shixu-office-client-");
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const result = await run(
      "nobody",
      `import {runOfficeClients} from './scripts/reading-office-clients.mjs';
      import {createBrokerClient} from './server/reading/broker-service.mjs';
      const report=await runOfficeClients({format:${JSON.stringify(format)},directory:${JSON.stringify(directory)},archiveFormat:${JSON.stringify(archiveFormat)},deleted:${!!archiveFormat},
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
  const scan = Buffer.alloc(2048 * 2048 * 4, 255),
    expected = Buffer.alloc(1024 * 1024 * 4);
  for (let y = 0; y < 2048; y++)
    for (let x = 0; x < 2048; x++) {
      const p = (y * 2048 + x) * 4;
      scan[p] = (x * 13 + y * 7) % 256;
      scan[p + 1] = (x + y * 3) % 256;
      scan[p + 2] = (x * 5 + y) % 256;
    }
  const body = officeImageBytes("docx", {
    body: encodePng(2048, 2048, scan),
  }).body;
  for (let y = 0; y < 1024; y++)
    scan.copy(
      expected,
      y * 1024 * 4,
      ((y + 1024) * 2048 + 1024) * 4,
      ((y + 1024) * 2048 + 2048) * 4,
    );
  const descriptor = {
    id: "resource",
    name: "office.docx",
    body,
    size: body.length,
    hash: sha256(body),
  };
  const first = await readMaterial(descriptor, {
    officeWindow: { text: 1, image: 0, tile: 1, offset: 0 },
  });
  const started = performance.now();
  const read = await createLinuxReader({ runtime, staging })(descriptor, {
    officeWindow: {
      text: 0,
      image: 0,
      tile: 4,
      offset: first.officePagination.next.offset + 3,
    },
  });
  assert.equal(read.material.officePagination.next, null);
  assert.equal(read.material.covered[0].mediaPart, "word/media/图像.png");
  const pixels = decodePng(
    Buffer.from(read.material.segments[0].image.data, "base64"),
  ).pixels;
  assert.deepEqual(pixels, expected);
  const report = {
    synthetic: true,
    realProviderCalls: 0,
    linuxBrokerUnprivilegedClient: true,
    unauthorizedUidDenied: true,
    cases,
    resource: {
      width: 2048,
      height: 2048,
      tile: 4,
      inputBytes: body.length,
      inputHash: sha256(body),
      expectedPixelsHash: sha256(expected),
      actualPixelsHash: sha256(pixels),
      elapsedMs: performance.now() - started,
      ...read.metrics,
    },
  };
  await writeFile(
    join(base, "office-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of [...directories, socketDirectory, staging]) {
    if (!/^\/(tmp|run)\/shixu-office-[\w-]+$/.test(directory))
      throw Error("UNSAFE_TEST_CLEANUP");
    await rm(directory, { recursive: true, force: true });
  }
}
