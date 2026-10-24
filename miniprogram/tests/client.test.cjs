const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSyncClient } = require("../lib/sync-client");
const { normalizeServiceURL } = require("../lib/transport");

function local(request, options = {}) {
  const saved = { value: options.initial || null };
  let index = 0;
  const client = createSyncClient({
    read: () => saved.value,
    write: (value) => {
      if (options.failWrite && options.failWrite(value))
        throw new Error("disk full");
      saved.value = value;
    },
    request,
    makeId: () => `test_${++index}`,
  });
  return { client, saved };
}
test("disk failure does not clear or falsely acknowledge a queued operation", async () => {
  const controls = { full: false };
  const { client, saved } = local(
    async (method, path) => {
      if (path === "/api/v2/status")
        return {
          application: "shixu-sync",
          protocolVersion: 2,
          epoch: "server",
        };
      if (method === "GET")
        return { epoch: "server", cursor: 0, more: false, records: [] };
      controls.full = true;
      return {
        opId: "test_1",
        acceptedVersion: 1,
        record: {
          id: "a",
          version: 1,
          data: { id: "a", text: "offline" },
          purged: false,
          deletedAt: null,
        },
      };
    },
    { failWrite: () => controls.full },
  );
  client.put("a", { text: "offline" });
  await assert.rejects(client.sync(), /disk full/);
  assert.equal(client.pendingCount(), 1);
  assert.equal(saved.value.outbox.length, 1);
  assert.equal(client.records()[0].data.text, "offline");
});
test("server replacement keeps offline edits and refuses to upload against a fresh epoch", async () => {
  const { client, saved } = local(
    async () => ({
      application: "shixu-sync",
      protocolVersion: 2,
      epoch: "replacement",
    }),
    {
      initial: {
        version: 1,
        epoch: "original",
        cursor: 0,
        records: {},
        outbox: [],
        conflicts: [],
      },
    },
  );
  client.put("a", { text: "do not lose this" });
  await assert.rejects(client.sync(), (e) => e.code === "RESET_REQUIRED");
  assert.equal(saved.value.epoch, "original");
  assert.equal(saved.value.outbox.length, 1);
  assert.equal(client.records()[0].data.text, "do not lose this");
});
test("authorization errors and invalid server responses preserve the outbox", async () => {
  for (const error of [
    Object.assign(new Error("expired"), { code: "UNAUTHORIZED" }),
    new Error("offline"),
  ]) {
    const { client } = local(async (method, path) => {
      if (path.endsWith("status"))
        return {
          application: "shixu-sync",
          protocolVersion: 2,
          epoch: "server",
        };
      throw error;
    });
    client.put("a", { text: "pending" });
    await assert.rejects(client.sync(), (actual) => actual === error);
    assert.equal(client.pendingCount(), 1);
  }
  const { client } = local(async (method, path) =>
    path.endsWith("status")
      ? { application: "shixu-sync", protocolVersion: 2, epoch: "server" }
      : { epoch: "server", cursor: 0, more: true, records: [] },
  );
  client.put("a", { text: "pending" });
  await assert.rejects(client.sync(), (e) => e.code === "INVALID_RESPONSE");
  assert.equal(client.pendingCount(), 1);
});
test("simultaneous sync calls share a flight rather than sending duplicate operations", async () => {
  let sends = 0;
  const { client } = local(async (method, path) => {
    if (path.endsWith("status"))
      return { application: "shixu-sync", protocolVersion: 2, epoch: "server" };
    if (method === "GET")
      return { epoch: "server", cursor: 0, more: false, records: [] };
    sends++;
    return {
      opId: "test_1",
      acceptedVersion: 1,
      record: {
        id: "a",
        version: 1,
        data: { id: "a", text: "once" },
        purged: false,
        deletedAt: null,
      },
    };
  });
  client.put("a", { text: "once" });
  await Promise.all([client.sync(), client.sync(), client.sync()]);
  assert.equal(sends, 1);
});
test("corrupt local metadata is not replaced by an empty workspace", () => {
  assert.throws(
    () =>
      createSyncClient({
        read: () => ({ version: 999 }),
        write: () => assert.fail("must not write"),
        request() {},
      }),
    (e) => e.code === "LOCAL_DATA_INVALID",
  );
});
test("only development simulator loopback may use HTTP; credentials cannot enter the URL", () => {
  assert.equal(
    normalizeServiceURL(" https://Sync.Example/ ", "release"),
    "https://sync.example",
  );
  assert.equal(
    normalizeServiceURL("http://127.0.0.1:8788", "develop"),
    "http://127.0.0.1:8788",
  );
  for (const value of [
    "http://127.0.0.1:8788",
    "http://192.168.0.1",
    "https://user:password@sync.example",
    "https://sync.example/path",
    "https://sync.example?key=secret",
  ])
    assert.throws(() => normalizeServiceURL(value, "release"));
});
