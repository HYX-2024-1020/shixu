const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { DesktopStore } = require("./storage.cjs");
const { CloudWorkspace } = require("./cloud.cjs");
const { AccountWorkspace } = require('./accounts.cjs');
const { BoardService } = require("./board.cjs");
const {
  sourceEdits,
  BOARD_ID,
  boardView,
  validateBoard,
} = require("./generated/board.cjs");
const source = () => ({
  id: "source",
  text: "合成来源",
  sources: [],
  attachments: [],
  capturedAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
  captureDate: "2026-11-15",
  status: "ready",
  result: {
    summary: "",
    warnings: [],
    items: [
      {
        kind: "task",
        title: "来源任务",
        summary: "",
        facts: [],
        nextSteps: [],
        uncertainties: [],
        evidence: [],
        sourceIds: [],
        due: {
          date: "2026-11-20",
          time: "14:30",
          anchor: "2026-11-20 14:30",
          sourceId: "manual",
        },
      },
    ],
  },
  doneIds: [],
  itemIds: ["item"],
  itemState: {
    item: {
      chat: [
        { id: "chat", role: "user", text: "合成旧对话", at: "2026-11-15" },
      ],
      starred: true,
    },
  },
});
async function fixture(t, cleanup = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shixu-board-"));
  if (cleanup) t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = new DesktopStore(path.join(root, "local"));
  const cloud = new CloudWorkspace({
    root: path.join(root, "cloud"),
    local,
    seal: async (s) => Buffer.from(s),
    unseal: async (b) => b.toString(),
  });
  await cloud.init();
  return { root, local, cloud, board: new BoardService(cloud) };
}
const save = (b, v, next, edits = []) =>
  b.save(
    {
      snapshot: next,
      stamp: v.stamp,
      sourceTokens: v.sourceTokens,
      sourceEdits: edits,
    },
    b.lease(),
  );
