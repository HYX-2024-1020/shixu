import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SyncStore, SyncError } from "../sync-store.mjs";

const require = createRequire(import.meta.url);
for (const [platform, module] of [["mini", "../../miniprogram/lib/sync-client.js"], ["Windows", "../../desktop/generated/sync-client.cjs"]]) {
  test(`${platform} edits a card in a long result with durable bounded retry and preserves other cards/coverage`, async t => {
    const store = new SyncStore(":memory:");
    t.after(() => store.close());
    const device = store.createDevice("synthetic").deviceId;
    const items = Array.from({ length: 600 }, (_, i) => ({ title: `事项${i}`, summary: "完整😀材料".repeat(200), due: null }));
    const coverage = [{ state: "read", covered: [{ start: 0, end: 120000 }] }];
    store.apply(device, { opId: "publish", id: "packet", type: "put", baseVersion: 0,
      data: { text: "合成材料", result: { summary: "长结果", warnings: [], items }, itemIds: items.map((_, i) => `item${i}`), readingCoverage: coverage } }, store.epoch, { taskId: "synthetic-publication" });
    const { createSyncClient } = require(module);
    let saved, lost = true, supported = true;
    const transmitted = [];
    const options = {
      protocolVersion: 3, read: () => saved, write: next => { saved = next; },
      request: async (method, path, data) => {
        if (path === "/api/v3/status") return { application: "shixu-sync", protocolVersion: 3, epoch: store.epoch, capabilities: { resultItemPatches: supported } };
        if (path === "/api/v3/account") return { epoch: store.epoch };
        if (method === "GET") {
          const query = new URL(path, "http://localhost").searchParams;
          return store.pull({ cursor: Number(query.get("cursor")), epoch: query.get("epoch") });
        }
        assert.ok(Buffer.byteLength(JSON.stringify(data)) < 800000);
        transmitted.push(structuredClone(data.operation));
        const result = store.apply(device, data.operation, data.epoch);
        if (lost) { lost = false; throw Error("synthetic lost acknowledgement"); }
        return result;
      },
    };
    let client = createSyncClient(options);
    await client.sync();
    const original = structuredClone(client.records().find(row => row.id === "packet").data);
    const edited = structuredClone(original);
    edited.result.items[599].title = "提交课程论文";
    edited.result.items[599].due = "2026-11-09T18:00";
    edited.itemState = { item599: { starred: true, order: 2 } };
    client.put("packet", edited);
    await assert.rejects(client.sync(), /lost acknowledgement/);
    assert.equal(client.pendingCount(), 1);
    client = createSyncClient(options); // Process restart, not just in-memory retry.
    await client.sync();
    assert.deepEqual(transmitted[0], transmitted[1]);
    assert.equal(store.sequence, 2, "lost response must not create another publication/edit");
    assert.equal(client.pendingCount(), 0);
    const after = store.record("packet").data;
    assert.deepEqual(after.result.items.slice(0, 599), original.result.items.slice(0, 599));
    assert.deepEqual(after.readingCoverage, coverage);
    assert.deepEqual(after.itemIds, original.itemIds);
    assert.equal(after.result.items[599].title, "提交课程论文");
    assert.equal(after.result.items[599].due, "2026-11-09T18:00");
    const later = structuredClone(after);
    later.result.items[0].title = "离线修改";
    client.put("packet", later);
    supported = false;
    await assert.rejects(client.sync(), e => e.code === "CLIENT_UPGRADE_REQUIRED");
    assert.equal(client.pendingCount(), 1);
    supported = true;
    store.apply(device, { opId: "other-edit", id: "packet", type: "put", baseVersion: store.record("packet").version, data: { text: "另一端已修改" } }, store.epoch);
    await client.sync();
    assert.equal(client.conflicts().length, 1);
    assert.equal(client.conflicts()[0].local.data.result.items[0].title, "离线修改");
    assert.equal(store.record("packet").data.result.items[0].title, original.result.items[0].title);
  });
}

test("result patches cannot bypass task locks, erase coverage, reuse an operation ID or revive deleted data", () => {
  const store = new SyncStore(":memory:");
  try {
    const device = store.createDevice("synthetic").deviceId;
    store.apply(device, { opId: "seed", id: "packet", type: "put", baseVersion: 0, data: { text: "合成", result: { items: [{ title: "原项" }], summary: "", warnings: [] } } }, store.epoch);
    const operation = { opId: "edit", id: "packet", type: "put", baseVersion: 1, data: {}, resultPatch: { fields: {}, items: [{ index: 0, value: { title: "修改项" } }] } };
    store.validateOperation = () => { throw new SyncError(409, "INPUT_LOCKED", "任务锁定"); };
    assert.throws(() => store.apply(device, operation, store.epoch), e => e.code === "INPUT_LOCKED");
    store.validateOperation = null;
    assert.throws(() => store.apply(device, { ...operation, resultPatch: { fields: { readingCoverage: [] }, items: [] } }, store.epoch), e => e.code === "INVALID_RESULT_PATCH");
    assert.throws(() => store.apply(device, { ...operation, resultPatch: { fields: {}, items: [{ index: 1, value: {} }] } }, store.epoch), e => e.code === "INVALID_RESULT_PATCH");
    store.apply(device, operation, store.epoch);
    assert.throws(() => store.apply(device, { ...operation, resultPatch: { fields: {}, items: [] } }, store.epoch), e => e.code === "OP_ID_REUSED");
    store.apply(device, { opId: "delete", id: "packet", type: "delete", baseVersion: 2 }, store.epoch);
    assert.throws(() => store.apply(device, { ...operation, opId: "after-delete", baseVersion: 3 }, store.epoch), e => e.code === "DELETED");
  } finally { store.close(); }
});
