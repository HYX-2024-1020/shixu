import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { buildRelease } from "../../scripts/build-sync-release.mjs";
import { backupDatabase } from "./backup.mjs";
import { verifyService } from "./verify.mjs";
import { docxBytes, paragraph } from "../../server/reading/docx-fixtures.mjs";
import { xlsxBytes } from "../../server/reading/xlsx-fixtures.mjs";
import { pdfBytes } from "../../server/reading/pdf-fixtures.mjs";
import { archiveSample, archiveWindowSample } from "../../server/reading/archive-fixtures.mjs";
import { nativeArchiveSample } from "../../server/reading/native-archive-fixtures.mjs";
import {jpegSample} from '../../server/reading/jpeg-fixtures.mjs';

test("account service and protected CLI run from the self-contained release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-accounts-release-"));
  let service;
  try {
    const { directory: release } = await buildRelease(join(directory, "release"));
    const current = join(directory, "current");
    await symlink(release, current, process.platform === "win32" ? "junction" : "dir");
    const { createMultiUserService } = await import(pathToFileURL(join(release, "server/sync-multi-user.mjs")));
    const {SyncStore}=await import(pathToFileURL(join(release,'server/sync-store.mjs')));
    const {ReadingLedger}=await import(pathToFileURL(join(release,'server/reading/ledger.mjs')));
    const {ReadingTasks}=await import(pathToFileURL(join(release,'server/reading/tasks.mjs')));
    const chatStore=new SyncStore(':memory:'),chatLedger=new ReadingLedger(':memory:');
    const {createAttachmentStore}=await import(pathToFileURL(join(release,'server/sync-files.mjs')));
    createAttachmentStore(chatStore);
    let chatTasks;
    try {
      chatLedger.freezePrice({id:'synthetic',model:'synthetic',currency:'CNY',source:'synthetic',verifiedAt:1,inputMicrosPerMillion:1,cachedMicrosPerMillion:0,outputMicrosPerMillion:1});
      chatLedger.grantInitial('synthetic');
      const device=chatStore.createDevice('synthetic').deviceId;
      chatStore.apply(device,{id:'packet',opId:'seed',type:'put',baseVersion:0,data:{text:'',captureDate:'2026-10-31',attachments:[],sources:[],itemIds:['item1'],result:{summary:'',warnings:[],items:[{kind:'note',title:'合成',summary:'',facts:[],nextSteps:[],uncertainties:[],evidence:[],due:null}]}}},chatStore.epoch);
      const provider=Object.assign(async()=>{throw Error('unexpected organize');},{chat:async()=>({usage:{prompt_tokens:1,completion_tokens:1},result:{reply:'合成回答',patch:{group:'独立包'}}})});
      chatTasks=new ReadingTasks({store:chatStore,ledger:chatLedger,account:'synthetic',provider,reader:()=>{throw Error('unexpected parser');},priceId:'synthetic',modelVersion:'synthetic',authorize:id=>assert.equal(id,device)});
      chatTasks.enqueue({id:'chat',packetId:'packet',deviceId:device,chat:{itemId:'item1',instruction:'放到独立包组',baseVersion:chatStore.record('packet').version,epoch:chatStore.epoch}});
      for(let i=0;i<4&&chatTasks.get('chat').state==='queued';i++)await chatTasks.run('chat');
      assert.equal(chatTasks.get('chat').state,'done');
      assert.equal(chatStore.record('packet').data.itemState.item1.group,'独立包');
    }finally{chatTasks?.close();chatLedger.close();chatStore.close();}
    const {readMaterial,sha256} = await import(pathToFileURL(join(release,"server/reading/material.mjs")));
    const {encodePng,decodePng}=await import(pathToFileURL(join(release,'server/reading/image.mjs')));
    const png=encodePng(1,1,Buffer.from([10,20,30,255]));
    const visual=await readMaterial({id:'image',name:'独立包.png',body:png,size:png.length,hash:sha256(png)},{imageWindow:{tile:1}});
    assert.deepEqual([...decodePng(Buffer.from(visual.segments[0].image.data,'base64')).pixels],[10,20,30,255]);
    const jpeg=jpegSample({width:2,height:3,orientation:6});
    const photo=await readMaterial({id:'jpeg',name:'独立包.jpg',body:jpeg.body,size:jpeg.body.length,hash:sha256(jpeg.body)},{imageWindow:{tile:1}});
    assert.deepEqual([photo.covered[0].width,photo.covered[0].height,photo.covered[0].orientation],[3,2,6]);
    assert.equal(photo.segments[0].image.mime,'image/png');
    const original = docxBytes(paragraph("独立包DOCX原文😀"));
    assert.equal(readMaterial({id:"docx",name:"合成.docx",body:original,size:original.length,hash:sha256(original)}).segments.map(s=>s.text).join(""),"独立包DOCX原文😀\n");
    const accountDirectory = join(directory, "accounts");
    const workbook=xlsxBytes();
    assert.equal(readMaterial({id:"xlsx",name:"合成.xlsx",body:workbook,size:workbook.length,hash:sha256(workbook)}).segments.map(s=>s.text).join(""),"A1\t合成文字\n");
    const pdf = pdfBytes();
    const zip = archiveSample();
    const rar=await nativeArchiveSample("rar");
    assert.equal((await readMaterial({id:"rar",name:rar.name,body:rar.body,size:rar.body.length,hash:sha256(rar.body)})).segments.map(s=>s.text).join(""),rar.expectedText);
    assert.equal((await readMaterial({id:"zip",name:zip.name,body:zip.body,size:zip.body.length,hash:sha256(zip.body)})).segments.map(s=>s.text).join(""),zip.expectedText);
    assert.equal((await readMaterial({id:"pdf",name:"合成.pdf",body:pdf,size:pdf.length,hash:sha256(pdf)})).segments.map(s=>s.text).join(""),"中文😀PDF尾部\n");
    const windowed=archiveWindowSample();
    let cursor={entry:0,page:1,offset:0,base:0,expanded:0},text="";
    do {
      const m=await readMaterial({id:"paged",name:windowed.name,body:windowed.body,size:windowed.body.length,hash:sha256(windowed.body)},{archiveWindow:cursor});
      text+=m.segments.map(s=>s.text).join("");cursor=m.archivePagination.next;
    } while(cursor);
    assert.equal(text,windowed.expectedText);
    const secret = "synthetic-release-secret-32-characters";
    const { stdout } = await promisify(execFile)(process.execPath, [join(current, "server/sync-admin.mjs"), "generate", "2"], {
      env: { ...process.env, SYNC_ACCOUNT_DIR: accountDirectory, SYNC_ACCOUNT_SECRET: secret },
    });
    assert.equal(JSON.parse(stdout).length, 2);
    service = createMultiUserService({ directory: accountDirectory, secret });
    service.server.listen(0, "127.0.0.1"); await once(service.server, "listening");
    const base = `http://127.0.0.1:${service.server.address().port}`;
    assert.equal((await (await fetch(base + "/api/v3/status")).json()).protocolVersion, 3);
    assert.equal((await fetch(base + "/api/v2/changes")).status, 404);
    assert.equal((await fetch(base + "/api/v3/changes")).status, 401);
    const env = { ...process.env, SYNC_ACCOUNT_DIR: accountDirectory, SYNC_ACCOUNT_SECRET: secret };
    const probe = await promisify(execFile)(process.execPath, [join(current, "deploy/sync/verify-accounts.mjs"), base], { env });
    assert.equal(JSON.parse(probe.stdout).isolatedAccounts, true);
    const usage = await promisify(execFile)(process.execPath, ["--preserve-symlinks-main", join(current, "server/sync-admin.mjs"), "usage", "synthetic-unknown-user"], { env });
    assert.deepEqual(JSON.parse(usage.stdout), []);
    service.server.close(); await once(service.server, "close"); service = null;
    const snapshot = await promisify(execFile)(process.execPath, [join(current, "deploy/sync/backup-accounts.mjs"), accountDirectory, join(directory, "backups"), "--service-stopped"]);
    assert.equal(JSON.parse(await readFile(join(snapshot.stdout.trim(), "backup.json"), "utf8")).integrity, "ok");
  } finally {
    if (service) { service.server.close(); await once(service.server, "close"); }
    assert.ok(directory.includes("shixu-accounts-release-"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("release starts independently; two devices, restart, WAL backup and restored service work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-deploy-"));
  let service;
  try {
    const { directory: release } = await buildRelease(join(directory, "release"));
    const current = join(directory, "current");
    await symlink(release, current, process.platform === "win32" ? "junction" : "dir");
    for (const line of (await readFile(join(release, "SHA256SUMS"), "utf8")).trim().split("\n")) {
      const [hash, file] = line.split("  ");
      assert.equal(createHash("sha256").update(await readFile(join(release, file))).digest("hex"), hash);
    }
    assert.deepEqual((await readdir(release)).sort(), ["SHA256SUMS", "deploy", "release.json", "server"]);
    assert.deepEqual((await readdir(join(release, "server"))).sort(), ["accounts-v4.mjs", "generated", "originals.mjs", "reading", "sync-accounts.mjs", "sync-admin.mjs", "sync-files.mjs", "sync-jobs.mjs", "sync-multi-user.mjs", "sync-provider.mjs", "sync-server.mjs", "sync-store.mjs"]);
    assert.deepEqual((await readdir(join(release, "server/reading"))).sort(), ["archive-window.mjs", "archive.mjs", "chat.mjs", "cost-maintenance.mjs", "docx-reader.LICENSE", "docx-reader.cjs", "docx.mjs", "generated-native", "image.mjs", "jpeg-reader.LICENSE", "jpeg-reader.cjs", "jpeg.mjs", "ledger.mjs", "maintenance.mjs", "material.mjs", "native-archive.mjs", "ooxml-xml.mjs", "ooxml-zip.mjs", "pdf-api.mjs", "pdf-core.mjs", "pdf-reader.LICENSE", "pdf-window.mjs", "pdf.mjs", "reuse.mjs", "root-safety.mjs", "roots.mjs", "routes.mjs", "scheduler.mjs", "tasks.mjs", "time-maintenance.mjs", "windows.mjs", "xlsx-reader.LICENSE", "xlsx-reader.cjs", "xlsx.mjs"]);
    const { createSyncService } = await import(pathToFileURL(join(release, "server/sync-server.mjs")));
    const database = join(directory, "data", "workspace.sqlite");
    const password = "synthetic-deploy-password-only";
    const start = async (db) => {
      service = createSyncService({ database: db, password });
      service.server.listen(0, "127.0.0.1");
      await once(service.server, "listening");
      return `http://127.0.0.1:${service.server.address().port}`;
    };
    const stop = async () => { service.server.close(); await once(service.server, "close"); service = null; };
    let base = await start(database);
    // Restart on the same port so the HTTP probe traverses a real server restart.
    const port = service.server.address().port;
    const report = await verifyService(base, password, async () => {
      await stop();
      service = createSyncService({ database, password });
      service.server.listen(port, "127.0.0.1");
      await once(service.server, "listening");
    });
    assert.equal(report.restartPersistence, true);
    assert.equal(report.testDevicesRevoked, true);
    const sequence = service.store.sequence;
    const epoch = service.store.epoch;
    const snapshot = await backupDatabase(database, join(directory, "backups"));
    const db = new DatabaseSync(join(snapshot, "workspace.sqlite"), { readOnly: true });
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    assert.equal(Number(db.prepare("SELECT value FROM sync_meta WHERE key='sequence'").get().value), sequence);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_devices WHERE revoked=0").get().n, 0);
    db.close();
    const second = await backupDatabase(database, join(directory, "backups"));
    assert.notEqual(second, snapshot);
    const cliBackup = await promisify(execFile)(process.execPath, [
      join(current, "deploy/sync/backup.mjs"), database, join(directory, "cli-backup"),
    ]);
    assert.equal(JSON.parse(await readFile(join(cliBackup.stdout.trim(), "backup.json"), "utf8")).integrity, "ok");
    await stop();
    base = await start(join(snapshot, "workspace.sqlite"));
    const restored = await (await fetch(`${base}/api/v2/status`)).json();
    assert.equal(restored.epoch, epoch);
    assert.equal((await verifyService(base, password)).twoDevices, true);
    const cliProbe = await promisify(execFile)(process.execPath, [join(current, "deploy/sync/verify.mjs"), base], {
      env: { ...process.env, SYNC_PASSWORD: password },
    });
    assert.equal(JSON.parse(cliProbe.stdout).testDevicesRevoked, true);
    await stop();
    // Match systemd: chdir through current, then run a relative main script.
    const child = spawn(process.execPath, ["--preserve-symlinks-main", "server/sync-server.mjs"], {
      cwd: current, stdio: "pipe", env: { ...process.env, SYNC_PASSWORD: password,
        SYNC_HOST: "127.0.0.1", SYNC_PORT: String(port), SYNC_ORIGIN: `http://127.0.0.1:${port}`,
        SYNC_DATA_DIR: join(directory, "child-data") },
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v2/status`, { signal: AbortSignal.timeout(300) });
          ready = response.ok;
          if (ready) break;
        } catch {}
        if (child.exitCode !== null) break;
        await new Promise((done) => setTimeout(done, 50));
      }
      assert.equal(ready, true, "Packaged CLI must stay running through the current symlink");
    } finally {
      if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    }
    // Existing destinations must fail instead of mixing different snapshots.
    await assert.rejects(buildRelease(release), { code: "EEXIST" });
  } finally {
    if (service) { service.server.close(); await once(service.server, "close"); }
    await rm(directory, { recursive: true, force: true });
  }
});