test("board source edits preserve existing fields, shared steps persist and stale writers cannot overwrite", async (t) => {
  const { local, cloud, board } = await fixture(t);
  await local.call("savePackets", [source()]);
  let view = await board.load(board.lease());
  assert.equal(view.snapshot.tasks.length, 0);
  assert.equal(view.snapshot.deadlines[0].dueAt, "2026-11-20T06:30:00.000Z");
  const next = structuredClone(view.snapshot);
  next.tasks.push({
    id: "linked",
    planningId: "daily",
    origin: "source",
    sourceId: next.sourceTasks[0].id,
    title: "来源任务",
    completedAt: null,
    dueAt: next.deadlines[0].dueAt,
    timePrecision: "explicit",
    archived: false,
  });
  next.longPlans.push({
    id: "parent",
    planningId: "daily",
    title: "长期合成",
    stepIds: ["step"],
    completedAt: null,
  });
  next.tasks.push({
    id: "step",
    parentId: "parent",
    planningId: "daily",
    origin: "step",
    title: "共享步骤",
    completedAt: "2026-11-15T01:00:00Z",
    dueAt: null,
    timePrecision: "inferred",
    archived: true,
  });
  view = await save(board, view, next);
  const staleSource = (await local.call("packets")).find(
    (p) => p.id === "source",
  );
  const stale = structuredClone(view);
  const edited = structuredClone(view.snapshot);
  edited.tasks[0].title = "来源改名";
  edited.tasks[0].completedAt = "2026-11-15T02:00:00Z";
  edited.tasks[1].archived = false;
  view = await save(board, view, edited, sourceEdits(view.snapshot, edited));
  const p = (await cloud.call("packets", null, "")).find(
    (p) => p.id === "source",
  );
  assert.equal(p.result.items[0].title, "来源改名");
  assert.equal(p.itemState.item.starred, true);
  assert.equal(p.itemState.item.chat[0].text, "合成旧对话");
  assert.equal(p.itemState.item.completedAt, "2026-11-15T02:00:00Z");
  await assert.rejects(
    local.call("savePackets", [{ ...staleSource, text: "stale" }]),
    /来源已有新修改/,
  );
  assert.equal(
    JSON.stringify(
      (await local.call("packets")).find((p) => p.id === BOARD_ID).board,
    ).includes("来源改名"),
    false,
    "references must not retain purged source content",
  );
  assert.equal(view.snapshot.tasks[1].completedAt, "2026-11-15T01:00:00Z");
  assert.equal(view.snapshot.longPlans[0].completedAt, null);
  await assert.rejects(save(board, stale, stale.snapshot), /另一个窗口/);
  const removed = structuredClone(view.snapshot);
  removed.tasks = removed.tasks.filter((t) => t.origin !== "source");
  view = await save(board, view, removed);
  assert.equal(
    (await local.call("packets")).find((p) => p.id === "source").deletedAt,
    undefined,
  );
  const reopened = new BoardService(cloud);
  assert.equal(
    (await reopened.load(reopened.lease())).snapshot.tasks[0].id,
    "step",
  );
  await assert.rejects(board.load("another-account"), /账号已切换/);
});
test("originals survive restart and backup, removal/restoration preserves bytes; malformed and oversize writes leave state unchanged", async (t) => {
  const { root, local, cloud, board } = await fixture(t);
  let view = await board.load(board.lease());
  const bytes = Uint8Array.from([1, 2, 3]).buffer;
  view = await board.addFiles(
    {
      stamp: view.stamp,
      planningId: "daily",
      files: [{ name: "合成.txt", type: "text/plain", bytes }],
    },
    board.lease(),
  );
  const id = view.snapshot.resources[0].id;
  assert.deepEqual(
    new Uint8Array((await board.resource(id, board.lease())).bytes),
    new Uint8Array(bytes),
  );
  const removed = structuredClone(view.snapshot);
  removed.resources[0].deletedAt = new Date().toISOString();
  view = await save(board, view, removed);
  await assert.rejects(board.resource(id, board.lease()), /已移除/);
  const restored = structuredClone(view.snapshot);
  delete restored.resources[0].deletedAt;
  view = await save(board, view, restored);
  assert.equal((await board.resource(id, board.lease())).bytes.byteLength, 3);
  const { exportBackup, importBackup } = require("./backup.cjs");
  await exportBackup(local, path.join(root, "backup.zip"));
  const copy = new DesktopStore(path.join(root, "restored"));
  await importBackup(copy, path.join(root, "backup.zip"));
  assert.equal((await copy.call("packets"))[0].board.resources[0].id, id);
  await assert.rejects(
    board.addFiles(
      {
        stamp: view.stamp,
        planningId: "daily",
        files: [
          {
            name: "large",
            type: "text/plain",
            bytes: new ArrayBuffer(10 * 1024 * 1024 + 1),
          },
        ],
      },
      board.lease(),
    ),
    /10 MiB/,
  );
  assert.equal((await board.load(board.lease())).stamp, view.stamp);
  assert.throws(
    () => validateBoard({ ...view.snapshot, tasks: [{ id: "bad" }] }),
    /事项无效/,
  );
});
test("source deletion retains unavailable links and restoration rebinds stable identity; stale source edit is rejected", async (t) => {
  const { local, board } = await fixture(t);
  const p = source();
  await local.call("savePackets", [p]);
  let v = await board.load(board.lease());
  const next = structuredClone(v.snapshot);
  next.tasks.push({
    id: "link",
    planningId: "daily",
    origin: "source",
    sourceId: v.snapshot.sourceTasks[0].id,
    title: "来源任务",
    completedAt: null,
    dueAt: null,
    timePrecision: "explicit",
    archived: false,
  });
  v = await save(board, v, next);
  p.deletedAt = new Date().toISOString();
  await local.call("savePackets", [p]);
  const missing = await board.load(board.lease());
  assert.equal(missing.snapshot.tasks[0].sourceUnavailable, true);
  assert.equal(missing.snapshot.deadlines.length, 0);
  delete p.deletedAt;
  p.updatedAt = new Date().toISOString();
  await local.call("savePackets", [p]);
  const restored = await board.load(board.lease());
  assert.equal(restored.snapshot.tasks[0].sourceUnavailable, false);
  const edit = structuredClone(v.snapshot);
  edit.tasks[0].title = "不应覆盖";
  await assert.rejects(
    save(board, v, edit, sourceEdits(v.snapshot, edit)),
    /来源已有新修改/,
  );
});
test("offline board and original queue roundtrip uses existing real sync service and remains invisible to mini world", async (t) => {
  const { root, local, cloud, board } = await fixture(t, false);
  const { createSyncService } = await import("../server/sync-server.mjs");
  const service = createSyncService({
    database: path.join(root, "sync.sqlite"),
    password: "synthetic-board-test",
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    service.server.closeAllConnections();
    await new Promise((r) => service.server.close(r));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${service.server.address().port}`;
  await cloud.action("connect", { base, password: "synthetic-board-test" });
  let v = await board.load(board.lease());
  const next = structuredClone(v.snapshot);
  next.drafts = { short: "未提交输入" };
  v = await save(board, v, next);
  v = await board.addFiles(
    {
      stamp: v.stamp,
      planningId: "daily",
      files: [
        {
          name: "offline.txt",
          type: "text/plain",
          bytes: Uint8Array.from([9, 8, 7]).buffer,
        },
      ],
    },
    board.lease(),
  );
  assert.ok(cloud.space().client.pendingCount() > 0);
  await cloud.action("sync");
  assert.equal(cloud.space().client.pendingCount(), 0);
  const row = service.store.record(BOARD_ID);
  assert.equal(row.data.board.drafts.short, "未提交输入");
  assert.equal(row.data.recordType, "board-workspace");
  const { itemsFor } = require("../miniprogram/lib/world.js");
  assert.equal(itemsFor([row]).length, 0);
  await cloud.action("local");
  assert.equal((await board.load(board.lease())).snapshot.resources.length, 0);
  assert.equal((await local.call("packets")).length, 0);
});

test('signed account v4 board originals use retained quota and survive client restart without any AI call',async t=>{
  const {accountUIFixture}=await import('../scripts/account-ui-fixture.mjs');
  const {ReadingLedger}=await import('../server/reading/ledger.mjs');
  const {readMaterial}=await import('../server/reading/material.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shixu-board-v4-'));
  const ledger=new ReadingLedger(path.join(root,'ledger.sqlite'));
  ledger.freezePrice({id:'fixture',model:'fixture',currency:'CNY',source:'synthetic',verifiedAt:1,inputMicrosPerMillion:1,cachedMicrosPerMillion:0,outputMicrosPerMillion:1});
  let calls=0;
  const f=await accountUIFixture({}, {reading:{ledger,enabled:true,priceId:'fixture',modelVersion:'fixture',reader:readMaterial,provider:async()=>{calls++;throw Error('board must not call AI');}}});
  t.after(async()=>{await f.close();ledger.close();await fs.rm(root,{recursive:true,force:true});});
  ledger.grantInitial(f.invitation.userId);
  const options={root:path.join(root,'client'),local:new DesktopStore(path.join(root,'local')),serviceOrigin:f.base,seal:async s=>Buffer.from(s),unseal:async b=>b.toString()};
  let client=new AccountWorkspace(options);await client.init();await client.action('activate',{invite:f.invitation.invite});
  let board=new BoardService(client),view=await board.load(board.lease());
  view=await board.addFiles({stamp:view.stamp,planningId:'daily',files:[{name:'board.txt',type:'text/plain',bytes:Uint8Array.from([97,98,99]).buffer}]},board.lease());
  await client.action('sync',{force:true});assert.equal(client.space().client.pendingCount(),0);assert.equal(calls,0);
  const storage=await client.request(client.config.active,'GET','/api/v4/storage?packetId='+BOARD_ID);
  assert.equal(storage.originals[0].mode,'retained');assert.equal(storage.originals[0].available,true);
  client=new AccountWorkspace(options);await client.init();await client.action('sync',{force:true});board=new BoardService(client);
  view=await board.load(board.lease());assert.equal(view.snapshot.resources.length,1);assert.equal((await board.resource(view.snapshot.resources[0].id,board.lease())).bytes.byteLength,3);assert.equal(calls,0);
});


test("default-app opening uses only an active planning original, preserves its extension, and reports handler failure", async (t) => {
  const { root, board } = await fixture(t);
  const { BoardWindow } = require("./board-window.cjs");
  const lease = board.lease();
  const bytes = new Uint8Array([23, 42]).buffer;
  let view = await board.load(lease);
  view = await board.addFiles(
    {
      stamp: view.stamp,
      planningId: "daily",
      files: [
        { name: "CON.TXT", type: "text/plain", bytes },
        { name: "unsafe.exe", type: "application/octet-stream", bytes },
      ],
    },
    lease,
  );
  const [original, unsupported] = view.snapshot.resources;
  const next = structuredClone(view.snapshot);
  next.resources[0].name = "仅改显示名.exe";
  view = await save(board, view, next);
  const opens = [];
  const native = new BoardWindow({
    root,
    service: board,
    openPath: async (file) => {
      opens.push(file);
      assert.equal(path.extname(file), ".txt");
      assert.deepEqual(await fs.readFile(file), Buffer.from(bytes));
      return opens.length === 1 ? "" : "missing association";
    },
  });
  t.after(() => native.cleanOriginalCopies());
  await native.action("openResource", { id: original.id }, lease, true);
  await assert.rejects(
    native.action("openResource", { id: original.id }, lease, true),
    /检查文件关联/,
  );
  await assert.rejects(
    native.action("openResource", { id: unsupported.id }, lease, true),
    /文件类型/,
  );
  await assert.rejects(
    native.action("openResource", { id: original.id }, "old-scope", true),
    /账号已切换/,
  );
  next.plans.push({ id: "different", name: "其他规划" });
  next.activePlanId = "different";
  await save(board, view, next);
  await assert.rejects(
    native.action("openResource", { id: original.id }, lease, true),
    /原件/,
  );
  assert.equal(opens.length, 2);
});

test("a locked board cannot resize; an unlocked corner keeps the opposite corner stable", async (t) => {
  const { root } = await fixture(t);
  const { BoardWindow } = require("./board-window.cjs");
  let cursor = { x: 10, y: 10 };
  let bounds = { x: -800, y: 40, width: 400, height: 500 };
  const native = new BoardWindow({
    root,
    screen: {
      getCursorScreenPoint: () => cursor,
      getDisplayMatching: () => ({
        workArea: { x: -1200, y: 0, width: 1200, height: 900 },
      }),
    },
  });
  native.win = {
    isDestroyed: () => false,
    getBounds: () => bounds,
    setBounds: (value) => {
      bounds = value;
    },
  };
  native.settings.locked = true;
  native.resizeWindow("resizeStart", "nw");
  assert.equal(native.resize, undefined);
  native.settings.locked = false;
  native.resizeWindow("resizeStart", "nw");
  cursor = { x: -10, y: 60 };
  native.resizeWindow("resizeEnd");
  assert.deepEqual(bounds, { x: -820, y: 90, width: 420, height: 450 });
  const restored = new BoardWindow({ root });
  assert.deepEqual(restored.settings.modeBounds.rail, bounds);
});
