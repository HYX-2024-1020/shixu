import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { OriginalStore, originalMemoryPool } from "../originals.mjs";
import { createSyncService } from "../sync-server.mjs";
const { sha256 } = createRequire(import.meta.url)(
  "../../miniprogram/lib/originals.js",
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const day = 86400000;
function fixture({
  database = ":memory:",
  quota = 100,
  clock = { at: 1000 },
  pool,
} = {}) {
  const store = new SyncStore(database);
  createAttachmentStore(store);
  const originals = new OriginalStore(store, {
    quota,
    now: () => clock.at,
    pool,
  });
  const device = store.createDevice("synthetic").deviceId;
  const put = (packet, data = { text: "", attachments: [] }, type = "put") =>
    store.apply(
      device,
      {
        opId: crypto.randomUUID(),
        id: packet,
        baseVersion: store.record(packet)?.version || 0,
        type,
        ...(type === "put" ? { data } : {}),
      },
      store.epoch,
    );
  const file = (id = "a", body = Buffer.from("完整原件😀")) => ({
    id,
    name: id + ".txt",
    type: "text/plain",
    size: body.length,
    hash: hash(body),
    body,
  });
  const begin = (
    packet,
    files,
    id = crypto.randomUUID(),
    intent = "retained",
  ) =>
    originals.begin({
      submissionId: id,
      packetId: packet,
      manifest: files.map(({ body, ...f }) => f),
      epoch: store.epoch,
      storageIntent: intent,
    });
  const commit = (s, opId = s.submissionId) =>
    originals.commit(
      s.submissionId,
      {
        manifestHash: s.manifestHash,
        epoch: store.epoch,
        operation: {
          opId,
          id: s.packetId,
          type: "put",
          baseVersion: store.record(s.packetId).version,
          data: { attachments: s.manifest },
        },
      },
      device,
    );
  return {
    store,
    originals,
    clock,
    put,
    file,
    begin,
    commit,
    device,
    close() {
      originals.close();
      store.close();
    },
  };
}
test("raw-byte mini SHA-256 matches Node at padding boundaries, Unicode bytes and a complete 10MiB original", () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 10 * 1024 * 1024]) {
    const bytes = Buffer.alloc(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 37) % 256;
    assert.equal(sha256(bytes), hash(bytes));
  }
  const bytes = Buffer.from('中文😀\r\n,"原件"');
  assert.equal(sha256(bytes), hash(bytes));
});
test("manifest reserves all logical duplicates atomically; incomplete/integrity failure commits nothing and replay cannot alter a revision", () => {
  const f = fixture();
  try {
    f.put("packet");
    const a = f.file("a"),
      b = { ...a, id: "b", name: "b.txt" };
    const s = f.begin("packet", [a, b]);
    assert.equal(f.originals.usage().reservedBytes, a.size * 2);
    assert.throws(
      () => f.originals.put(s.submissionId, "a", Buffer.from("wrong")),
      (e) => e.code === "FILE_INTEGRITY",
    );
    f.originals.put(s.submissionId, "a", a.body);
    assert.throws(
      () => f.commit(s),
      (e) => e.code === "UPLOAD_INCOMPLETE",
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM sync_blobs").get().n,
      0,
    );
    assert.deepEqual(f.store.record("packet").data.attachments, []);
    f.originals.put(s.submissionId, "b", a.body);
    const before = f.store.record("packet").version;
    const result = f.commit(s);
    assert.equal(result.record.version, before + 1);
    assert.equal(f.originals.usage().usedBytes, a.size * 2);
    assert.equal(f.originals.usage().reservedBytes, 0);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM sync_blobs").get().n,
      1,
    );
    assert.deepEqual(f.store.files.get("packet", "b").body, a.body);
    const op = {
      opId: s.submissionId,
      id: s.packetId,
      type: "put",
      baseVersion: before,
      data: { attachments: s.manifest },
    };
    assert.equal(
      f.originals.commit(
        s.submissionId,
        { manifestHash: s.manifestHash, operation: op, epoch: f.store.epoch },
        f.device,
      ).replayed,
      true,
    );
    assert.throws(
      () => f.commit(s, "different"),
      (e) => e.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.throws(
      () => f.begin("packet", [a], s.submissionId),
      (e) => e.code === "IDEMPOTENCY_CONFLICT",
    );
  } finally {
    f.close();
  }
});
test("two SQLite connections cannot oversell a logical quota and a full manifest becomes temporary, never partly retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-original-quota-"));
  let a, b;
  try {
    const database = join(root, "tenant.sqlite");
    a = fixture({ database, quota: 20 });
    b = fixture({ database, quota: 20 });
    a.put("one");
    b.put("two");
    const file = a.file();
    const s = a.begin("one", [file]);
    const t = b.begin("two", [file]);
    assert.equal(s.mode, "retained");
    assert.equal(t.mode, "temporary");
    b.originals.put(t.submissionId, file.id, file.body);
    b.commit(t);
    assert.equal(b.originals.usage().usedBytes, 0);
    assert.equal(b.originals.usage().reservedBytes, file.size);
    assert.equal(
      b.store.db.prepare("SELECT COUNT(*) n FROM sync_blobs").get().n,
      0,
    );
  } finally {
    a?.close();
    b?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("temporary bytes never enter SQLite, disappear at window exit/restart, and only exact reupload can continue", async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-original-private-"));
  let f;
  try {
    const database = join(root, "tenant.sqlite");
    f = fixture({ database, quota: 1 });
    f.put("packet");
    const file = f.file(
      "a",
      Buffer.from("UNIQUE_PRIVATE_ORIGINAL_" + "文😀".repeat(800)),
    );
    const s = f.begin("packet", [file]);
    f.originals.put(s.submissionId, file.id, file.body);
    f.commit(s);
    assert.deepEqual(f.store.files.get("packet", file.id).body, file.body);
    f.originals.releaseWindow("packet");
    assert.throws(
      () => f.store.files.get("packet", file.id),
      (e) => e.code === "REUPLOAD_REQUIRED",
    );
    f.originals.put(s.submissionId, file.id, file.body);
    f.close();
    f = null;
    const disk = await readFile(database);
    assert.equal(disk.includes(Buffer.from("UNIQUE_PRIVATE_ORIGINAL_")), false);
    f = fixture({ database, quota: 1 });
    assert.throws(
      () => f.store.files.get("packet", file.id),
      (e) => e.code === "REUPLOAD_REQUIRED",
    );
    f.originals.put(s.submissionId, file.id, file.body);
    assert.deepEqual(f.store.files.get("packet", file.id).body, file.body);
    const row = f.originals.list().originals[0];
    f.originals.action("delete", {
      operationId: "delete",
      ids: [{ packetId: "packet", id: row.id, expectedVersion: row.version }],
    });
    assert.throws(
      () => f.originals.put(s.submissionId, file.id, file.body),
      (e) => e.code === "ORIGINAL_DELETED",
    );
  } finally {
    f?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("30+7 retention, seven-day warning, full-quota renewal and versioned delete preserve another logical reference", () => {
  const f = fixture({ quota: 34 });
  try {
    f.put("packet");
    const a = f.file(),
      b = { ...a, id: "b", name: "b.txt" };
    const s = f.begin("packet", [a, b]);
    for (const v of [a, b]) f.originals.put(s.submissionId, v.id, v.body);
    f.commit(s);
    f.clock.at += 23 * day;
    assert.ok(f.originals.list().originals.every((f) => f.remind));
    f.clock.at += 7 * day;
    let rows = f.originals.list().originals;
    assert.ok(rows.every((f) => f.state === "pending_cleanup"));
    const request = {
      operationId: "renew",
      ids: [{ packetId: "packet", id: "a", expectedVersion: rows[0].version }],
    };
    const renewed = f.originals.action("renew", request);
    assert.equal(renewed.results[0].code, "OK");
    assert.deepEqual(f.originals.action("renew", request), renewed);
    f.clock.at += 7 * day;
    rows = f.originals.list().originals;
    assert.equal(rows[1].state, "cleaned");
    assert.equal(rows[0].state, "available");
    assert.deepEqual(f.store.files.get("packet", "a").body, a.body);
    assert.throws(
      () => f.store.files.get("packet", "b"),
      (e) => e.code === "REUPLOAD_REQUIRED",
    );
    assert.equal(f.originals.usage().usedBytes, a.size);
  } finally {
    f.close();
  }
});
test("upload reservation and bounded shared memory expire without retaining bytes; ordinary v3 upload cannot bypass manifest", () => {
  const pool = originalMemoryPool(20),
    f = fixture({ pool });
  try {
    f.put("packet");
    const a = f.file(),
      b = { ...a, id: "b", name: "b.txt" };
    const s = f.begin("packet", [a, b]);
    f.originals.put(s.submissionId, a.id, a.body);
    assert.throws(
      () => f.originals.put(s.submissionId, b.id, b.body),
      (e) => e.code === "ORIGINAL_MEMORY_BUSY",
    );
    assert.equal(pool.used, a.size);
    f.clock.at += 15 * 60000;
    f.originals.sweep();
    assert.equal(pool.used, 0);
    assert.equal(f.originals.usage().reservedBytes, 0);
    assert.throws(
      () => f.commit(s),
      (e) => e.code === "SUBMISSION_EXPIRED",
    );
    const retry = f.begin("packet", [a, b], s.submissionId);
    assert.equal(retry.state, "uploading");
    assert.equal(retry.manifestHash, s.manifestHash);
    assert.equal(f.originals.usage().reservedBytes, a.size + b.size);
    assert.throws(
      () => f.store.files.put("packet", "a", {}),
      (e) => e.code === "CLIENT_UPGRADE_REQUIRED",
    );
  } finally {
    f.close();
  }
});
test("new packet trash is seven days, restore cannot revive expired originals, item state and old trash keep separate lifetimes", () => {
  const f = fixture();
  try {
    f.put("packet", {
      text: "材料",
      attachments: [],
      itemState: { one: { deletedAt: "2026-10-28T00:00:00Z" } },
    });
    f.put("packet", undefined, "delete");
    f.clock.at += 6 * day;
    f.put("packet", undefined, "restore");
    assert.ok(f.store.record("packet").data.itemState.one.deletedAt);
    f.put("packet", undefined, "delete");
    f.clock.at += 7 * day;
    assert.throws(
      () => f.put("packet", undefined, "restore"),
      (e) => e.code === "TRASH_EXPIRED",
    );
    f.originals.sweep();
    assert.equal(f.store.record("packet").purged, true);
  } finally {
    f.close();
  }
});

test("failed record publication rolls back all original blobs/references and a matching retry commits the same reservation", () => {
  const f = fixture();
  try {
    f.put("packet");
    const a = f.file();
    const s = f.begin("packet", [a]);
    f.originals.put(s.submissionId, a.id, a.body);
    f.store.validateStorage = () => {
      throw Error("synthetic record disk failure");
    };
    assert.throws(() => f.commit(s), /synthetic record disk failure/);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM sync_blobs").get().n,
      0,
    );
    assert.equal(f.originals.list().originals.length, 0);
    assert.equal(f.originals.usage().reservedBytes, a.size);
    f.store.validateStorage = null;
    f.commit(s);
    assert.deepEqual(f.store.files.get("packet", a.id).body, a.body);
  } finally {
    f.close();
  }
});
test("full-quota renew does not stop an active task; deletion requires explicit stop and a stale version cannot stop it", () => {
  const f = fixture();
  try {
    f.put("packet");
    const a = f.file();
    const s = f.begin("packet", [a]);
    f.originals.put(s.submissionId, a.id, a.body);
    f.commit(s);
    f.store.validateOriginalMutation = () => {
      throw Object.assign(Error("locked"), { code: "INPUT_LOCKED" });
    };
    const ids = [{ packetId: "packet", id: a.id, expectedVersion: 1 }];
    assert.equal(
      f.originals.action("renew", { operationId: "renew", ids }).results[0]
        .code,
      "OK",
    );
    let stops = 0;
    const stop = () => {
      stops++;
      f.store.validateOriginalMutation = null;
    };
    assert.equal(
      f.originals.action(
        "delete",
        { operationId: "stale", ids, stopTask: true },
        stop,
      ).results[0].code,
      "REVISION_CONFLICT",
    );
    assert.equal(stops, 0);
    ids[0].expectedVersion = 2;
    assert.throws(
      () => f.originals.action("delete", { operationId: "ask", ids }),
      (e) => e.code === "CONFIRM_STOP_REQUIRED",
    );
    assert.equal(
      f.originals.action(
        "delete",
        { operationId: "delete", ids, stopTask: true },
        stop,
      ).results[0].code,
      "OK",
    );
    assert.equal(stops, 1);
  } finally {
    f.close();
  }
});
test("original listings page explicitly without dropping logical copies; task reupload query returns only current packet inputs", () => {
  const f = fixture({ quota: 1000 });
  try {
    const a = f.file("a", Buffer.from("x"));
    for (let i = 0; i < 101; i++) {
      const packet = "packet" + i;
      f.put(packet);
      const s = f.begin(packet, [a]);
      f.originals.put(s.submissionId, a.id, a.body);
      f.commit(s);
    }
    const first = f.originals.list();
    assert.equal(first.originals.length, 100);
    assert.equal(first.usedBytes, 101);
    assert.equal(first.hasMore, true);
    const next = f.originals.list({ cursor: first.nextCursor });
    assert.equal(next.originals.length, 1);
    assert.equal(next.hasMore, false);
    assert.equal(next.originals[0].packetId, "packet100");
    assert.equal(
      f.originals.list({ packetId: "packet100" }).originals.length,
      1,
    );
    f.put("packet100", { attachments: [] });
    assert.equal(
      f.originals.list({ packetId: "packet100" }).originals.length,
      0,
    );
    assert.equal(f.store.files.unlinked("packet100"), false);
    assert.throws(
      () => f.originals.list({ cursor: -1 }),
      (e) => e.code === "INVALID_CURSOR",
    );
  } finally {
    f.close();
  }
});
test("a v4 original tenant refuses a v3-only binary instead of bypassing retention and logical quota", async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-original-schema-"));
  try {
    const database = join(root, "tenant.sqlite");
    const f = fixture({ database });
    f.close();
    assert.throws(
      () => createSyncService({ database, password: "synthetic-password" }),
      /ORIGINALS_V4_REQUIRED/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
