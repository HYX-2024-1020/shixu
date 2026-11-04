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
const socketDirectory = await mkdtemp("/run/shixu-pdf-annotation-socket-"),
  staging = await mkdtemp("/run/shixu-pdf-annotation-input-");
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
    const directory = await mkdtemp("/tmp/shixu-pdf-annotation-client-");
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const result = await run(
      "nobody",
      `import {runPdfAnnotationClients} from './scripts/reading-pdf-annotation-clients.mjs';
      import {createBrokerClient} from './server/reading/broker-service.mjs';
      const report=await runPdfAnnotationClients({directory:${JSON.stringify(directory)},archive:${archive},
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
  const {annotationPdfBytes}=await import('../server/reading/pdf-annotation-fixtures.mjs');
  const {sha256}=await import('../server/reading/material.mjs');
  const resource=[];
  for (const kind of ['stamp','text','checkbox','auto-text','auto-choice','unencoded']) {
    const options=kind.startsWith('auto-')?{kind:kind.slice(5),appearance:false,needAppearances:true}:kind==='unencoded'?{kind:'text',appearance:false,needAppearances:true,fieldValue:'中文😀'}:{kind};
    const body=annotationPdfBytes(options),started=performance.now();
    const read=await createLinuxReader({runtime,staging,pdfVisualWindows:true})({id:'resource',name:'annotation.pdf',body,size:body.length,hash:sha256(body)},
      {pdfVisualWindow:{page:1,tile:1,offset:0}});
    assert.equal(read.material.covered[0].annotation,1);
    if(kind==='unencoded'){assert.equal(read.material.state,'partial');assert.ok(read.material.reasons.includes('PDF_VISUAL_RENDER_WARNING'));assert.equal(read.material.segments.some(s=>s.image),false);}
    else {assert.equal(read.material.state,'read');assert.ok(read.material.segments.some(s=>s.image));}
    resource.push({kind,inputBytes:body.length,inputHash:sha256(body),elapsedMs:performance.now()-started,...read.metrics});
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
    join(base, "pdf-annotation-linux.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  for (const directory of [...directories, socketDirectory, staging]) {
    if (!/^\/(tmp|run)\/shixu-pdf-annotation-[\w-]+$/.test(directory))
      throw Error("UNSAFE_TEST_CLEANUP");
    await rm(directory, { recursive: true, force: true });
  }
}
