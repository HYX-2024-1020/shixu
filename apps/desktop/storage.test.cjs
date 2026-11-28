const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DesktopStore, retention } = require("./storage.cjs");
const { exportBackup, importBackup } = require("./backup.cjs");
const packet = (id, deletedAt) => ({
  id,
  text: "原文",
  sources: [],
  doneIds: [],
  status: "pending",
  attachments: [
    {
      id: "a-" + id,
      name: "通知.txt",
      type: "text/plain",
      size: 3,
      bytes: Uint8Array.from([1, 2, 3]).buffer,
    },
  ],
  ...(deletedAt ? { deletedAt } : {}),
});
test("concurrent writes survive restart and shared originals outlive deletion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shixu-store-test-"));
  const store = new DesktopStore(root);
  await Promise.all([
    store.call("savePackets", [
      packet("one", new Date(Date.now() - retention - 1).toISOString()),
    ]),
    store.call("savePackets", [packet("two")]),
    store.call("saveDraft", { text: "草稿", attachments: [] }),
  ]);
  await store.cleanup();
  const restarted = new DesktopStore(root),
    rows = await restarted.call("packets");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "two");
  assert.deepEqual(
    [...new Uint8Array(rows[0].attachments[0].bytes)],
    [1, 2, 3],
  );
  assert.equal((await restarted.call("draft")).text, "草稿");
  await restarted.call("removePacket", "two");
  assert.equal((await restarted.cleanup()).removed, 1);
});
test("backup round trip validates originals and preserves current corrections", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shixu-backup-test-"));
  const store = new DesktopStore(path.join(root, "source"));
  await store.call("savePackets", [packet("one")]);
  await exportBackup(store, path.join(root, "backup.zip"));
  const restored = new DesktopStore(path.join(root, "restored"));
  await importBackup(restored, path.join(root, "backup.zip"));
  let rows = await restored.call("packets");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attachments[0].bytes.byteLength, 3);
  rows[0].text = "人工修正";
  await restored.call("savePackets", rows);
  await importBackup(restored, path.join(root, "backup.zip"));
  assert.equal((await restored.call("packets"))[0].text, "人工修正");
  const hash = rows[0].attachments[0].hash;
  await fs.writeFile(restored.file("files/" + hash), Buffer.from("corrupted"));
  await assert.rejects(restored.call("packets"), /校验失败/);
  await importBackup(restored, path.join(root, "backup.zip"));
  assert.equal(
    (await restored.call("packets"))[0].attachments[0].bytes.byteLength,
    3,
  );
});
test("expired items/checkins and attachment references are purged without harming a shared original", async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "shixu-retention-test-"),
    ),
    store = new DesktopStore(root);
  const p = packet("retained"),
    q = packet("shared");
  const expired = new Date(Date.now() - retention - 1000).toISOString();
  p.attachments[0].deletedAt = expired;
  p.result = {
    summary: "摘要",
    warnings: [],
    items: [
      {
        kind: "habit",
        title: "只有已删除事项含有的标题",
        summary: "每日阅读",
        facts: [],
        nextSteps: [],
        uncertainties: [],
        evidence: [],
        sourceIds: [],
        due: null,
      },
    ],
  };
  p.itemIds = ["stable-id"];
  p.itemState = {
    "stable-id": { deletedAt: expired, checkins: ["2026-10-22"] },
  };
  await store.call("savePackets", [p, q]);
  const cleaned = await store.cleanup();
  assert.equal(cleaned.files, 1);
  const rows = await store.call("packets"),
    old = rows.find((r) => r.id === p.id);
  assert.equal(old.attachments.length, 0);
  assert.ok(old.itemState["stable-id"].purgedAt);
  assert.equal(old.itemState["stable-id"].checkins, undefined);
  assert.equal(
    (await fs.readFile(store.file("state.previous.json"), "utf8")).includes(
      "只有已删除事项含有的标题",
    ),
    false,
  );
  await store.call("removePacket", q.id);
  await store.cleanup();
  await assert.rejects(store.call("savePackets", [q]), /永久删除/);
});
test("stale writes cannot resurrect an attachment after soft deletion or expiry", async () => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "shixu-stale-file-test-"),
    ),
    store = new DesktopStore(root);
  await store.call("savePackets", [packet("p")]);
  const [stale] = await store.call("packets");
  const deleted = {
    ...stale,
    attachments: stale.attachments.map((a) => ({
      ...a,
      deletedAt: new Date().toISOString(),
    })),
  };
  await store.call("savePackets", [deleted]);
  await store.call("savePackets", [stale]);
  assert.ok((await store.call("packets"))[0].attachments[0].deletedAt);
  const [current] = await store.call("packets");
  current.attachments[0].deletedAt = undefined;
  current.attachments[0].restoredAt = new Date(Date.now() + 1).toISOString();
  await store.call("savePackets", [current]);
  assert.equal(
    (await store.call("packets"))[0].attachments[0].deletedAt,
    undefined,
  );
  current.attachments[0].deletedAt = new Date(
    Date.now() - retention - 1,
  ).toISOString();
  await store.call("savePackets", [current]);
  await store.cleanup();
  await assert.rejects(store.call("savePackets", [stale]), /永久删除|超过30天/);
  assert.equal((await store.call("packets"))[0].attachments.length, 0);
});
test("fresh restore retains deletion registries when an older backup is imported later", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "shixu-backup-deletion-test-"),
  );
  const source = new DesktopStore(path.join(root, "source"));
  const removed = packet("removed"),
    withoutFile = packet("without-file"),
    live = packet("live");
  removed.attachments[0].bytes = Uint8Array.from([9, 9, 9]).buffer;
  withoutFile.attachments[0].bytes = Uint8Array.from([8, 8, 8]).buffer;
  await source.call("savePackets", [removed, withoutFile, live]);
  await exportBackup(source, path.join(root, "older.zip"));
  await source.call("removePacket", "removed");
  withoutFile.attachments = [];
  await source.call("savePackets", [withoutFile]);
  await exportBackup(source, path.join(root, "newer.zip"));
  const restored = new DesktopStore(path.join(root, "restored"));
  await importBackup(restored, path.join(root, "newer.zip"));
  await importBackup(restored, path.join(root, "older.zip"));
  const rows = await restored.call("packets");
  assert.equal(rows.length, 2);
  assert.equal(
    rows.some((p) => p.id === "removed"),
    false,
  );
  assert.equal(rows.find((p) => p.id === "without-file").attachments.length, 0);
  assert.equal(
    rows.find((p) => p.id === "live").attachments[0].bytes.byteLength,
    3,
  );
  assert.equal(
    (await restored.cleanup()).removed,
    0,
    "old backup must not recreate unreferenced originals",
  );
  const state = await restored.load();
  assert.ok(state.tombstones.includes("removed"));
  assert.ok(state.attachmentTombstones.includes("without-file/a-without-file"));
  // Importing a deletion from a backup must not overwrite an existing active record.
  const active = new DesktopStore(path.join(root, "active"));
  await active.call("savePackets", [removed]);
  await importBackup(active, path.join(root, "newer.zip"));
  assert.ok((await active.call("packets")).some((p) => p.id === "removed"));
});
