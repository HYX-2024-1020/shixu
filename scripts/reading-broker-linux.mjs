import assert from "node:assert/strict";
import { mkdtemp, mkdir, chmod, chown, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";

const root = resolve(process.argv[2] || "");
const originals = process.argv.includes("--originals");
const recovery = process.argv.includes("--reverify")
  ? "deleteBeforeStart:true,startByMini:true,sourceByMini:true,"
  : process.argv.includes("--expired")
    ? "expireBeforeStart:true,startByMini:true,"
    : "";
const revision = process.argv.includes("--reuse") ? "reviseAfterPublication:true," : "";
const officeFormat = process.argv.includes("--zip") ? "zip" : process.argv.includes("--pdf")
  ? "pdf"
  : process.argv.includes("--xlsx")
    ? "xlsx"
    : process.argv.includes("--docx")
      ? "docx"
      : null;
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(root)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const run = (user, code) =>
  new Promise((done, reject) => {
    const child = spawn(
      "/usr/sbin/runuser",
      ["-u", user, "--", process.execPath, "--input-type=module", "-e", code],
      {
        cwd: root,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (b) => {
      output += b;
    });
    child.stderr.on("data", (b) => {
      errors += b;
    });
    child.on("error", reject);
    child.on("close", (exit) => done({ exit, output, errors }));
  });
const socketDirectory = "/run/shixu-bcd-v4-socket",
  staging = "/run/shixu-bcd-v4-input";
await mkdir(socketDirectory, { mode: 0o750 });
await chown(socketDirectory, 0, 65534);
await mkdir(staging, { mode: 0o700 });
let broker, directory;
try {
  broker = await createBrokerService({
    socketPath: socketDirectory + "/reader.sock",
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  directory = await mkdtemp(join(root, "clients-"));
  await chown(directory, 65534, 65534);
  await chmod(directory, 0o700);
  const started = performance.now();
  const loop = await run(
    "nobody",
    `import { runClientLoop } from './scripts/reading-client-loop.mjs'; import { createBrokerClient } from './server/reading/broker-service.mjs'; ${officeFormat ? `import { readFileSync } from 'node:fs'; const f = JSON.parse(readFileSync('./${officeFormat}-loop-fixture.json','utf8')); const original = {...f, body:Buffer.from(f.body,'base64')};` : "const original = undefined;"} const evidence = await runClientLoop({ directory: ${JSON.stringify(directory)}, reader: createBrokerClient('${socketDirectory}/reader.sock'), original, ${recovery}${revision}${originals ? "originalQuota:1,sourceByMini:true," + (revision ? "" : "verifyLifecycle:true,") : ""} }); console.log(JSON.stringify(evidence));`,
  );
  assert.equal(loop.exit, 0, loop.errors);
  const rejected = await run(
    "daemon",
    `import { createBrokerClient } from './server/reading/broker-service.mjs'; try { await createBrokerClient('${socketDirectory}/reader.sock')({ id:'a', name:'a.txt', size:1, hash:'x', body:Buffer.from('a') }); process.exit(2); } catch(e) { if (!['EACCES','EPERM'].includes(e.code)) process.exit(3); }`,
  );
  assert.equal(rejected.exit, 0, rejected.errors);
  const denied = await run(
    "nobody",
    `import http from 'node:http'; const r = http.request({socketPath:'${socketDirectory}/reader.sock',path:'/read',method:'POST',headers:{'Content-Type':'application/octet-stream','X-Shixu-Descriptor':Buffer.from(JSON.stringify({id:'a',name:'a.txt',size:1,hash:'x',probe:'network'})).toString('base64url')}},res=>{res.resume();res.on('end',()=>process.exit(res.statusCode===422?0:2));});r.end('a');`,
  );
  assert.equal(denied.exit, 0, denied.errors);
  console.log(
    JSON.stringify(
      {
        ...JSON.parse(loop.output),
        linuxBrokerUnprivilegedClient: true,
        unauthorizedUidDenied: true,
        clientProbeInjectionDenied: true,
        elapsedMs: performance.now() - started,
      },
      null,
      2,
    ),
  );
} finally {
  if (broker) await new Promise((done) => broker.close(done));
  if (directory) await rm(directory, { recursive: true, force: true });
  await rm(socketDirectory, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
}
