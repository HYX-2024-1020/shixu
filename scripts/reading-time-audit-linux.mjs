import assert from "node:assert/strict";
import { mkdir, mkdtemp, chown, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createBrokerService } from "../server/reading/broker-service.mjs";

const base=resolve(process.argv[2] || "");
if(process.platform!=="linux" || process.getuid()!==0 || !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base))
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDir="/run/shixu-time-audit-socket",staging="/run/shixu-time-audit-input";
await mkdir(socketDir,{mode:0o750});await chown(socketDir,0,65534);
await mkdir(staging,{mode:0o700});
const directory=await mkdtemp(join(base,"clients-"));await chown(directory,65534,65534);
const socketPath=socketDir+"/reader.sock";
let broker;
try {
  broker=await createBrokerService({socketPath,staging,runtime:"/opt/shixu-bcd-test-20261028/runtime"});
  const started=performance.now();
  const code=`import {runClientLoop} from './scripts/reading-client-loop.mjs';
    import {createBrokerClient} from './server/reading/broker-service.mjs';
    import {pdfWindowSample} from './server/reading/pdf-fixtures.mjs';
    const isolated=createBrokerClient(${JSON.stringify(socketPath)});let reads=0;
    const reader=Object.assign(async(...args)=>{
      if(++reads===1)throw Object.assign(Error('synthetic terminated reader missing timing'),{timingUncertain:true});
      return isolated(...args);
    },{pdfWindows:true});
    const result=await runClientLoop({directory:${JSON.stringify(directory)},reader,original:pdfWindowSample(),
      auditUnknownTime:true,expectedReadPause:'ACTIVE_TIME_RECONCILIATION',originalQuota:1,
      sourceByMini:true,startByMini:true,expireBeforeStart:true});console.log(JSON.stringify(result));`;
  const result=await new Promise((done,reject)=>{
    const child=spawn('/usr/sbin/runuser',['-u','nobody','--',process.execPath,'--input-type=module','-e',code],
      {cwd:base,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
    child.on('error',reject);child.on('close',exit=>done({exit,output,errors}));
  });
  assert.equal(result.exit,0,result.errors);
  const report={...JSON.parse(result.output),elapsedMs:performance.now()-started,
    broker:'protected socket, ordinary UID, real isolated PDF windows',
    terminationEvidence:'synthetic trusted verifier; no real host telemetry evidence integration'};
  await writeFile(join(base,'time-audit-clients-linux.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  if(broker)await new Promise(done=>broker.close(done));
  await rm(directory,{recursive:true,force:true});await rm(socketDir,{recursive:true,force:true});
  await rm(staging,{recursive:true,force:true});
}
