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
const socketDirectory = await mkdtemp("/run/shixu-rar-solid-socket-"),
  staging = await mkdtemp("/run/shixu-rar-solid-input-");
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
  for (const version of [4, 5]) {
    const directory = await mkdtemp("/tmp/shixu-rar-solid-client-");
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const result = await run(
      "nobody",
      `import {runRarSolidClients} from './scripts/reading-rar-solid-clients.mjs';
      import {createBrokerClient} from './server/reading/broker-service.mjs';
      const report=await runRarSolidClients({directory:${JSON.stringify(directory)},version:${version},
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
  const {rarSolidSample}=await import('../server/reading/rar-solid-fixtures.mjs');
  const {sha256}=await import('../server/reading/material.mjs');
  const resource=[];
  for (const version of [4,5]) {
    const {body}=await rarSolidSample(version), started=performance.now();
    const read=await createLinuxReader({runtime,staging})({id:'resource',name:'solid.rar',body,size:body.length,hash:sha256(body)},
      {archiveWindow:{entry:8,page:1,offset:48,base:48,expanded:0}});
    assert.equal(read.material.archivePagination.next,null);
    assert.equal(read.material.segments.map(s=>s.text).join(''),'file9\n');
    assert.equal(read.material.archiveCompression.blocks[0].members,9);
    resource.push({version,inputBytes:body.length,inputHash:sha256(body),sharedBlock:read.material.archiveCompression.blocks[0],
      tailHash:sha256(Buffer.from(read.material.segments[0].text)),elapsedMs:performance.now()-started,...read.metrics});
  }
  const report = {
    resource,
    synthetic: true,
    realProviderCalls: 0,
    linuxBrokerUnprivilegedClient: true,
    unauthorizedUidDenied: true,
    cases,
  };
  await writeFile(
    join(base, "rar-solid-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of [...directories, socketDirectory, staging]) {
    if (!/^\/(tmp|run)\/shixu-rar-solid-[\w-]+$/.test(directory))
      throw Error("UNSAFE_TEST_CLEANUP");
    await rm(directory, { recursive: true, force: true });
  }
}
