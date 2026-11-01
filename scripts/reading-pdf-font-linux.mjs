import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, chmod, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";

const base = resolve(process.argv[2] || ""),
  runtime = join(base, "runtime-pdf");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDirectory = await mkdtemp("/run/shixu-pdf-font-socket-"),
  staging = await mkdtemp("/run/shixu-pdf-font-input-");
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
    pdfVisualWindows:true,
  });
  const cases = [];
  for (const archive of [false,true]) {
    const directory = await mkdtemp("/tmp/shixu-pdf-font-client-");
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const result = await run(
      "nobody",
      `import {runPdfFontClients} from './scripts/reading-pdf-font-clients.mjs';
      import {createBrokerClient} from './server/reading/broker-service.mjs';
      const report=await runPdfFontClients({directory:${JSON.stringify(directory)},archive:${archive},
      reader:createBrokerClient(${JSON.stringify(socketPath)},{pdfVisualWindows:true})});console.log(JSON.stringify(report));`,
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
  const {fontPdfBytes}=await import('../server/reading/pdf-font-fixtures.mjs');
  const {sha256}=await import('../server/reading/material.mjs');
  const resource=[];
  for (const cmap of [false,true]) {
    const body=fontPdfBytes({cmap}),started=performance.now();
    const read=await createLinuxReader({runtime,staging,pdfVisualWindows:true})({id:'resource',name:'font.pdf',body,size:body.length,hash:sha256(body)},
      cmap?{pdfWindow:{page:1,offset:0}}:{pdfVisualWindow:{page:1,tile:1,offset:0}});
    if(cmap)assert.equal(read.material.segments.map(s=>s.text).join(''),'中文\n');
    else {assert.equal(read.material.state,'read');assert.ok(read.material.segments.some(s=>s.image));}
    resource.push({cmap,inputBytes:body.length,inputHash:sha256(body),elapsedMs:performance.now()-started,...read.metrics});
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
    join(base, "pdf-font-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of [...directories, socketDirectory, staging]) {
    if (!/^\/(tmp|run)\/shixu-pdf-font-[\w-]+$/.test(directory))
      throw Error("UNSAFE_TEST_CLEANUP");
    await rm(directory, { recursive: true, force: true });
  }
}
