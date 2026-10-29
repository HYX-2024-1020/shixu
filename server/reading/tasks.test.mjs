import test from "node:test";
import { encodePng } from "./image.mjs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { ReadingTimeMaintenance } from "./time-maintenance.mjs";
import { ReadingMaintenance } from "./maintenance.mjs";
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import { xlsxBytes, inline } from "./xlsx-fixtures.mjs";
import { readingView } from "../../shared/reading-view.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
import { archiveSample, zipBytes } from "./archive-fixtures.mjs";
const result = (sources) => ({
  summary: "合成资料",
  warnings: [],
  items: [
    {
      kind: "note",
      title: "有依据的合成事项",
      summary: "合成摘要",
      facts: [],
      nextSteps: [],
      uncertainties: [],
      due: null,
      evidence: [
        { sourceId: sources[0].id, quote: sources[0].text.slice(0, 10) },
      ],
    },
  ],
});

test("older tenant timing cannot rewind the independent root watermark or resume paid work", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop", "watermark-stop");
  const before = f.tasks.roots.stats("task");
  assert.ok(before.activeMs > 0);
  // Synthetic rollback of safety metadata, never a real user's database.
  f.store.db
    .prepare("UPDATE reading_tasks SET active_ms=0 WHERE id='task'")
    .run();
  const restored = f.tasks.roots.stats("task");
  assert.ok(restored.activeMs >= before.activeMs);
  assert.equal(restored.reason, "SAFETY_RECONCILIATION");
  assert.throws(
    () => f.action("continue", "watermark-continue"),
    (e) => e.code === "SAFETY_RECONCILIATION",
  );
  assert.equal(f.calls(), 1);
});

test("missing tenant task rows cannot detach settled calls or invent a new root for the same packet", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop", "missing-stop");
  f.action("purge", "missing-purge");
  const spent = f.ledger.wallet("synthetic").spent;
  f.store.db.exec(
    "DELETE FROM reading_tasks; DELETE FROM reading_roots; DELETE FROM reading_root_progress; DELETE FROM reading_root_checkpoints;",
  );
  f.tasks.enqueue({
    id: "later",
    packetId: "packet",
    deviceId: f.windows.deviceId,
  });
  const stats = f.tasks.roots.stats("later");
  assert.equal(stats.id, "task");
  assert.equal(stats.calls, 1);
  assert.equal(stats.spent, spent);
  assert.equal(stats.reason, "SAFETY_RECONCILIATION");
  await f.tasks.run("later");
  assert.equal(f.calls(), 1);
});

test("failed independent execution registration cannot send a model request", async (t) => {
  const f = fixture(t);
  f.enqueue();
  const prepare = f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO reading_safe_steps"))
      throw Error("synthetic safety disk failure");
    return prepare(sql);
  };
  try {
    assert.equal((await f.tasks.run("task")).state, "paused");
  } finally {
    f.ledger.db.prepare = prepare;
  }
  assert.equal(f.calls(), 0);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_calls").get().n,
    0,
  );
});

