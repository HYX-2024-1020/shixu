import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { createSyncService } from "./sync-server.mjs";
const { createSyncClient } = createRequire(import.meta.url)(
  "../miniprogram/lib/sync-client.js",
);
const passphrase = "fixture-sync-only-passphrase";

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-sync-test-"));
  let service, base;
  const start = async () => {
    service = createSyncService({
      database: join(directory, "sync.sqlite"),
      password: passphrase,
    });
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${service.server.address().port}`;
  };
  const stop = () =>
    new Promise((done, reject) =>
      service.server.close((error) => (error ? reject(error) : done())),
    );
  await start();
  t.after(async () => {
    await stop();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(directory.includes("shixu-sync-test-"));
    rmSync(directory, { recursive: true, force: true });
  });
  async function request(token, method, path, data, extra = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error), value, {
        status: response.status,
      });
    return value;
  }
  async function device(name) {
    return request(null, "POST", "/api/v2/devices", {
      password: passphrase,
      name,
    });
  }
  function client(token, saved = { value: null }, intercept) {
    let sequence = 0;
    const transport = (method, path, data) =>
      request(token, method, path, data);
    const instance = createSyncClient({
      read: () => saved.value,
      write: (value) => {
        saved.value = structuredClone(value);
      },
      request: intercept
        ? (method, path, data) => intercept(transport, method, path, data)
        : transport,
      makeId: () => `op_${nameCounter++}_${++sequence}`,
    });
    return { instance, saved };
  }
  return {
    request,
    device,
    client,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
let nameCounter = 0;
const packet = (id, text = "明天交课程报告") => ({
  id,
  text,
  capturedAt: "2026-10-24T01:00:00.000Z",
  captureDate: "2026-10-24",
  captureTimezone: "Asia/Shanghai",
  sources: [{ id: "input", name: "原文", text }],
  attachments: [],
  status: "ready",
  result: { items: [{ title: "交报告", kind: "task" }] },
  itemIds: ["task-1"],
  doneIds: [],
  itemState: {
    "task-1": {
      starred: true,
      chat: [
        {
          id: "chat-1",
          role: "user",
          text: "保留我的补充",
          at: "2026-10-24T01:00:00Z",
        },
      ],
    },
  },
  futureField: { preserved: true },
});

test("two independent clients preserve full item state, sync completion, and survive restart", async (t) => {
  const f = await fixture(t),
    a = await f.device("电脑测试端"),
    b = await f.device("手机测试端");
  const first = f.client(a.token),
    second = f.client(b.token);
  first.instance.put("packet-a", packet("packet-a"));
  await first.instance.sync();
  await second.instance.sync();
  second.instance.put("packet-a", {
    doneIds: [0],
    itemState: { "task-1": { status: "done" } },
  });
  await second.instance.sync();
  await first.instance.sync();
  let row = first.instance.records()[0];
  assert.deepEqual(row.data.doneIds, [0]);
  assert.equal(row.data.itemState["task-1"].starred, true);
  assert.equal(row.data.itemState["task-1"].chat[0].text, "保留我的补充");
  assert.deepEqual(row.data.futureField, { preserved: true });
  await f.restart();
  const reopened = f.client(a.token, first.saved);
  await reopened.instance.sync();
  row = reopened.instance.records()[0];
  assert.deepEqual(row.data.doneIds, [0]);
  assert.equal(row.data.itemState["task-1"].status, "done");
});

test("a lost acknowledgement replays once after client and server restart", async (t) => {
  const f = await fixture(t),
    device = await f.device("重试端");
  let lost = false;
  const first = f.client(
    device.token,
    undefined,
    async (send, method, path, data) => {
      const result = await send(method, path, data);
      if (method === "POST" && !lost) {
        lost = true;
        throw new Error("connection lost after commit");
      }
      return result;
    },
  );
  first.instance.put("retry-a", packet("retry-a"));
  await assert.rejects(first.instance.sync(), /connection lost/);
  assert.equal(first.instance.pendingCount(), 1);
  await f.restart();
  const reopened = f.client(device.token, first.saved);
  await reopened.instance.sync();
  assert.equal(reopened.instance.pendingCount(), 0);
  const state = await f.request(device.token, "GET", "/api/v2/changes");
  assert.equal(state.records.length, 1);
  assert.equal(state.cursor, 1);
});

test("offline edits to one record retain their order, including edits during a request", async (t) => {
  const f = await fixture(t),
    device = await f.device("离线端");
  let client,
    inserted = false;
  client = f.client(
    device.token,
    undefined,
    async (send, method, path, data) => {
      if (method === "POST" && !inserted) {
        inserted = true;
        client.instance.put("offline-a", {
          itemState: { "task-1": { pinned: true } },
        });
      }
      return send(method, path, data);
    },
  );
  client.instance.put("offline-a", packet("offline-a"));
  client.instance.put("offline-a", { text: "补充后的报告要求" });
  client.instance.put("offline-a", { doneIds: [0] });
  await client.instance.sync();
  const row = client.instance.records()[0];
  assert.equal(client.instance.pendingCount(), 0);
  assert.equal(row.data.text, "补充后的报告要求");
  assert.deepEqual(row.data.doneIds, [0]);
  assert.equal(row.data.itemState["task-1"].pinned, true);
  assert.equal(row.data.itemState["task-1"].chat.length, 1);
});

test("concurrent edits create a preserved local conflict that can be saved as a new copy", async (t) => {
  const f = await fixture(t),
    a = await f.device("A"),
    b = await f.device("B");
  const first = f.client(a.token).instance,
    second = f.client(b.token).instance;
  first.put("conflict-a", packet("conflict-a"));
  await first.sync();
  await second.sync();
  first.put("conflict-a", { text: "电脑已修改" });
  second.put("conflict-a", { text: "手机离线补充" });
  await first.sync();
  await second.sync();
  assert.equal(second.conflicts().length, 1);
  assert.equal(second.conflicts()[0].local.data.text, "手机离线补充");
  const copyId = second.keepLocalCopy("conflict-a");
  await second.sync();
  await first.sync();
  assert.equal(second.conflicts().length, 0);
  assert.equal(
    first.records().find((row) => row.id === "conflict-a").data.text,
    "电脑已修改",
  );
  assert.equal(
    first.records().find((row) => row.id === copyId).data.text,
    "手机离线补充",
  );
});

test("deletion and permanent deletion block stale writes, restore, and replay disclosure", async (t) => {
  const f = await fixture(t),
    a = await f.device("A"),
    b = await f.device("B");
  const first = f.client(a.token).instance,
    second = f.client(b.token).instance;
  const { epoch } = await f.request(a.token, "GET", "/api/v2/status");
  const creation = {
    epoch,
    operation: { id: "delete-a", opId: "create-op", type: "put", baseVersion: 0, data: packet("delete-a") },
  };
  await f.request(a.token, "POST", "/api/v2/operations", creation);
  await first.sync();
  await second.sync();
  second.put("delete-a", { text: "旧设备保存" });
  first.remove("delete-a");
  await first.sync();
  await second.sync();
  assert.equal(second.conflicts().length, 1);
  const deleted = first.records()[0];
  const purged = await f.request(a.token, "POST", "/api/v2/operations", {
    epoch,
    operation: {
      id: "delete-a",
      opId: "purge-op",
      type: "purge",
      baseVersion: deleted.version,
    },
  });
  assert.equal(purged.record.data, null);
  await assert.rejects(
    f.request(a.token, "POST", "/api/v2/operations", {
      epoch,
      operation: {
        id: "delete-a",
        opId: "restore-op",
        type: "restore",
        baseVersion: purged.acceptedVersion,
      },
    }),
    (error) => error.code === "PURGED",
  );
  await second.sync();
  assert.equal(second.conflicts()[0].local.data.text, "旧设备保存");
  const replay = await f.request(a.token, "POST", "/api/v2/operations", creation);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.data, null);
});

test("soft deletion can be explicitly restored and pagination includes tombstones", async (t) => {
  const f = await fixture(t),
    a = await f.device("恢复端"),
    first = f.client(a.token).instance;
  first.put("one", packet("one"));
  first.put("two", packet("two"));
  await first.sync();
  first.remove("one");
  await first.sync();
  first.restore("one");
  await first.sync();
  assert.equal(first.records().find((row) => row.id === "one").deletedAt, null);
  first.remove("two");
  await first.sync();
  const initial = await f.request(a.token, "GET", "/api/v2/changes?limit=1");
  assert.equal(initial.more, true);
  const next = await f.request(
    a.token,
    "GET",
    `/api/v2/changes?limit=1&epoch=${initial.epoch}&cursor=${initial.cursor}`,
  );
  assert.equal(next.more, false);
  assert.ok(next.records[0].deletedAt);
});

test("authorization, origin, invalid input, epoch changes, and operation reuse are rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.request(null, "GET", "/api/v2/changes"),
    (e) => e.status === 401,
  );
  await assert.rejects(
    f.request(
      null,
      "POST",
      "/api/v2/devices",
      { password: passphrase },
      { Origin: "https://untrusted.example" },
    ),
    (e) => e.status === 403,
  );
  const device = await f.device("验证端"),
    { epoch } = await f.request(null, "GET", "/api/v2/status");
  const operation = {
    opId: "same-op",
    id: "a",
    baseVersion: 0,
    type: "put",
    data: packet("a"),
  };
  await f.request(device.token, "POST", "/api/v2/operations", {
    epoch,
    operation,
  });
  await assert.rejects(
    f.request(device.token, "POST", "/api/v2/operations", {
      epoch,
      operation: {
        ...operation,
        data: { ...operation.data, text: "another content" },
      },
    }),
    (e) => e.code === "OP_ID_REUSED",
  );
  await assert.rejects(
    f.request(device.token, "POST", "/api/v2/operations", {
      epoch: "old-server",
      operation,
    }),
    (e) => e.code === "RESET_REQUIRED",
  );
  await assert.rejects(
    f.request(
      device.token,
      "GET",
      "/api/v2/changes?cursor=9999&epoch=" + epoch,
    ),
    (e) => e.code === "RESET_REQUIRED",
  );
  await assert.rejects(
    f.request(device.token, "POST", "/api/v2/operations", {
      epoch,
      operation: {
        ...operation,
        opId: "bad-id",
        id: "__proto__",
        data: { text: "bad" },
      },
    }),
    (e) => e.code === "INVALID_OPERATION",
  );
  await assert.rejects(
    f.request(device.token, "POST", "/api/v2/operations", {
      epoch,
      operation: {
        opId: "file-op",
        id: "file",
        baseVersion: 0,
        type: "put",
        data: { text: "file", attachments: [{ name: "missing.pdf" }] },
      },
    }),
    (e) => e.code === "ATTACHMENTS_NOT_READY",
  );
  await f.request(device.token, "DELETE", "/api/v2/device");
  await assert.rejects(
    f.request(device.token, "GET", "/api/v2/changes"),
    (e) => e.code === "UNAUTHORIZED",
  );
});

test("repeated bad passwords are rate limited and service requires a nonempty strong passphrase", async (t) => {
  assert.throws(
    () => createSyncService({ database: ":memory:", password: "" }),
    /至少 12/,
  );
  const f = await fixture(t);
  for (let n = 0; n < 8; n++)
    await assert.rejects(
      f.request(null, "POST", "/api/v2/devices", { password: "wrong" }),
      (e) => e.code === "BAD_PASSWORD",
    );
  await assert.rejects(f.device("too many"), (e) => e.code === "LOGIN_LIMIT");
});
