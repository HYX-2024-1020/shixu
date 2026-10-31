import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";
const jpegInput=process.argv.includes("--jpeg");
const sixteen=process.argv.includes("--sixteen-png");
const packed=process.argv.includes("--packed-png") || sixteen;
const archiveImages=process.argv.includes("--archive-images");
const rar4=process.argv.includes("--rar4");
const costAudit=process.argv.includes("--cost-audit");
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const prefix=sixteen ? "/run/shixu-sixteen-png" : jpegInput ? "/run/shixu-jpeg" : packed ? "/run/shixu-packed-png" : archiveImages ? "/run/shixu-archive-images" : rar4 ? "/run/shixu-rar4-windows" : costAudit ? "/run/shixu-cost-audit" : "/run/shixu-archive-windows";
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
  for (const format of (jpegInput ? ["jpeg","rar4"] : packed ? ["png","rar4"] : archiveImages ? ["zip","rar4"] : costAudit ? ["usage","not-billed"] : rar4 ? ["rar4","rar4-deleted"] : ["zip", "rar", "7z"])) {
    const directory = await mkdtemp(join(base, "clients-"));
    directories.push(directory);
    await chown(directory, 65534, 65534);
    const start = performance.now();
    const result = await run(
      "nobody",
      `
      ${archiveImages || packed || jpegInput ? "import { runImageClients } from './scripts/reading-image-clients.mjs';" : costAudit ? "import { runCostAuditClients } from './scripts/reading-cost-audit-clients.mjs';" : "import { runArchiveWindowsClients } from './scripts/reading-archive-windows-clients.mjs';"}
      import { createBrokerClient } from './server/reading/broker-service.mjs';
      const result=await ${archiveImages || packed || jpegInput ? "runImageClients" : costAudit ? "runCostAuditClients" : "runArchiveWindowsClients"}({directory:${JSON.stringify(directory)},${archiveImages || packed || jpegInput ? "archiveFormat" : costAudit ? "disposition" : "format"}:${(packed && format==='png') || (jpegInput && format==='jpeg')?'undefined':JSON.stringify(format==="rar4-deleted"?"rar4":format)},packed:${packed},sixteen:${sixteen},jpeg:${jpegInput},deleted:${archiveImages || packed || jpegInput ? format === "rar4" : costAudit ? format === "not-billed" : format === "7z" || format === "rar4-deleted"},reader:createBrokerClient('${socketPath}')});
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
  let resource;
  if (packed) {
    const {encodingPng}=await import('../server/reading/png-encoding-fixtures.mjs');
    const {decodePng}=await import('../server/reading/image.mjs');
    const {sha256}=await import('../server/reading/material.mjs');
    const {createLinuxReader}=await import('../server/reading/linux-broker.mjs');
    const fixture=encodingPng({width:4096,height:2048,color:6,depth:sixteen?16:8,interlace:1,transparency:true});
    const started=performance.now();
    const read=await createLinuxReader({runtime:'/opt/shixu-bcd-test-20261028/runtime',staging})(
      {id:'adam7',name:'adam7.png',body:fixture.body,size:fixture.body.length,hash:sha256(fixture.body)},
      {imageWindow:{tile:8}},
    );
    const source=read.material.segments[0],range=source.range;
    assert.deepEqual([range.x,range.y,range.width,range.height],[3072,1024,1024,1024]);
    const pixels=decodePng(Buffer.from(source.image.data,'base64')).pixels,expected=Buffer.alloc(pixels.length);
    for(let y=0;y<1024;y++)fixture.pixels.copy(expected,y*4096,((y+1024)*4096+3072)*4,((y+1024)*4096+4096)*4);
    assert.deepEqual(pixels,expected);
    resource={width:4096,height:2048,interlace:1,color:6,depth:sixteen?16:8,tile:8,inputHash:sha256(fixture.body),
      expectedPixelsHash:sha256(expected),actualPixelsHash:sha256(pixels),elapsedMs:performance.now()-started,...read.metrics};
  }
  if (jpegInput) {
    const {jpegSample}=await import('../server/reading/jpeg-fixtures.mjs');
    const {decodeJpeg,jpegPixelIndex}=await import('../server/reading/jpeg.mjs');
    const {decodePng}=await import('../server/reading/image.mjs');
    const {sha256}=await import('../server/reading/material.mjs');
    const {createLinuxReader}=await import('../server/reading/linux-broker.mjs');
    const fixture=jpegSample({width:2048,height:2048,orientation:6});
    const started=performance.now();
    const read=await createLinuxReader({runtime:'/opt/shixu-bcd-test-20261028/runtime',staging})(
      {id:'jpeg',name:'rotated.jpg',body:fixture.body,size:fixture.body.length,hash:sha256(fixture.body)},
      {imageWindow:{tile:4}},
    );
    const source=read.material.segments[0],range=source.range;
    assert.deepEqual([range.x,range.y,range.width,range.height,range.orientation],[1024,1024,1024,1024,6]);
    const pixels=decodePng(Buffer.from(source.image.data,'base64')).pixels,expected=Buffer.alloc(pixels.length),image=decodeJpeg(fixture.body);
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){
      const index=jpegPixelIndex(image,x+1024,y+1024);image.pixels.copy(expected,(y*1024+x)*4,index,index+4);
    }
    assert.deepEqual(pixels,expected);
    resource={width:2048,height:2048,orientation:6,tile:4,inputBytes:fixture.body.length,inputHash:sha256(fixture.body),
      expectedPixelsHash:sha256(expected),actualPixelsHash:sha256(pixels),elapsedMs:performance.now()-started,...read.metrics};
  }
  const report = {
    synthetic: true,
    realProviderCalls: 0,
    linuxBrokerUnprivilegedClient: true,
    unauthorizedUidDenied: true,
    cursorPathInjectionDenied: true,
    ...(resource ? {resource} : {}),
    cases,
  };
  await writeFile(
    join(base, sixteen ? "png-sixteen-linux.json" : jpegInput ? "jpeg-linux.json" : packed ? "png-encoding-linux.json" : archiveImages ? "archive-images-linux.json" : rar4 ? "rar4-clients-linux.json" : costAudit ? "cost-audit-clients-linux.json" : "archive-windows-clients-linux.json"),
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
