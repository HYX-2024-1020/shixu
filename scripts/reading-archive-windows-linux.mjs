import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";
const costAudit=process.argv.includes("--cost-audit");
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const prefix=costAudit ? "/run/shixu-cost-audit" : "/run/shixu-archive-windows";
const socketDir = prefix+"-socket", staging=prefix+"-input";
await mkdir(socketDir, { mode: 0o750 });
await chown(socketDir, 0, 65534);
await mkdir(staging, { mode: 0o700 });
const socketPath = socketDir + "/reader.sock";
let broker;
const directories = [];
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
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const cases = [];
  for (const format of (costAudit ? ["usage","not-billed"] : ["zip", "rar", "7z"])) {
    const directory = await mkdtemp(join(base, "clients-"));
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const start = performance.now();
    const result = await run(
      "nobody",
      `
      ${costAudit ? "import { runCostAuditClients } from './scripts/reading-cost-audit-clients.mjs';" : "import { runArchiveWindowsClients } from './scripts/reading-archive-windows-clients.mjs';"}
      import { createBrokerClient } from './server/reading/broker-service.mjs';
      const result=await ${costAudit ? "runCostAuditClients" : "runArchiveWindowsClients"}({directory:${JSON.stringify(directory)},${costAudit ? "disposition" : "format"}:'${format}',deleted:${costAudit ? format === "not-billed" : format === "7z"},reader:createBrokerClient('${socketPath}')});
      console.log(JSON.stringify(result));`,
    );
    assert.equal(result.exit, 0, result.errors);
    cases.push({
      ...JSON.parse(result.output),
      elapsedMs: performance.now() - start,
    });
  }
  const unauthorized = await run(
    "daemon",
    `
    import { createBrokerClient } from './server/reading/broker-service.mjs';
    try {await createBrokerClient('${socketPath}')({id:'a',name:'a.txt',body:Buffer.from('a'),hash:'x',size:1});process.exit(2);}
    catch(e){if(!['EACCES','EPERM'].includes(e.code))process.exit(3);}`,
  );
  assert.equal(unauthorized.exit, 0, unauthorized.errors);
  const injection = await run(
    "nobody",
    `
    import http from 'node:http';
    const descriptor={id:'a',name:'a.zip',size:1,hash:'x',archiveWindow:{entry:0,page:1,offset:0,base:0,expanded:0,path:'../../private'}};
    const r=http.request({socketPath:'${socketPath}',path:'/read',method:'POST',headers:{'Content-Type':'application/octet-stream','X-Shixu-Reader-Protocol':'4','X-Shixu-Read-Id':crypto.randomUUID(),'X-Shixu-Descriptor':Buffer.from(JSON.stringify(descriptor)).toString('base64url')}},res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>process.exit(s.includes('ISOLATED_READING_FAILED')?0:2));});r.end('a');`,
  );
  assert.equal(injection.exit, 0, injection.errors);
  const report = {
    synthetic: true,
    realProviderCalls: 0,
    linuxBrokerUnprivilegedClient: true,
    unauthorizedUidDenied: true,
    cursorPathInjectionDenied: true,
    cases,
  };
  await writeFile(
    join(base, costAudit ? "cost-audit-clients-linux.json" : "archive-windows-clients-linux.json"),
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
