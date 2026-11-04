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
const socketDirectory = await mkdtemp("/run/shixu-solid-socket-"),
  staging = await mkdtemp("/run/shixu-solid-input-");
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
    const directory = await mkdtemp("/tmp/shixu-solid-client-");
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const result = await run(
      "nobody",
      `import {runSolidClients} from './scripts/reading-solid-clients.mjs';
      import {createBrokerClient} from './server/reading/broker-service.mjs';
      const report=await runSolidClients({directory:${JSON.stringify(directory)},deleted:${deleted},
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
  const { sevenZipBytes } = await import(
      "../server/reading/native-archive-fixtures.mjs"
    ),
    { solidText } = await import("../server/reading/solid-fixtures.mjs"),
    { sha256 } = await import("../server/reading/material.mjs");
  const bytes = solidText(4 * 1024 * 1024),
    entries = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => ["0" + i + ".txt", bytes]),
    );
  entries["99tail.txt"] = Buffer.from("solid资源尾部唯一标记");
  const body = await sevenZipBytes(entries, ["-mx=1", "-ms=on", "-md=8m"]),
    started = performance.now(),
    read = await createLinuxReader({ runtime, staging })(
      {
        id: "resource",
        name: "solid.7z",
        body,
        size: body.length,
        hash: sha256(body),
      },
      { archiveWindow: { entry: 6, page: 1, offset: 0, base: 0, expanded: 0 } },
    );
  assert.equal(read.material.archivePagination.next, null);
  assert.equal(
    read.material.segments[0].text,
    entries["99tail.txt"].toString(),
  );
  assert.equal(read.material.archiveCompression.blocks.length, 1);
  assert.equal(read.material.archiveCompression.blocks[0].members, 7);
  assert.equal(
    read.material.archiveCompression.expandedBytes,
    6 * bytes.length + entries["99tail.txt"].length,
  );
  const resource = {
    members: 7,
    inputBytes: body.length,
    inputHash: sha256(body),
    sharedBlock: read.material.archiveCompression.blocks[0],
    tailHash: sha256(Buffer.from(read.material.segments[0].text)),
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
    join(base, "solid-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of [...directories, socketDirectory, staging]) {
    if (!/^\/(tmp|run)\/shixu-solid-[\w-]+$/.test(directory))
      throw Error("UNSAFE_TEST_CLEANUP");
    await rm(directory, { recursive: true, force: true });
  }
}