test("a failed final safety write abandons local ownership and leaves a conservative execution fence", async (t) => {
  let fail = false;
  const f = fixture(t, {
    provider: async (sources) => {
      fail = true;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  f.enqueue();
  const prepare = f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare = (sql) => {
    if (fail && sql.startsWith("INSERT INTO reading_safe_events"))
      throw Error("synthetic final safety write failure");
    return prepare(sql);
  };
  try {
    await assert.rejects(
      f.tasks.run("task"),
      /synthetic final safety write failure/,
    );
  } finally {
    f.ledger.db.prepare = prepare;
  }
  assert.equal(
    f.tasks.roots.stats("task").reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
});
test("audited root time extension preserves paid blocks and counters across restart, without new credit or automatic work", async t => {
  const f=fixture(t);f.enqueue();await f.tasks.run("task");
  f.tasks.activeLimitMs=1;
  assert.equal((await f.tasks.run("task")).reason,"EXECUTION_LIMIT");
  const before=f.tasks.roots.stats("task"),spent=f.ledger.wallet("synthetic").spent;
  assert.throws(()=>new ReadingMaintenance(f.tasks),/MAINTENANCE_AUTHORITY_REQUIRED/);
  const maintenance=new ReadingMaintenance(f.tasks,({actor})=>actor==="synthetic-maintainer");
  assert.throws(()=>maintenance.preview("task","untrusted"),/MAINTENANCE_FORBIDDEN/);
  const preview=maintenance.preview("task","synthetic-maintainer");
  const request={operationId:"extend-one",expectedGeneration:preview.generation,expectedWatermark:preview.watermark,
    newLimitMs:before.activeMs+1000,evidenceHash:sha256("synthetic time audit, not user content")};
  assert.throws(()=>maintenance.extend("task",{...request,newLimitMs:0},"synthetic-maintainer"),/INVALID_MAINTENANCE_LIMIT/);
  const receipt=maintenance.extend("task",request,"synthetic-maintainer");
  assert.deepEqual(maintenance.extend("task",request,"synthetic-maintainer"),receipt);
  assert.throws(()=>maintenance.extend("task",{...request,newLimitMs:request.newLimitMs+1},"synthetic-maintainer"),/IDEMPOTENCY_CONFLICT/);
  assert.equal(f.calls(),1);assert.equal(f.ledger.wallet("synthetic").spent,spent);
  assert.equal(f.tasks.get("task").state,"paused");
  assert.throws(()=>f.ledger.db.exec("DELETE FROM reading_safe_limit_audits"),/SAFETY_APPEND_ONLY/);
  const secondReview=maintenance.preview("task","synthetic-maintainer");
  assert.throws(()=>maintenance.extend("task",{...request,operationId:"unneeded-second-audit",expectedWatermark:secondReview.watermark,
    newLimitMs:request.newLimitMs+1000},"synthetic-maintainer"),/EXECUTION_LIMIT_NOT_REACHED/);
  const actionRequest={operationId:"after-audit",expectedGeneration:f.tasks.get("task").generation,
    expectedRevision:f.tasks.get("task").input_revision,expectedMaintenanceOperation:receipt.operation};
  const tenantPrepare=f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare=sql=>{
    if(sql.startsWith("INSERT INTO reading_action_audits"))throw Error("synthetic action proof failure");
    return tenantPrepare(sql);
  };
  try{assert.throws(()=>f.tasks.action("task",actionRequest,"continue"),/synthetic action proof failure/);}
  finally{f.store.db.prepare=tenantPrepare;}
  assert.equal(f.tasks.get("task").state,"paused");
  assert.equal(f.tasks.get("task").generation,actionRequest.expectedGeneration);
  assert.equal(f.store.db.prepare("SELECT 1 FROM reading_actions WHERE operation='after-audit'").get(),undefined);
  f.tasks.close();
  const restarted=new ReadingTasks({...f.taskArgs,activeLimitMs:1});
  try {
    assert.equal(restarted.executionLimit("task"),request.newLimitMs);
    const current=restarted.get("task");
    assert.throws(()=>restarted.action("task",{operationId:"old-replay",expectedGeneration:current.generation,expectedRevision:current.input_revision},"continue"),e=>e.code==="STALE_TASK");
    const continued=restarted.action("task",actionRequest,"continue");
    assert.deepEqual({...restarted.action("task",actionRequest,"continue")},{...continued});
    assert.throws(()=>restarted.action("task",{...actionRequest,expectedMaintenanceOperation:null},"continue"),e=>e.code==="IDEMPOTENCY_CONFLICT");
    for(let n=0;n<5 && restarted.get("task").state==="queued";n++)await restarted.run("task");
    assert.equal(restarted.get("task").state,"done");assert.equal(f.calls(),1);
    assert.equal(f.ledger.wallet("synthetic").spent,spent);
    assert.ok(restarted.roots.stats("task").activeMs >= before.activeMs);
    assert.equal(restarted.roots.stats("task").calls,1);
  } finally {restarted.close();}
});

test("time audit rejects stale reviews and failed receipt writes without granting time or changing fees",async t=>{
  const f=fixture(t);f.enqueue();await f.tasks.run("task");f.tasks.activeLimitMs=1;await f.tasks.run("task");
  const maintenance=new ReadingMaintenance(f.tasks,()=>true),actor="synthetic-maintainer";
  const old=maintenance.preview("task",actor);
  const request={operationId:"audit-write-failure",expectedGeneration:old.generation,expectedWatermark:old.watermark,
    newLimitMs:old.activeMs+1000,evidenceHash:sha256("synthetic stale review")};
  f.store.db.prepare("UPDATE reading_tasks SET active_ms=active_ms+1 WHERE id='task'").run();
  const newer=maintenance.preview("task",actor);
  assert.throws(()=>maintenance.extend("task",request,actor),/STALE_MAINTENANCE_REVIEW/);
  const fresh={...request,expectedWatermark:newer.watermark};
  const prepare=f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare=sql=>{
    if(sql.startsWith("INSERT INTO reading_safe_limit_audits"))throw Error("synthetic receipt disk failure");
    return prepare(sql);
  };
  try{assert.throws(()=>maintenance.extend("task",fresh,actor),/synthetic receipt disk failure/);}
  finally{f.ledger.db.prepare=prepare;}
  assert.equal(f.tasks.executionLimit("task"),1);
  assert.equal(f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_safe_limit_audits").get().n,0);
  assert.equal(f.ledger.wallet("synthetic").spent,20);
  maintenance.extend("task",fresh,actor);
  assert.equal(f.tasks.executionLimit("task"),fresh.newLimitMs);assert.equal(f.calls(),1);
});

test("time audits cannot clear unknown fees, unknown active time or tenant rollback gates",async t=>{
  for(const kind of ["cost","time","rollback"]){
    const f=fixture(t,kind==="cost"?{provider:async()=>{throw Error("synthetic network unknown");}}
      :kind==="time"?{reader:async()=>{throw Object.assign(Error("READING_CANCEL_UNCONFIRMED"),{timingUncertain:true});}}:{});
    f.enqueue();await f.tasks.run("task");f.tasks.activeLimitMs=1;
    if(kind==="rollback"){
      f.action("stop","rollback-before-audit");
      f.store.db.prepare("UPDATE reading_tasks SET active_ms=0 WHERE id='task'").run();
    }
    const maintenance=new ReadingMaintenance(f.tasks,()=>true),review=maintenance.preview("task","synthetic-maintainer");
    const risk=f.ledger.wallet("synthetic").unknownRisk;
    assert.throws(()=>maintenance.extend("task",{operationId:"no-unknown-bypass",expectedGeneration:review.generation,
      expectedWatermark:review.watermark,newLimitMs:review.activeMs+1000,evidenceHash:sha256("synthetic rejected audit")},"synthetic-maintainer"),
      kind==="cost"?/UNKNOWN_COST/:/RECONCILIATION_REQUIRED/);
    assert.equal(f.tasks.executionLimit("task"),1);assert.equal(f.ledger.wallet("synthetic").unknownRisk,risk);
    assert.equal(f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_safe_limit_audits").get().n,0);
  }
});

test("a trusted time audit cannot extend an in-flight step or cause an additional call",async t=>{
  let release,enter;
  const entered=new Promise(resolve=>enter=resolve);
  const f=fixture(t,{reader:file=>new Promise(resolve=>{enter();release=()=>resolve(readMaterial(file));})});
  f.enqueue();const pending=f.tasks.run("task");await entered;
  const maintenance=new ReadingMaintenance(f.tasks,()=>true),review=maintenance.preview("task","synthetic-maintainer");
  assert.throws(()=>maintenance.extend("task",{operationId:"no-live-extension",expectedGeneration:review.generation,
    expectedWatermark:review.watermark,newLimitMs:3600000,evidenceHash:sha256("synthetic rejected live audit")},"synthetic-maintainer"),/TASK_STILL_DRAINING/);
  assert.equal(f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_safe_limit_audits").get().n,0);
  release();await pending;assert.equal(f.calls(),1);
});

function fixture(
  t,
  {
    text = "原件实际内容和要求",
    name = "合成.txt",
    provider,
    reader = async (f) => readMaterial(f),
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-reading-task-"));
  const store = new SyncStore(join(directory, "tenant.sqlite"));
  createAttachmentStore(store);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.grantInitial("synthetic");
  ledger.freezePrice({
    id: "fixture",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic, not a live price",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  const windows = store.createDevice("Windows source synthetic"),
    wechat = store.createDevice("WeChat logical synthetic");
  const put = (data, internal) =>
    store.apply(
      windows.deviceId,
      {
        id: "packet",
        opId: crypto.randomUUID(),
        type: "put",
        baseVersion: store.record("packet")?.version || 0,
        data,
      },
      store.epoch,
      internal,
    );
  put({
    text: "",
    sources: [{ id: "forged", name: "伪造", text: "不要相信这个客户端正文" }],
    attachments: [],
    captureDate: "2026-10-28",
    status: "pending",
    result: null,
  });
  const attachment = store.files.put("packet", "a", {
    name,
    body: Buffer.from(text),
    type: "text/plain",
    epoch: store.epoch,
  });
  put({ attachments: [attachment] });
  let calls = 0;
  const taskArgs = {
    store,
    ledger,
    account: "synthetic",
    reader,
    priceId: "fixture",
    modelVersion: "synthetic/1",
    authorize: (id) => {
      if (
        !store.db
          .prepare("SELECT 1 FROM sync_devices WHERE id=? AND revoked=0")
          .get(id)
      )
        throw Error("UNAUTHORIZED");
    },
    provider: async (sources, signal) => {
      calls++;
      return provider
        ? provider(sources, signal, calls)
        : {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: result(sources),
          };
    },
  };
  const tasks = new ReadingTasks(taskArgs);
  t.after(() => {
    tasks.close();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const enqueue = () =>
    tasks.enqueue({
      id: "task",
      packetId: "packet",
      deviceId: windows.deviceId,
    });
  const action = (action, id = "action") => {
    const current = tasks.get("task");
    return tasks.action(
      "task",
      {
        operationId: id,
        expectedGeneration: current.generation,
        expectedRevision: current.input_revision,
      },
      action,
    );
  };
  return {
    store,
    ledger,
    tasks,
    taskArgs,
    directory,
    put,
    enqueue,
    action,
    windows,
    wechat,
    calls: () => calls,
  };
}
async function finish(tasks) {
  for (let i = 0; i < 12; i++) {
    const task = await tasks.run("task");
    if (task.state !== "queued") return task;
  }
  throw Error("UNEXPECTED_NO_PROGRESS");
}

test("editing packet text revalidates and reuses unchanged paid ZIP blocks across revisions", async (t) => {
  const sample = archiveSample({ long: true });
  let parses = 0;
  const f = fixture(t, { name: sample.name, text: sample.body, reader: async file => { parses++; return readMaterial(file); } });
  f.enqueue();
  assert.equal((await finish(f.tasks)).state, "done");
  const previousCalls = f.calls(), previousSpent = f.ledger.wallet("synthetic").spent;
  f.put({ text: "补充新的材料要求" });
  f.tasks.enqueue({ id: "revised", packetId: "packet", deviceId: f.wechat.deviceId });
  for (let i = 0; i < 15 && f.tasks.get("revised").state === "queued"; i++) await f.tasks.run("revised");
  assert.equal(f.tasks.get("revised").state, "done");
  assert.equal(f.calls(), previousCalls + 1, "unchanged ZIP must not be charged again");
  assert.equal(f.ledger.wallet("synthetic").spent, previousSpent + 20);
  assert.ok(parses >= 3, "current text and ZIP bytes are actually read again");
  assert.equal(f.tasks.reuse.count("revised"), previousCalls);
  assert.equal(f.tasks.roots.stats("revised").calls, previousCalls + 1);
  assert.equal(f.tasks.roots.stats("revised").completed, previousCalls + 1);
  f.tasks.close();
  const restarted = new ReadingTasks(f.taskArgs);
  assert.equal(restarted.reuse.count("revised"), previousCalls);
  assert.equal(restarted.roots.stats("revised").completed, previousCalls + 1,
    "restart cannot count borrowed results as new root progress");
  restarted.close();
});

for (const mismatch of ["date", "model", "output", "hash", "purged", "legacy", "reader", "certificate", "quote", "call"])
  test(`cross-revision reuse rejects ${mismatch} mismatch`, async t => {
    const f = fixture(t, { text: "可信原件内容与尾部", name: "材料.txt" });
    f.enqueue();
    assert.equal((await finish(f.tasks)).state, "done");
    if (mismatch === "date") f.put({ captureDate: "2026-10-29" });
    if (mismatch === "model") f.tasks.modelVersion = "synthetic/changed";
    if (mismatch === "output") f.tasks.maxOutputTokens = 3000;
    if (mismatch === "legacy") f.store.db.exec("DELETE FROM reading_reuse_keys");
    if (mismatch === "reader") f.tasks.reader = async file => ({ ...(await readMaterial(file)), readerVersion: "changed-reader/1" });
    if (mismatch === "hash") {
      const changed = f.store.files.put("packet", "different", { name: "材料.txt", body: Buffer.from("可信原件内容与改变的尾部"), type: "text/plain", epoch: f.store.epoch });
      f.put({ attachments: [{ ...f.store.record("packet").data.attachments[0], deletedAt: "2026-10-28T01:00:00Z" }, changed] });
    }
    if (mismatch === "purged") f.action("purge");
    if (mismatch === "certificate") f.store.db.prepare("UPDATE reading_reuse_keys SET result_hash='invalid'").run();
    if (mismatch === "quote") {
      const row = f.store.db.prepare("SELECT * FROM reading_blocks").get();
      const result = JSON.parse(row.result);
      result.items[0].evidence[0].quote = "不在当前来源的引用";
      const body = JSON.stringify(result);
      f.store.db.prepare("UPDATE reading_blocks SET result=?").run(body);
      f.store.db.prepare("UPDATE reading_reuse_keys SET result_hash=?").run(sha256(body));
    }
    if (mismatch === "call") f.store.db.prepare("UPDATE reading_blocks SET call_id='absent'").run();
    f.tasks.enqueue({ id: "different", packetId: "packet", deviceId: f.windows.deviceId });
    for (let i = 0; i < 5 && f.tasks.get("different").state === "queued"; i++) await f.tasks.run("different");
    assert.equal(f.tasks.get("different").state, "done");
    assert.equal(f.tasks.reuse.count("different"), 0);
    assert.equal(f.calls(), 2);
  });

test("unknown fees and root reconciliation cannot be bypassed by fully reusable results", async t => {
  for (const mode of ["unknown", "root"]) {
    const f = fixture(t);
    f.enqueue();
    await finish(f.tasks);
    if (mode === "unknown") {
      f.ledger.reserve({ callId: "unknown", account: "synthetic", task: "task", block: "uncertain", generation: 1,
        priceId: "fixture", maxPromptTokens: 10, maxOutputTokens: 10 });
      f.ledger.sent("unknown"); f.ledger.unknown("unknown");
    } else f.tasks.roots.block("task", "ACTIVE_TIME_RECONCILIATION");
    f.tasks.enqueue({ id: "next", packetId: "packet", deviceId: f.wechat.deviceId });
    assert.equal((await f.tasks.run("next")).reason, mode === "unknown" ? "UNKNOWN_COST" : "ACTIVE_TIME_RECONCILIATION");
    assert.equal(f.tasks.reuse.count("next"), 0);
    assert.equal(f.calls(), 1);
  }
});

test("paid results cannot cross packets or stand in for missing original bytes", async t => {
  const f = fixture(t);
  f.enqueue(); await finish(f.tasks);
  const data = f.store.record("packet").data;
  const original = f.store.files.get("packet", "a");
  const put = patch => f.store.apply(f.windows.deviceId, { id: "other", opId: crypto.randomUUID(), type: "put",
    baseVersion: f.store.record("other")?.version || 0, data: patch }, f.store.epoch);
  put({ id: "other", text: data.text, captureDate: data.captureDate,
    attachments: [], result: null, sources: [], status: "pending" });
  const file = f.store.files.put("other", "a", { name: original.name, body: original.body, type: original.type, epoch: f.store.epoch });
  put({ attachments: [file] });
  f.tasks.enqueue({ id: "other-task", packetId: "other", deviceId: f.wechat.deviceId });
  for (let i = 0; i < 5 && f.tasks.get("other-task").state === "queued"; i++) await f.tasks.run("other-task");
  assert.equal(f.tasks.get("other-task").state, "done");
  assert.equal(f.tasks.reuse.count("other-task"), 0);
  assert.equal(f.calls(), 2);
  f.store.files.purge("packet");
  assert.throws(() => f.tasks.enqueue({ id: "missing", packetId: "packet", deviceId: f.windows.deviceId }),
    e => e.code === "REUPLOAD_REQUIRED");
  assert.equal(f.calls(), 2);
});

test("changing capture date invalidates same-task continuation before old relative dates can be reused", async t => {
  const f = fixture(t, { text: "明天交报告。".repeat(30000) });
  f.enqueue(); await f.tasks.run("task");
  f.action("stop");
  f.put({ captureDate: "2026-10-29" });
  assert.throws(() => f.action("continue", "changed-day"), e => e.code === "INPUT_CHANGED");
  assert.equal(f.calls(), 1);
});

test("reuse receipt failure rolls back block/range writes and retries without a new charge", async t => {
  const f = fixture(t);
  f.enqueue(); await finish(f.tasks);
  f.tasks.enqueue({ id: "next", packetId: "packet", deviceId: f.wechat.deviceId });
  const prepare = f.store.db.prepare.bind(f.store.db);
  f.store.db.prepare = sql => {
    if (sql.startsWith("INSERT INTO reading_reused_blocks")) throw Error("synthetic receipt failure");
    return prepare(sql);
  };
  try { assert.equal((await f.tasks.run("next")).state, "paused"); }
  finally { f.store.db.prepare = prepare; }
  assert.equal(prepare("SELECT COUNT(*) n FROM reading_blocks WHERE task='next'").get().n, 0);
  assert.equal(prepare("SELECT COUNT(*) n FROM reading_block_ranges WHERE task='next'").get().n, 0);
  assert.equal(f.calls(), 1);
  const current = f.tasks.get("next");
  f.tasks.action("next", { operationId: "recover-receipt", expectedGeneration: current.generation,
    expectedRevision: current.input_revision }, "continue", f.wechat.deviceId);
  for (let i = 0; i < 5 && f.tasks.get("next").state === "queued"; i++) await f.tasks.run("next");
  assert.equal(f.tasks.get("next").state, "done");
  assert.equal(f.tasks.reuse.count("next"), 1);
  assert.equal(f.calls(), 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
});

test("ZIP paid block survives stop/resume without duplicate consumption and passes package paths to the provider", async (t) => {
  const sample = archiveSample({ long: true });
  const seen = [];
  const f = fixture(t, { name: sample.name, text: sample.body,
    provider: async (sources) => {
      seen.push(...sources);
      return { usage: { prompt_tokens: 10, completion_tokens: 10 }, result: result(sources) };
    } });
  f.enqueue();
  await f.tasks.run("task");
  const paid = f.ledger.wallet("synthetic").spent;
  assert.equal(f.calls(), 1);
  f.action("stop");
  f.action("continue", "resume");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.ok(seen.every(s => s.name.startsWith("包内 ")));
  assert.equal(seen.map(s => s.text).join(""), sample.expectedText);
  assert.equal(f.ledger.wallet("synthetic").spent, f.calls() * paid);
  assert.ok(!JSON.stringify(f.tasks.get("task")).includes("归档课程材料"));
});

test("ZIP partial acceptance retains unprocessed paths; unsafe archive sends no model call", async (t) => {
  const sample = archiveSample({ long: true });
  const f = fixture(t, { name: sample.name, text: sample.body });
  f.enqueue();
  await f.tasks.run("task");
  f.tasks.activeLimitMs = 1;
  assert.equal((await f.tasks.run("task")).reason, "EXECUTION_LIMIT");
  assert.equal(f.action("accept-partial", "accept").state, "partial");
  const packet = f.store.record("packet").data;
  assert.ok(packet.processingCoverage.pending.some(r => r.archivePath === "尾部.txt"));
  assert.match(readingView(packet.readingCoverage)[0].missing, /嵌套归档/);
  assert.equal(f.calls(), 1);
  const bad = fixture(t, { name: "危险.zip", text: zipBytes({ "../escape.txt": "never" }) });
  bad.enqueue();
  assert.equal((await finish(bad.tasks)).reason, "NO_READABLE_MATERIAL");
  assert.equal(bad.calls(), 0);
  assert.equal(bad.ledger.wallet("synthetic").spent, 0);
});

test("PDF partial pages publish with real page coordinates; empty PDF never incurs provider cost", async (t) => {
  const f = fixture(t, {
    name: "合成.pdf",
    text: pdfBytes([
      { text: "中文😀来源" },
      { text: "" },
      { text: "尾部唯一标记", rotation: 270 },
    ]),
  });
  f.enqueue();
  assert.equal((await finish(f.tasks)).state, "done");
  const c = f.store.record("packet").data.readingCoverage[0];
  assert.equal(c.state, "partial");
  assert.deepEqual(
    c.covered.map((r) => r.page),
    [1, 3],
  );
  assert.match(readingView([c])[0].missing, /第 2 页/);
  const empty = fixture(t, { name: "空.pdf", text: pdfBytes([{ text: "" }]) });
  empty.enqueue();
  assert.equal((await finish(empty.tasks)).reason, "NO_READABLE_MATERIAL");
  assert.equal(empty.calls(), 0);
});

test("only proven broker admission rejection retries twice; exhausted, unknown and parser failures do not send models", async (t) => {
  for (const mode of ["recover", "exhausted", "unknown", "parser"]) {
    let attempts = 0;
    const f = fixture(t, {
      reader: async (file) => {
        attempts++;
        if (mode === "recover" && attempts === 3) return readMaterial(file);
        throw Object.assign(
          Error(
            mode === "parser"
              ? "ISOLATED_READING_FAILED"
              : "READING_QUEUE_FULL",
          ),
          {
            notExecuted: mode !== "unknown",
            timing: { waitingMs: 0 },
          },
        );
      },
    });
    f.enqueue();
    await finish(f.tasks);
    assert.equal(
      attempts,
      ["recover", "exhausted"].includes(mode) ? 3 : 1,
      mode,
    );
    assert.equal(f.calls(), mode === "recover" ? 1 : 0, mode);
    assert.equal(
      JSON.parse(f.tasks.get("task").coverage)[0].readRetries,
      mode === "recover" || mode === "exhausted" ? 2 : 0,
    );
  }
});

test("stopping during admission backoff prevents a retry; backoff cannot exceed the root deadline", async (t) => {
  for (const stop of [true, false]) {
    let attempts = 0,
      entered;
    const first = new Promise((resolve) => (entered = resolve));
    const f = fixture(t, {
      reader: async () => {
        attempts++;
        entered();
        throw Object.assign(Error("READING_QUEUE_FULL"), {
          notExecuted: true,
          timing: { waitingMs: 0 },
        });
      },
    });
    if (!stop) f.tasks.activeLimitMs = 30;
    f.enqueue();
    const pending = f.tasks.run("task");
    await first;
    if (stop) f.action("stop");
    const final = await pending;
    assert.equal(final.state, stop ? "cancelled" : "paused");
    if (!stop) assert.equal(final.reason, "EXECUTION_LIMIT");
    assert.equal(attempts, 1);
    assert.equal(f.calls(), 0);
  }
});

test("empty/unreadable XLSX has no provider cost; partial worksheet rows retain exact source coordinates at publication", async (t) => {
  const empty = fixture(t, {
    name: "空.xlsx",
    text: xlsxBytes([
      { name: "空表", xml: `<row r="1">${inline("A1", " ")}</row>` },
    ]),
  });
  empty.enqueue();
  assert.equal((await finish(empty.tasks)).reason, "NO_READABLE_MATERIAL");
  assert.equal(empty.calls(), 0);
  assert.equal(empty.ledger.wallet("synthetic").spent, 0);
  const partial = fixture(t, {
    name: "合成.xlsx",
    text: xlsxBytes([
      {
        name: "安全表",
        xml: `<row r="1">${inline("A1", "安全资料")}</row><row r="7"><c r="B7"><f>1+1</f><v>999</v></c></row>`,
      },
    ]),
  });
  partial.enqueue();
  assert.equal((await finish(partial.tasks)).state, "done");
  const coverage = partial.store.record("packet").data.readingCoverage[0];
  assert.equal(coverage.state, "partial");
  assert.ok(
    coverage.covered.some(
      (r) => r.sheet === "安全表" && r.row === 7 && r.column === 2,
    ),
  );
  assert.ok(
    coverage.uncovered.some(
      (r) => r.code === "XLSX_FORMULA_CACHED" && r.cell === "B7",
    ),
  );
});

test("orderly shutdown interrupts queued tasks durably without consuming or automatically restarting them", (t) => {
  const f = fixture(t);
  f.enqueue();
  f.tasks.close();
  const restarted = new ReadingTasks(f.taskArgs);
  assert.equal(restarted.get("task").state, "interrupted");
  assert.equal(restarted.get("task").reason, "SHUTDOWN");
  assert.equal(f.calls(), 0);
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
  restarted.close();
});

for (const rejects of [false, true]) {
  test(`shutdown finalization preserves unknown cost and discards a late ${rejects ? "failure" : "success"} without accessing closed databases`, async (t) => {
    let release, entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const f = fixture(t, {
      provider: async (sources) => {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
        if (rejects) throw Error("late synthetic failure");
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: result(sources),
        };
      },
    });
    f.enqueue();
    const pending = f.tasks.run("task");
    await started;
    f.tasks.close();
    f.tasks.finalizeShutdown();
    assert.equal(f.tasks.get("task").state, "interrupted");
    assert.equal(f.tasks.get("task").reason, "SHUTDOWN_TIMEOUT");
    assert.equal(
      f.ledger.db.prepare("SELECT state FROM reading_calls").get().state,
      "unknown",
    );
    assert.throws(
      () => f.action("continue"),
      (e) => e.code === "SERVICE_CLOSING",
    );
    const restarted = new ReadingTasks(f.taskArgs);
    const task = restarted.get("task");
    assert.throws(
      () =>
        restarted.action(
          "task",
          {
            operationId: "restart",
            expectedGeneration: task.generation,
            expectedRevision: task.input_revision,
          },
          "continue",
        ),
      (e) => e.code === "ACTIVE_TIME_RECONCILIATION",
    );
    assert.ok(f.ledger.wallet("synthetic").unknownRisk > 0);
    restarted.close();
    assert.equal(f.store.record("packet").data.result, null);
    // Throwing DB entry points represent stores already closed by the host.
    const tenantPrepare = f.store.db.prepare,
      ledgerPrepare = f.ledger.db.prepare;
    f.store.db.prepare = f.ledger.db.prepare = () => {
      throw Error("DATABASE_ALREADY_CLOSED");
    };
    try {
      release();
      assert.equal((await pending).state, "interrupted");
    } finally {
      f.store.db.prepare = tenantPrepare;
      f.ledger.db.prepare = ledgerPrepare;
    }
    assert.equal(f.ledger.audit().valid, true);
    assert.equal(
      f.ledger.db.prepare("SELECT state FROM reading_calls").get().state,
      "unknown",
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
      0,
    );
  });
}

test("a reader that outlives shutdown cannot publish and needs active-time reconciliation before continuing", async (t) => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture(t, {
    reader: async (file) => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      return { ...readMaterial(file), timing: { waitingMs: 100 } };
    },
  });
  f.enqueue();
  const pending = f.tasks.run("task");
  await started;
  f.tasks.finalizeShutdown();
  assert.equal(f.tasks.get("task").reason, "SHUTDOWN_TIME_UNCERTAIN");
  const restarted = new ReadingTasks(f.taskArgs);
  const task = restarted.get("task");
  assert.throws(
    () =>
      restarted.action(
        "task",
        {
          operationId: "restart",
          expectedGeneration: task.generation,
          expectedRevision: task.input_revision,
        },
        "continue",
      ),
    (e) => e.code === "ACTIVE_TIME_RECONCILIATION",
  );
  restarted.close();
  release();
  await pending;
  assert.equal(f.calls(), 0);
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
  assert.equal(f.store.record("packet").data.result, null);
});

test("another authorized device can accept paid partial blocks atomically; purge cannot refund or resurrect them", async (t) => {
  const f = fixture(t, {
    text: "合成材料正文".repeat(45000),
    provider: async (sources, signal, n) => {
      if (n === 2) throw Error("synthetic timeout");
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  f.enqueue();
  await f.tasks.run("task");
  await f.tasks.run("task");
  const task = f.tasks.get("task");
  assert.equal(task.state, "paused");
  const request = {
    operationId: "accept",
    expectedGeneration: task.generation,
    expectedRevision: task.input_revision,
  };
  const response = f.tasks.action(
    "task",
    request,
    "accept-partial",
    f.wechat.deviceId,
  );
  assert.equal(response.state, "partial");
  assert.deepEqual(
    f.tasks.action("task", request, "accept-partial", f.wechat.deviceId),
    { ...response },
  );
  assert.equal(f.store.record("packet").data.processingCoverage.partial, true);
  assert.ok(
    f.store.record("packet").data.processingCoverage.pending.length > 0,
  );
  assert.ok(
    f.store.record("packet").data.processingCoverage.processed.length > 0,
  );
  const spent = f.ledger.wallet("synthetic").spent;
  const purged = f.tasks.action(
    "task",
    {
      operationId: "purge",
      expectedGeneration: response.generation,
      expectedRevision: response.input_revision,
    },
    "purge",
    f.wechat.deviceId,
  );
  assert.equal(purged.state, "purged");
  assert.equal(f.ledger.wallet("synthetic").spent, spent);
  assert.equal(f.store.record("packet").data.result.items.length, 1);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
    0,
  );
  assert.throws(
    () => f.action("continue", "after-purge"),
    (e) => e.code === "INVALID_TASK_TRANSITION",
  );
});

test("24-call checkpoint records progress and does not cap a longer task", async (t) => {
  const f = fixture(t, { text: "合成正文".repeat(810000) });
  f.enqueue();
  let task;
  for (let i = 0; i < 35; i++) {
    task = await f.tasks.run("task");
    if (task.state !== "queued") break;
  }
  assert.equal(task.state, "done");
  assert.ok(f.calls() > 24);
  const checkpoint = f.store.db
    .prepare("SELECT * FROM reading_root_checkpoints")
    .get();
  assert.equal(checkpoint.calls, 24);
  assert.equal(checkpoint.completed, 24);
  assert.ok(checkpoint.spent > 0);
});

test("a no-progress checkpoint remains paused across repeated manual continue, without new calls", async (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db.prepare("UPDATE reading_tasks SET calls=24 WHERE id='task'").run();
  assert.equal((await f.tasks.run("task")).reason, "CHECKPOINT_NO_PROGRESS");
  f.action("continue", "retry-checkpoint");
  assert.equal((await f.tasks.run("task")).reason, "CHECKPOINT_NO_PROGRESS");
  assert.equal(f.calls(), 0);
});

test("24 invalid paid calls across new task IDs keep one root checkpoint after purge; a new packet has its own root", async (t) => {
  const f = fixture(t, {
    provider: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: null,
    }),
  });
  const create = (id) =>
    f.tasks.enqueue({ id, packetId: "packet", deviceId: f.windows.deviceId });
  const purge = (id) => {
    const task = f.tasks.get(id);
    return f.tasks.action(
      id,
      {
        operationId: "purge_" + id,
        expectedGeneration: task.generation,
        expectedRevision: task.input_revision,
      },
      "purge",
    );
  };
  for (let n = 0; n < 24; n++) {
    const id = "retry_" + n;
    create(id);
    assert.equal((await f.tasks.run(id)).state, "paused");
    purge(id);
  }
  assert.equal(f.calls(), 24);
  const root = f.tasks.roots.stats("retry_23");
  assert.equal(root.id, "retry_0");
  assert.equal(root.calls, 24);
  assert.equal(root.completed, 0);
  assert.equal(root.checkpointCalls, 24);
  assert.equal(root.reason, "CHECKPOINT_NO_PROGRESS");
  assert.equal(root.spent, f.ledger.wallet("synthetic").spent);
  create("retry_24");
  assert.equal(
    (await f.tasks.run("retry_24")).reason,
    "CHECKPOINT_NO_PROGRESS",
  );
  assert.equal(f.calls(), 24);
  purge("retry_24");
  f.store.apply(
    f.windows.deviceId,
    {
      id: "another_packet",
      opId: "another_packet",
      type: "put",
      baseVersion: 0,
      data: {
        text: "明确另一次投递",
        attachments: [],
        captureDate: "2026-10-28",
      },
    },
    f.store.epoch,
  );
  f.tasks.enqueue({
    id: "another_task",
    packetId: "another_packet",
    deviceId: f.windows.deviceId,
  });
  assert.equal(f.tasks.roots.stats("another_task").calls, 0);
  assert.equal(f.tasks.roots.stats("another_task").id, "another_task");
  await f.tasks.run("another_task");
  assert.equal(f.calls(), 25);
  assert.equal(f.ledger.wallet("synthetic").spent, root.spent + 20);
});

test("root active time and unverified reader time survive task purge and edited-input retry", async (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db
    .prepare("UPDATE reading_tasks SET active_ms=1800000 WHERE id='task'")
    .run();
  f.action("purge", "purge_old");
  f.put({ text: "暂停后修改正文" });
  f.tasks.enqueue({
    id: "next",
    packetId: "packet",
    deviceId: f.windows.deviceId,
  });
  assert.equal((await f.tasks.run("next")).reason, "EXECUTION_LIMIT");
  assert.equal(f.calls(), 0);
  assert.equal(f.tasks.roots.stats("next").id, "task");
  f.tasks.roots.block("next", "ACTIVE_TIME_RECONCILIATION");
  const task = f.tasks.get("next");
  f.tasks.action(
    "next",
    {
      operationId: "purge_next",
      expectedGeneration: task.generation,
      expectedRevision: task.input_revision,
    },
    "purge",
  );
  f.tasks.enqueue({
    id: "third",
    packetId: "packet",
    deviceId: f.windows.deviceId,
  });
  assert.equal(
    (await f.tasks.run("third")).reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  assert.equal(f.calls(), 0);
});

test("legacy root upgrade is idempotent, preserves paid progress, and requires audit for historical 24-call intervals", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop", "before_upgrade");
  f.store.db.prepare("UPDATE reading_tasks SET calls=24 WHERE id='task'").run();
  f.store.db.exec(
    "DROP TABLE reading_root_checkpoints; DROP TABLE reading_root_progress; DROP TABLE reading_roots",
  );
  const upgraded = new ReadingTasks(f.taskArgs);
  const root = upgraded.roots.stats("task");
  assert.equal(root.reason, "CHECKPOINT_RECONCILIATION");
  assert.equal(root.calls, 24);
  assert.equal(root.completed, 1);
  const twice = new ReadingTasks(f.taskArgs);
  assert.deepEqual(twice.roots.stats("task"), root);
  upgraded.close();
  twice.close();
});

test("crash-persisted running work cannot lose its unrecorded active interval by restarting or creating a new task", (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db
    .prepare(
      "UPDATE reading_tasks SET state='running',active_ms=12 WHERE id='task'",
    )
    .run();
  const restarted = new ReadingTasks(f.taskArgs);
  assert.equal(restarted.get("task").state, "interrupted");
  assert.equal(
    restarted.roots.stats("task").reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  const task = restarted.get("task");
  assert.throws(
    () =>
      restarted.action(
        "task",
        {
          operationId: "crash_continue",
          expectedGeneration: task.generation,
          expectedRevision: task.input_revision,
        },
        "continue",
      ),
    (e) => e.code === "ACTIVE_TIME_RECONCILIATION",
  );
  restarted.close();
});

test("cleared originals require a matching reupload before paid blocks can resume", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop", "before-clear");
  const original = f.store.files.get("packet", "a");
  f.store.files.purge("packet");
  assert.throws(
    () => f.action("continue", "missing-original"),
    (e) => e.code === "REUPLOAD_REQUIRED",
  );
  f.store.files.put("packet", "a", {
    name: original.name,
    type: original.type,
    body: original.body,
    epoch: f.store.epoch,
  });
  f.action("continue", "matching-reupload");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
});

test("broker queue time is excluded and a provider step obeys the remaining cumulative active deadline", async (t) => {
  const f = fixture(t, {
    reader: async (file, { onPhase }) => {
      onPhase({ phase: "queued" });
      await new Promise((done) => setTimeout(done, 450));
      onPhase({ phase: "active", waitingMs: 440 });
      return { ...readMaterial(file), timing: { waitingMs: 440 } };
    },
  });
  f.tasks.activeLimitMs = 300;
  f.enqueue();
  assert.equal((await f.tasks.run("task")).state, "queued");
  assert.ok(f.tasks.get("task").active_ms < 300);
  const g = fixture(t, {
    provider: async (sources, signal) =>
      new Promise((done, reject) => {
        const timer = setTimeout(
          () => reject(Error("failed to enforce deadline")),
          1000,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Error("abort"));
          },
          { once: true },
        );
      }),
  });
  g.tasks.activeLimitMs = 80;
  g.enqueue();
  g.store.db
    .prepare("UPDATE reading_tasks SET active_ms=40 WHERE id='task'")
    .run();
  const start = performance.now();
  assert.equal((await g.tasks.run("task")).reason, "UNKNOWN_COST");
  assert.ok(performance.now() - start < 600);
});
test("failed and cancelled queued reads exclude confirmed wait, retain exact failure coverage and incur no model cost", async (t) => {
  for (const stopped of [false, true]) {
    let entered;
    const queued = new Promise((resolve) => {
      entered = resolve;
    });
    const f = fixture(t, {
      reader: async (file, { signal, onPhase }) => {
        const at = performance.now();
        onPhase({ phase: "queued" });
        entered();
        if (stopped)
          await new Promise((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
        else await new Promise((resolve) => setTimeout(resolve, 140));
        throw Object.assign(
          Error(stopped ? "READING_ABORTED" : "ISOLATED_READING_FAILED"),
          { timing: { waitingMs: performance.now() - at } },
        );
      },
    });
    f.tasks.activeLimitMs = 60;
    f.enqueue();
    const running = f.tasks.run("task");
    await queued;
    if (stopped) {
      await new Promise((resolve) => setTimeout(resolve, 140));
      f.action("stop");
    }
    const result = await running;
    assert.equal(result.state, stopped ? "cancelled" : "paused");
    if (!stopped) assert.equal(result.reason, "NO_READABLE_MATERIAL");
    assert.ok(f.tasks.get("task").active_ms < 60);
    assert.equal(f.calls(), 0);
    assert.equal(f.tasks.roots.stats("task").reason, "");
    if (!stopped) assert.equal(JSON.parse(result.coverage)[0].state, "failed");
  }
});

test("the remaining root deadline bounds an uncooperative read and discards its late output before model or publication", async (t) => {
  let release;
  const f = fixture(t, {
    reader: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  f.tasks.activeLimitMs = 80;
  f.tasks.readerDrainMs = 20;
  f.enqueue();
  f.store.db
    .prepare("UPDATE reading_tasks SET active_ms=45 WHERE id='task'")
    .run();
  const at = performance.now();
  assert.equal((await f.tasks.run("task")).reason, "EXECUTION_LIMIT");
  assert.ok(performance.now() - at < 500);
  release(readMaterial(f.store.files.get("packet", "a")));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls(), 0);
  assert.equal(f.store.record("packet").data.result, null);
  assert.ok(f.tasks.roots.stats("task").activeMs >= 80);
  assert.throws(
    () => f.action("continue", "after-limit"),
    (error) => error.code === "EXECUTION_LIMIT",
  );
  f.action("purge");
  f.tasks.enqueue({
    id: "replacement",
    packetId: "packet",
    deviceId: f.windows.deviceId,
  });
  assert.equal((await f.tasks.run("replacement")).reason, "EXECUTION_LIMIT");
});

test("unconfirmed queue cancellation blocks the root through purge and later task IDs", async (t) => {
  let entered;
  const queued = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture(t, {
    reader: (file, { onPhase }) => {
      onPhase({ phase: "queued" });
      entered();
      return new Promise(() => {});
    },
  });
  f.tasks.readerDrainMs = 20;
  f.enqueue();
  const running = f.tasks.run("task");
  await queued;
  f.action("stop");
  await running;
  assert.equal(
    f.tasks.roots.stats("task").reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  f.action("purge", "purge-after-stop");
  f.tasks.enqueue({
    id: "replacement",
    packetId: "packet",
    deviceId: f.windows.deviceId,
  });
  assert.equal(
    (await f.tasks.run("replacement")).reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  assert.equal(f.calls(), 0);
});

test("invalid queue timing fails closed rather than granting negative active time", async (t) => {
  const f = fixture(t, {
    reader: async (file) => ({
      ...readMaterial(file),
      timing: { waitingMs: 1000000 },
    }),
  });
  f.enqueue();
  assert.equal(
    (await f.tasks.run("task")).reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  assert.equal(
    f.tasks.roots.stats("task").reason,
    "ACTIVE_TIME_RECONCILIATION",
  );
  assert.equal(f.calls(), 0);
  assert.ok(f.tasks.get("task").active_ms >= 0);
});

test("a per-file timeout records failure and continues safe attachments within the shared root budget", async (t) => {
  const f = fixture(t, {
    reader: async (file, { signal }) => {
      if (file.id === "a")
        return new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("aborted")), {
            once: true,
          }),
        );
      return readMaterial(file);
    },
  });
  const b = f.store.files.put("packet", "b", {
    name: "safe.txt",
    body: Buffer.from("安全文字尾部"),
    type: "text/plain",
    epoch: f.store.epoch,
  });
  f.put({ attachments: [f.store.record("packet").data.attachments[0], b] });
  f.tasks.readerLimitMs = 25;
  f.enqueue();
  assert.equal((await finish(f.tasks)).state, "done");
  const coverage = f.store.record("packet").data.readingCoverage;
  assert.equal(coverage[0].state, "failed");
  assert.equal(coverage[0].reasons[0], "READING_TIMEOUT");
  assert.match(readingView(coverage)[0].missing, /读取步骤超时/);
  assert.equal(coverage[1].state, "read");
  assert.equal(f.calls(), 1);
});

test("late reader progress after a completed step cannot change the root clock or safety gate", async (t) => {
  let late;
  const f = fixture(t, {
    reader: async (file, { onPhase }) => {
      late = onPhase;
      return readMaterial(file);
    },
  });
  f.enqueue();
  await f.tasks.run("task");
  const before = f.tasks.roots.stats("task");
  assert.doesNotThrow(() => late({ phase: "active", waitingMs: 10000000 }));
  assert.deepEqual(f.tasks.roots.stats("task"), before);
});

test("an original cleared between reads pauses with the reupload code instead of a generic error or invented partial result", async (t) => {
  const f = fixture(t, {
    reader: async (file) => {
      const get = f.store.files.get;
      f.store.files.get = (packet, id) => {
        if (id === "b")
          throw Object.assign(Error("云端原件已清除，请重传"), {
            code: "REUPLOAD_REQUIRED",
          });
        return get(packet, id);
      };
      return readMaterial(file);
    },
  });
  const b = f.store.files.put("packet", "b", {
    name: "second.txt",
    body: Buffer.from("第二份原件"),
    type: "text/plain",
    epoch: f.store.epoch,
  });
  f.put({ attachments: [f.store.record("packet").data.attachments[0], b] });
  f.enqueue();
  assert.equal((await f.tasks.run("task")).reason, "REUPLOAD_REQUIRED");
  assert.equal(f.calls(), 0);
  assert.equal(f.store.record("packet").data.result, null);
});

test("task kernel refuses configuration without explicit device authorization", () => {
  assert.throws(
    () =>
      new ReadingTasks({
        account: "a",
        reader() {},
        provider() {},
        modelVersion: "fixture",
      }),
    /READING_CONFIGURATION_REQUIRED/,
  );
});
test("original -> reading -> ledger -> atomic publication -> both logical sync devices, without persistent full text", async (t) => {
  const f = fixture(t);
  const first = f.enqueue();
  assert.deepEqual(f.enqueue(), first);
  const original = f.store.files.get("packet", "a");
  assert.equal(
    f.store.files.put("packet", "a", {
      name: original.name,
      type: original.type,
      body: original.body,
      epoch: f.store.epoch,
    }).hash,
    original.hash,
  );
  assert.throws(
    () => f.put({ text: "offline modification" }),
    (e) => e.code === "INPUT_LOCKED",
  );
  assert.throws(
    () =>
      f.store.files.put("packet", "b", {
        name: "b.txt",
        body: Buffer.from("xx"),
        epoch: f.store.epoch,
      }),
    (e) => e.code === "INPUT_LOCKED",
  );
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
  assert.throws(
    () => f.put({ readingCoverage: [] }),
    (e) => e.code === "SERVER_FIELD_READONLY",
  );
  const p = f.store.record("packet").data;
  assert.equal(p.sources.length, 0);
  assert.equal(p.readingCoverage[0].state, "read");
  assert.equal(p.result.items[0].evidence[0].quote, "原件实际内容和要求");
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  for (const device of [f.windows, f.wechat]) {
    assert.ok(f.store.authenticate(device.token));
    const changes = f.store.pull({ cursor: 0, epoch: f.store.epoch });
    assert.ok(
      changes.records.some(
        (r) => r.data?.readingCoverage?.[0].state === "read",
      ),
    );
    assert.ok(device.deviceId);
  }
  const task = f.tasks.get("task");
  assert.ok(!JSON.stringify(task).includes("原件实际内容"));
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_publications").get().n,
    1,
  );
});
test("stop retains completed paid block, rejects stale action, and settles but discards a late response", async (t) => {
  let release, entered;
  const started = new Promise((r) => (entered = r));
  const f = fixture(t, {
    text: "abcdefghij".repeat(20000),
    provider: async (sources, signal, n) => {
      if (n === 2) {
        entered();
        await new Promise((r) => (release = r));
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  f.enqueue();
  await f.tasks.run("task");
  assert.equal(f.calls(), 1);
  const pending = f.tasks.run("task");
  await started;
  const prior = f.tasks.get("task");
  f.action("stop", "stop");
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.throws(
    () => f.action("continue", "too-early"),
    (e) => e.code === "UNKNOWN_COST",
  );
  release();
  await pending;
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
    1,
  );
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  assert.throws(
    () =>
      f.tasks.action(
        "task",
        {
          operationId: "stale",
          expectedGeneration: prior.generation,
          expectedRevision: prior.input_revision,
        },
        "stop",
      ),
    (e) => e.code === "STALE_TASK",
  );
  f.action("continue", "continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(
    f.calls(),
    3,
    "completed first block was reused, late unfinished block was not",
  );
});
test("all unreadable material never invokes provider; partial input publishes explicit uncovered metadata", async (t) => {
  const fail = fixture(t, {
    reader: async (f) => ({
      ...readMaterial(f),
      state: "failed",
      segments: [],
      covered: [],
      uncovered: [{ kind: "file", code: "ISOLATED_READING_FAILED" }],
    }),
  });
  fail.enqueue();
  assert.equal((await fail.tasks.run("task")).reason, "NO_READABLE_MATERIAL");
  assert.equal(fail.calls(), 0);
});

test("unreadable DOCX never spends; damaged DOCX tail publishes only complete safe paragraphs and exact missing metadata", async (t) => {
  const unreadable = fixture(t, {
    name: "损坏.docx",
    text: docxBytes("<w:p><w:r><w:t>损坏尾部"),
  });
  unreadable.enqueue();
  assert.equal(
    (await unreadable.tasks.run("task")).reason,
    "NO_READABLE_MATERIAL",
  );
  assert.equal(unreadable.calls(), 0);
  assert.equal(unreadable.ledger.wallet("synthetic").spent, 0);
  const partial = fixture(t, {
    name: "部分.docx",
    text: docxBytes(
      paragraph("可以安全读取的段落") + "<w:p><w:r><w:t>损坏尾部",
    ),
    provider: async (sources) => {
      assert.equal(sources.map((s) => s.text).join(""), "可以安全读取的段落\n");
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  partial.enqueue();
  assert.equal((await finish(partial.tasks)).state, "done");
  const record = partial.store.record("packet");
  assert.equal(record.data.readingCoverage[0].state, "partial");
  assert.ok(
    record.data.readingCoverage[0].uncovered.some(
      (r) => r.code === "DOCX_XML_MALFORMED",
    ),
  );
  assert.equal(partial.calls(), 1);
});
test("publication failure rolls back packet, publication manifest and terminal state together", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  const sequence = f.store.sequence;
  f.store.db.exec(
    "CREATE TRIGGER fail_reading_publish BEFORE INSERT ON reading_publications BEGIN SELECT RAISE(ABORT,'INJECTED_PUBLISH_FAILURE'); END;",
  );
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.store.sequence, sequence);
  assert.equal(f.store.record("packet").data.result, null);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_publications").get().n,
    0,
  );
  f.store.db.exec("DROP TRIGGER fail_reading_publish");
  f.action("continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
});
test("changed input cannot resume or reuse a paid block under an old revision", async (t) => {
  const f = fixture(t, { text: "abcdefghij".repeat(20000) });
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop");
  f.put({ text: "changed" });
  assert.throws(
    () => f.action("continue", "resume"),
    (e) => e.code === "INPUT_CHANGED",
  );
});
test("whitespace-only originals report no readable material and do not publish an empty success", async (t) => {
  const f = fixture(t, { text: " \n\t\n" });
  f.enqueue();
  assert.equal((await f.tasks.run("task")).reason, "NO_READABLE_MATERIAL");
  assert.equal(f.calls(), 0);
  assert.equal(f.store.record("packet").data.result, null);
});
test("settled result envelope survives failure before tenant block write and resumes without another charge", async (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db.exec(
    "CREATE TRIGGER fail_block BEFORE INSERT ON reading_blocks BEGIN SELECT RAISE(ABORT,'INJECTED_BLOCK_FAILURE'); END;",
  );
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.calls(), 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_envelopes").get().n,
    1,
  );
  f.store.db.exec("DROP TRIGGER fail_block");
  f.action("continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_envelopes").get().n,
    0,
  );
});
test("invalid model source still settles valid usage but cannot become a reusable block or publication", async (t) => {
  const f = fixture(t, {
    provider: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: result([{ id: "forged", text: "unrelated quote" }]),
    }),
  });
  f.enqueue();
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
    0,
  );
  assert.equal(f.store.record("packet").data.result, null);
});

function timeAuditFixture(f, { mutate = (p) => p } = {}) {
  const step = f.tasks.roots.safety.begin(
    "task",
    "task",
    f.tasks.get("task").generation,
  );
  f.tasks.roots.safety.abandon(step);
  f.tasks.roots.block("task", "ACTIVE_TIME_RECONCILIATION");
  const authorize = ({ actor, operation }) =>
    actor === "maintainer" && operation === "reconcile-root-time";
  const verify = ({ account, evidenceHash, review }) =>
    mutate({
      account,
      evidenceHash,
      rootTaskId: review.rootTaskId,
      generation: review.generation,
      watermark: review.watermark,
      snapshotHash: review.snapshotHash,
      stepIds: review.steps.map((s) => s.id),
      additionalActiveMs: 321,
      final: true,
      reference: "synthetic-termination-and-upper-bound",
    });
  const maintenance = new ReadingTimeMaintenance(f.tasks, authorize, verify);
  const review = maintenance.preview("task", "maintainer");
  const request = {
    operationId: "time-audit",
    evidenceHash: "b".repeat(64),
    expectedGeneration: review.generation,
    expectedWatermark: review.watermark,
    expectedLedgerSequence: review.ledgerSequence,
  };
  return { maintenance, request, review, authorize, verify };
}
test("trusted termination and missing-time bound preserve paid results, fence old actions and allow explicit recovery", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop", "stop-before-time-audit");
  const before = f.tasks.roots.stats("task"),
    spent = f.ledger.wallet("synthetic").spent;
  const a = timeAuditFixture(f);
  assert.throws(
    () => new ReadingTimeMaintenance(f.tasks, a.authorize),
    /EVIDENCE_AUTHORITY/,
  );
  assert.throws(
    () => a.maintenance.reconcile("task", a.request, "user"),
    /FORBIDDEN/,
  );
  const receipt = a.maintenance.reconcile("task", a.request, "maintainer");
  assert.equal(f.calls(), 1);
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.equal(f.tasks.roots.stats("task").activeMs, before.activeMs + 321);
  assert.equal(f.tasks.roots.stats("task").reason, "");
  assert.equal(f.tasks.roots.stats("task").calls, before.calls);
  assert.equal(f.ledger.wallet("synthetic").spent, spent);
  assert.deepEqual(
    a.maintenance.reconcile("task", a.request, "maintainer"),
    receipt,
  );
  assert.throws(
    () =>
      a.maintenance.reconcile(
        "task",
        { ...a.request, evidenceHash: "c".repeat(64) },
        "maintainer",
      ),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.throws(
    () => f.action("continue", "old-time-action"),
    (e) => e.code === "STALE_TASK",
  );
  assert.throws(
    () =>
      f.tasks.enqueue({
        id: "old-create",
        packetId: "packet",
        deviceId: f.windows.deviceId,
      }),
    (e) => e.code === "STALE_COST_REVIEW",
  );
  for (const table of ["reading_time_audits", "reading_time_finalizations"])
    assert.throws(
      () => f.ledger.db.exec("DELETE FROM " + table),
      /APPEND_ONLY/,
    );
  const restarted = new ReadingTasks(f.taskArgs);
  assert.equal(restarted.roots.stats("task").activeMs, before.activeMs + 321);
  assert.equal(restarted.roots.stats("task").reason, "");
  const task = restarted.get("task");
  restarted.action(
    "task",
    {
      operationId: "fresh-time-action",
      expectedGeneration: task.generation,
      expectedRevision: task.input_revision,
      expectedMaintenanceOperation: restarted.maintenanceOperation("task"),
    },
    "continue",
  );
  assert.equal((await finish(restarted)).state, "done");
  assert.equal(f.calls(), 1);
});
test("time evidence is exact, synchronous, final and cannot release rollback or other gates", async (t) => {
  for (const mutate of [
    (p) => ({ ...p, account: "other" }),
    (p) => ({ ...p, final: false }),
    (p) => ({ ...p, stepIds: [] }),
    (p) => ({ ...p, additionalActiveMs: -1 }),
    (p) => ({ ...p, snapshotHash: "c".repeat(64) }),
    (p) => Promise.resolve(p),
  ]) {
    const f = fixture(t);
    f.enqueue();
    await f.tasks.run("task");
    f.action("stop");
    const a = timeAuditFixture(f, { mutate });
    assert.throws(
      () => a.maintenance.reconcile("task", a.request, "maintainer"),
      /INVALID_TIME_EVIDENCE/,
    );
    assert.equal(
      f.tasks.roots.stats("task").reason,
      "ACTIVE_TIME_RECONCILIATION",
    );
    assert.equal(
      f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_time_audits").get().n,
      0,
    );
  }
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop");
  f.store.db.exec("UPDATE reading_tasks SET active_ms=0 WHERE id='task'");
  const a = timeAuditFixture(f);
  assert.throws(
    () => a.maintenance.reconcile("task", a.request, "maintainer"),
    /SAFETY_RECONCILIATION/,
  );
});
test("time audit receipt, tenant projection and final gate release recover conservatively at both cross-database boundaries", async (t) => {
  for (const phase of ["receipt", "projection", "finalization"]) {
    const f = fixture(t);
    f.enqueue();
    await f.tasks.run("task");
    f.action("stop");
    const a = timeAuditFixture(f),
      before = f.tasks.roots.stats("task");
    const db = phase === "projection" ? f.store.db : f.ledger.db;
    const table =
      phase === "receipt"
        ? "reading_time_audits"
        : phase === "projection"
          ? "reading_tasks"
          : "reading_time_finalizations";
    const action = phase === "projection" ? "UPDATE" : "INSERT";
    db.exec(
      "CREATE TRIGGER fail_time_audit BEFORE " +
        action +
        " ON " +
        table +
        " BEGIN SELECT RAISE(ABORT,'INJECTED_TIME_FAILURE'); END;",
    );
    assert.throws(
      () => a.maintenance.reconcile("task", a.request, "maintainer"),
      /INJECTED_TIME_FAILURE/,
    );
    assert.equal(
      f.tasks.roots.stats("task").reason,
      "ACTIVE_TIME_RECONCILIATION",
    );
    assert.equal(f.calls(), 1);
    db.exec("DROP TRIGGER fail_time_audit");
    a.maintenance.reconcile("task", a.request, "maintainer");
    assert.equal(f.tasks.roots.stats("task").activeMs, before.activeMs + 321);
    assert.equal(f.tasks.roots.stats("task").reason, "");
  }
});

test('independent disk reader retains finalized time receipt and paid cumulative watermark',async t=>{
  const f=fixture(t);f.enqueue();await f.tasks.run('task');f.action('stop');
  const a=timeAuditFixture(f);a.maintenance.reconcile('task',a.request,'maintainer');
  const code=`import {ReadingLedger} from ${JSON.stringify(new URL('./ledger.mjs',import.meta.url).href)};
    import {ReadingRootSafety} from ${JSON.stringify(new URL('./root-safety.mjs',import.meta.url).href)};
    const ledger=new ReadingLedger(${JSON.stringify(join(f.directory,'ledger.sqlite'))});
    const guard=new ReadingRootSafety(ledger,'synthetic');
    console.log(JSON.stringify({receipt:guard.lastTimeAudit('task'),latest:guard.latest('task'),wallet:ledger.wallet('synthetic')}));ledger.close();`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000,maxBuffer:16384});
  assert.equal(child.status,0,child.stderr);const disk=JSON.parse(child.stdout);
  assert.equal(disk.receipt.operation,a.request.operationId);assert.equal(disk.latest.reason,'');
  assert.equal(disk.latest.active_ms,a.review.activeMs+321);assert.equal(disk.wallet.spent,20);
  assert.equal(disk.wallet.costAuditOperation,f.ledger.recoveryOperation('synthetic'));
});
test('unknown fees, pending executors, stale reviews and concurrent proof mutations keep time audit closed',async t=>{
  for(const mode of ['unknown','executor','stale','proof-race']){
    const f=fixture(t);f.enqueue();await f.tasks.run('task');f.action('stop');
    const a=timeAuditFixture(f);let request=a.request,maintenance=a.maintenance;
    if(mode==='unknown'){
      f.ledger.reserve({callId:'uncertain',account:'synthetic',task:'task',block:'unknown-block',generation:1,
        priceId:'fixture',maxPromptTokens:10,maxOutputTokens:10,fingerprint:'unknown'});
      f.ledger.sent('uncertain');f.ledger.unknown('uncertain');
      request={...request,expectedLedgerSequence:f.ledger.sequence('synthetic')};
    }
    if(mode==='executor')f.tasks.executions.set('synthetic-active',{});
    if(mode==='stale')request={...request,expectedWatermark:request.expectedWatermark-1};
    if(mode==='proof-race')maintenance=new ReadingTimeMaintenance(f.tasks,a.authorize,args=>{
      const proof=a.verify(args);f.tasks.roots.safety.begin('task','task',1);return proof;
    });
    try {assert.throws(()=>maintenance.reconcile('task',request,'maintainer'),/UNKNOWN_COST|TASK_STILL_DRAINING|STALE_MAINTENANCE_REVIEW/);}
    finally {f.tasks.executions.delete('synthetic-active');}
    assert.equal(f.ledger.db.prepare('SELECT COUNT(*) n FROM reading_time_audits').get().n,0);
    assert.equal(f.calls(),1);
  }
});

for(const archived of [false,true])test(`${archived?'archive ':''}PNG tile task stop/restart rechecks originals, reuses paid blocks and never persists image bytes`,async t=>{
  const width=2051,height=4,pixels=Buffer.alloc(width*height*4,255);pixels[0]=0;pixels[pixels.length-4]=27;
  const png=encodePng(width,height,pixels);let tiles=[];
  const f=fixture(t,{name:archived?'图像.zip':'图像.png',text:archived?zipBytes({'notice.png':png}):png,
    reader:Object.assign(async(file,options)=>readMaterial(file,options),{pdfWindows:true,imageWindows:true,archiveWindows:archived}),
    provider:async sources=>{
      assert.equal(sources.length,1);const source=sources[0];if(!source.image)return {usage:{prompt_tokens:10,completion_tokens:10},result:result(sources)};tiles.push(source.id);
      return {usage:{prompt_tokens:10,completion_tokens:10},result:{...result(sources),
        items:[{...result(sources).items[0],evidence:[{sourceId:source.id,quote:'合成图像可见文字'}]}]}};
    }});
  f.tasks.provider.imageInput=true;f.enqueue();const firstPng=await f.tasks.run('task');assert.equal(firstPng.state,'queued',JSON.stringify({reason:firstPng.reason,tiles,calls:f.calls()}));f.action('stop','png-stop');
  assert.equal(f.calls(),1);const original=f.tasks.get('task');
  const restarted=new ReadingTasks(f.taskArgs);restarted.provider.imageInput=true;
  restarted.action('task',{operationId:'png-continue',expectedGeneration:original.generation,expectedRevision:original.input_revision},'continue');
  assert.equal((await finish(restarted)).state,'done');assert.equal(f.calls(),3);
  assert.equal(new Set(tiles).size,3);assert.equal(f.ledger.wallet('synthetic').spent,60);
  const published=f.store.record('packet').data;assert.equal(published.readingCoverage[0].covered.length,3);
  assert.ok(!published.readingCoverage[0].uncovered.some(r=>r.code==='IMAGE_WINDOW_PENDING'));
  assert.ok(published.result.warnings.some(w=>w.includes('图像内容由模型识别')));
  const tables=['reading_tasks','reading_blocks','reading_block_ranges','reading_windows'];
  for(const table of tables){const data=JSON.stringify(f.store.db.prepare('SELECT * FROM '+table).all());
    assert.ok(!data.includes('base64'));assert.ok(!data.includes('iVBORw0KGgo'));}
  f.put({text:'新的补充要求'});restarted.enqueue({id:'revised-png',packetId:'packet',deviceId:f.windows.deviceId});
  for(let i=0;i<15&&restarted.get('revised-png').state==='queued';i++)await restarted.run('revised-png');
  assert.equal(restarted.get('revised-png').state,'done');assert.equal(restarted.reuse.count('revised-png'),3);
});

test('unconfigured image provider and malformed PNG do not issue model calls or save pixel payloads',async t=>{
  for(const enabled of [false,true]){
    const f=fixture(t,{name:'图像.png',text:enabled?Buffer.from('not PNG'):encodePng(1,1,Buffer.from([1,2,3,255])),
      reader:Object.assign((file,options)=>readMaterial(file,options),{pdfWindows:true,imageWindows:true})});
    f.tasks.provider.imageInput=enabled;f.enqueue();const task=await finish(f.tasks);
    assert.equal(task.reason,'NO_READABLE_MATERIAL');assert.equal(f.calls(),0);assert.equal(f.ledger.wallet('synthetic').spent,0);
    assert.equal(f.tasks.materials.size,0);
  }
});
test('cumulative quote validation failure still settles trustworthy returned usage',async t=>{
  const f=fixture(t);f.tasks.boundQuotes=()=>{throw Error('INVALID_MODEL_SOURCE');};f.enqueue();
  const task=await f.tasks.run('task');assert.equal(task.state,'paused');assert.equal(f.calls(),1);
  assert.equal(f.ledger.wallet('synthetic').spent,20);assert.equal(f.ledger.wallet('synthetic').unknownRisk,0);
});

test('archive PNG without provider image capability remains unread and cannot send a text surrogate',async t=>{
  const png=encodePng(2051,1,Buffer.alloc(2051*4,255));
  const f=fixture(t,{name:'图片.zip',text:zipBytes({'notice.png':png}),
    reader:Object.assign((file,options)=>readMaterial(file,options),{pdfWindows:true,archiveWindows:true,imageWindows:true})});
  f.enqueue();const task=await finish(f.tasks);
  assert.equal(task.reason,'NO_READABLE_MATERIAL');assert.equal(f.calls(),0);
  assert.equal(f.ledger.wallet('synthetic').spent,0);
  const coverage=JSON.parse(task.coverage)[0];
  assert.equal(coverage.covered.length,0);
  assert.equal(coverage.uncovered.filter(r=>r.code==='IMAGE_PROVIDER_UNSUPPORTED').length,3);
  assert.ok(!JSON.stringify(coverage).includes('iVBORw0KGgo'));
});

test('image quote privacy cap retains locator-only paid reuse and its already-grounded deadline',async t=>{
  const quote=('2026年10月30日18:00。'+'合成'.repeat(300)).slice(0,500);
  const f=fixture(t,{name:'长图.png',text:encodePng(4097,1,Buffer.alloc(4097*4,255)),
    reader:Object.assign((file,options)=>readMaterial(file,options),{pdfWindows:true,imageWindows:true}),
    provider:async sources=>({usage:{prompt_tokens:10,completion_tokens:10},result:sources[0].image?{
      ...result(sources),items:[{...result(sources).items[0],evidence:[{sourceId:sources[0].id,quote}],
        due:{date:'2026-10-30',time:'18:00',anchor:'2026年10月30日18:00',sourceId:sources[0].id}}]}:result(sources)})});
  f.tasks.provider.imageInput=true;f.enqueue();for(let i=0;i<30&&f.tasks.get('task').state==='queued';i++)await f.tasks.run('task');
  assert.equal(f.tasks.get('task').state,'done');assert.equal(f.calls(),5);
  const original=f.store.record('packet').data.result;assert.equal(original.items.at(-1).evidence[0].quote,'');
  assert.equal(original.items.at(-1).due.time,'18:00');
  f.put({text:'补充要求'});f.tasks.enqueue({id:'quote-revision',packetId:'packet',deviceId:f.windows.deviceId});
  for(let i=0;i<30&&f.tasks.get('quote-revision').state==='queued';i++)await f.tasks.run('quote-revision');
  assert.equal(f.tasks.get('quote-revision').state,'done');assert.equal(f.tasks.reuse.count('quote-revision'),5);assert.equal(f.calls(),6);
  assert.equal(f.store.record('packet').data.result.items.at(-1).due.time,'18:00');
});
