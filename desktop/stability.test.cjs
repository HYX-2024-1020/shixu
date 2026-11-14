const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { createHash } = require("node:crypto");
const { DesktopStore } = require("./storage.cjs");
const { CloudWorkspace } = require("./cloud.cjs");
const { AccountWorkspace } = require("./accounts.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-stability-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
test("permanent item tombstone removes private fields and rejects resurrection after database restart", async (t) => {
  let store;
  t.after(() => store?.close());
  const root = await fixture(t);
  const { SyncStore } = await import("../server/sync-store.mjs");
  store = new SyncStore(path.join(root, "sync.sqlite"));
  const device = store.createDevice("synthetic");
  const apply = (opId, baseVersion, data) =>
    store.apply(
      device.deviceId,
      { opId, id: "packet", type: "put", baseVersion, data },
      store.epoch,
    );
  apply("create", 0, {
    text: "synthetic",
    itemState: {
      item: {
        deletedAt: "2026-11-14",
        checkins: ["private-checkin"],
        chat: ["private-chat"],
        additions: ["private-addition"],
      },
    },
  });
  apply("purge", 1, {
    itemState: { item: { purgedAt: "2026-11-14T00:00:00Z" } },
  });
  assert.deepEqual(store.record("packet").data.itemState.item, {
    purgedAt: "2026-11-14T00:00:00Z",
  });
  store.close();
  store = new SyncStore(path.join(root, "sync.sqlite"));
  apply("stale-content", 2, {
    itemState: { item: { chat: ["resurrected"], checkins: ["resurrected"] } },
  });
  assert.deepEqual(store.record("packet").data.itemState.item, {
    purgedAt: "2026-11-14T00:00:00Z",
  });
});
test("client optimistic item tombstone scrubs old fields before sync", () => {
  const { createSyncClient } = require("../miniprogram/lib/sync-client.js");
  let state = {
    version: 1,
    epoch: "e",
    cursor: 0,
    records: {
      packet: {
        id: "packet",
        version: 1,
        deletedAt: null,
        purged: false,
        data: { id: "packet", itemState: { item: { chat: ["secret"] } } },
      },
    },
    outbox: [],
    conflicts: [],
  };
  const client = createSyncClient({
    read: () => state,
    write: (v) => {
      state = v;
    },
    makeId: () => "op",
    request: () => {
      throw Error("offline");
    },
  });
  client.put("packet", { itemState: { item: { purgedAt: "2026-11-14" } } });
  assert.deepEqual(client.records()[0].data.itemState.item, {
    purgedAt: "2026-11-14",
  });
});
test("retry rewrites a damaged existing hash file before reporting saved", async (t) => {
  const root = await fixture(t),
    store = new DesktopStore(root);
  await store.load();
  const bytes = Buffer.from("synthetic-original-27-bytes!");
  const hash = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(store.file("files/" + hash), bytes.subarray(0, 5));
  const descriptors = await store.encode([
    {
      id: "original",
      name: "synthetic.txt",
      type: "text/plain",
      size: bytes.length,
      bytes,
    },
  ]);
  assert.deepEqual(await fs.readFile(store.file("files/" + hash)), bytes);
  assert.equal(
    (await store.decode(descriptors))[0].bytes.byteLength,
    bytes.length,
  );
});
test("hashed draft above server limit cannot enter durable sync queue", async (t) => {
  const root = await fixture(t),
    cloud = new CloudWorkspace({
      root,
      local: new DesktopStore(path.join(root, "local")),
    });
  cloud.config = {
    active: "https://synthetic.invalid",
    devices: { "https://synthetic.invalid": { deviceId: "device" } },
  };
  const cache = cloud.space().cache;
  await cache.load();
  const bytes = Buffer.alloc(11 * 1024 * 1024, 1),
    hash = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(cache.file("files/" + hash), bytes);
  await assert.rejects(
    cloud.call(
      "savePackets",
      [
        {
          id: "large",
          text: "synthetic",
          attachments: [
            {
              id: "file",
              name: "synthetic.bin",
              type: "application/octet-stream",
              size: bytes.length,
              hash,
            },
          ],
        },
      ],
      cloud.config.active,
    ),
    /10 MiB|10MiB/,
  );
  assert.equal(cloud.space().client.pendingCount(), 0);
});
test("identity change clears account-derived metadata even when refresh fails", async (t) => {
  const root = await fixture(t),
    cloud = new AccountWorkspace({
      root,
      seal: async (s) => Buffer.from(s),
      unseal: async (b) => b.toString(),
    });
  cloud.config = {
    active: "account:a",
    devices: { "account:a": { userId: "a" } },
    keys: {},
  };
  cloud.accountState = { authentication: { username: "A" } };
  cloud.originalStorage = { originals: [{ name: "A-only.txt" }] };
  cloud.originalDownload = { path: "A-only-path" };
  cloud.deviceList = [{ name: "A-device" }];
  await cloud.configure({
    ...cloud.config,
    active: "account:b",
    devices: { "account:b": { userId: "b" } },
  });
  const state = cloud.status();
  assert.equal(state.account, null);
  assert.ok(!state.originalStorage);
  assert.equal(state.originalDownload, null);
  assert.deepEqual(state.devices, []);
});
test("a retained default card's old paused task cannot block a new chat", async (t) => {
  const root = await fixture(t),
    cloud = new AccountWorkspace({ root });
  cloud.config = {
    active: "synthetic",
    devices: { synthetic: { userId: "owner", epoch: "epoch" } },
  };
  cloud.accountState = {
    reading: { features: { itemChat: true, attachmentChat: true } },
  };
  cloud.space = () => ({
    cache: { file: (name) => path.join(root, name) },
    client: {
      records: () => [{ id: "packet", version: 1 }],
      pendingCount: () => 0,
      conflicts: () => [],
    },
  });
  cloud.sync = async () => cloud.status();
  cloud.requireMaterialConsent = () => {};
  cloud.reuploadTemporary = async () => {};
  cloud.writeJobs([
    {
      id: "old",
      state: "paused",
      disposition: "kept",
      protocol: 4,
      request: { packetId: "packet", kind: "organize" },
      actions: [],
    },
  ]);
  cloud.pollJobs = async () => {};
  const result = await cloud.createAI({
    packetId: "packet",
    itemId: "item",
    kind: "chat",
    instruction: "synthetic edit",
    scope: "item",
    readAttachments: false,
  });
  assert.ok(result.job);
  assert.notEqual(result.job, "old");
  assert.equal(cloud.readJobs().length, 2);
});
test("partial disk write never publishes a hash file and retry saves complete bytes", async (t) => {
  const root = await fixture(t),
    store = new DesktopStore(root);
  await store.load();
  const originalOpen = fs.open,
    bytes = Buffer.from("synthetic-interrupted-write");
  let inject = true;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (inject && String(args[0]).endsWith(".tmp")) {
      inject = false;
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (data) => {
        await write(data.subarray(0, 5));
        throw Object.assign(Error("synthetic full disk"), { code: "ENOSPC" });
      };
    }
    return handle;
  };
  try {
    const input = [
      {
        id: "f",
        name: "synthetic.txt",
        type: "text/plain",
        size: bytes.length,
        bytes,
      },
    ];
    await assert.rejects(store.encode(input), { code: "ENOSPC" });
    assert.deepEqual(await fs.readdir(store.file("files")), []);
    const result = await store.encode(input);
    assert.equal(
      (await store.decode(result))[0].bytes.byteLength,
      bytes.length,
    );
  } finally {
    fs.open = originalOpen;
  }
});
test("permanent upload rejection isolates dependent operations while unrelated packets sync after restart", async () => {
  const { createSyncClient } = require("../miniprogram/lib/sync-client.js");
  let snapshot = null,
    sequence = 0,
    version = 0;
  const records = new Map();
  const request = async (method, url, data) => {
    if (url.endsWith("/status"))
      return { application: "shixu-sync", protocolVersion: 2, epoch: "e" };
    if (url.includes("/changes?"))
      return {
        epoch: "e",
        cursor: version,
        records: [...records.values()],
        more: false,
      };
    if (url.endsWith("/operations")) {
      const op = data.operation;
      if (op.id === "bad")
        throw Object.assign(Error("invalid size"), {
          code: "INVALID_MANIFEST",
        });
      const record = {
        id: op.id,
        version: ++version,
        deletedAt: null,
        purged: false,
        data: { ...op.data, id: op.id },
      };
      records.set(op.id, record);
      return { opId: op.opId, record, acceptedVersion: version };
    }
    throw Error(url);
  };
  const make = () =>
    createSyncClient({
      read: () => snapshot,
      write: (s) => {
        snapshot = s;
      },
      request,
      makeId: () => `op${++sequence}`,
    });
  let client = make();
  client.put("bad", { text: "retain synthetic original", attachments: [] });
  client.put("bad", { text: "second edit" });
  client.put("good", { text: "independent" });
  await client.sync();
  client = make();
  assert.equal(client.pendingCount(), 0);
  assert.equal(client.conflicts().length, 1);
  assert.equal(client.conflicts()[0].local.data.text, "second edit");
  assert.equal(records.get("good").data.text, "independent");
});
test("late response from old identity never repopulates account state", async (t) => {
  const root = await fixture(t);
  let release;
  const cloud = new AccountWorkspace({
    root,
    seal: async (s) => Buffer.from(s),
    fetcher: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  cloud.config = { active: "account:a", devices: {}, keys: {} };
  const pending = cloud.request("account:a", "GET", "/api/v3/account");
  await cloud.configure({ active: "account:b", devices: {}, keys: {} });
  release({
    ok: true,
    json: async () => ({ authentication: { username: "A" } }),
  });
  await assert.rejects(pending, { code: "ACCOUNT_CHANGED" });
  assert.equal(cloud.accountState, null);
});
test("signed cloud original purge is atomic, shared bytes survive and orphan capture can be stopped without AI", async (t) => {
  const { accountUIFixture } = await import(
    "../scripts/account-ui-fixture.mjs"
  );
  const { ReadingLedger } = await import("../server/reading/ledger.mjs");
  const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-stability-http-")),
    ledger = new ReadingLedger(path.join(root, "ledger.sqlite"));
  ledger.freezePrice({
    id: "fixture",
    model: "fixture",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  let calls = 0;
  const f = await accountUIFixture(
    {},
    {
      reading: {
        ledger,
        enabled: true,
        priceId: "fixture",
        modelVersion: "fixture",
        reader: async () => {
          throw Error("must not read");
        },
        provider: async () => {
          calls++;
          throw Error("must not call");
        },
      },
    },
  );
  // Close database handles before fixture directory cleanup on Windows.
  t.after(async () => {
    await f.close();
    ledger.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  ledger.grantInitial(f.invitation.userId);
  const client = new AccountWorkspace({
    root: path.join(root, "client"),
    serviceOrigin: f.base,
    local: new DesktopStore(path.join(root, "local")),
    seal: async (s) => Buffer.from(s),
    unseal: async (b) => b.toString(),
  });
  await client.init();
  await client.action("activate", { invite: f.invitation.invite });
  const bytes = Buffer.from("shared synthetic original"),
    make = (id) => ({
      id,
      text: "synthetic",
      sources: [],
      attachments: [
        {
          id: "file",
          name: "synthetic.txt",
          type: "text/plain",
          bytes,
          size: bytes.length,
        },
      ],
      doneIds: [],
      capturedAt: "2026-11-13T00:00:00Z",
      updatedAt: "2026-11-13T00:00:00Z",
      captureDate: "2026-11-13",
      status: "pending",
      result: null,
    });
  await client.call(
    "savePackets",
    [make("first"), make("shared")],
    client.config.active,
  );
  await client.action("sync", { force: true });
  assert.equal(
    (await client.packets()).find((p) => p.id === "first").status,
    "error",
    "orphan is actionable instead of spinning",
  );
  const walletBefore = structuredClone(client.status().account.wallet);
  await client.action("stopPacket", { packetId: "first" });
  assert.equal(
    client
      .space()
      .client.records()
      .find((r) => r.id === "first").data.status,
    "error",
  );
  let packet = (await client.packets()).find((p) => p.id === "first");
  packet.attachments[0].deletedAt = new Date().toISOString();
  await client.call("savePackets", [packet], client.config.active);
  await client.action("sync", { force: true });
  const row = client
    .space()
    .client.records()
    .find((r) => r.id === "first");
  const originals = await client.request(
    client.config.active,
    "GET",
    "/api/v4/storage?packetId=first&includeDeleted=true",
  );
  assert.equal(originals.originals.length, 1);
  const request = {
    contractVersion: 1,
    operationId: "synthetic-stale",
    packetId: "first",
    id: "file",
    baseVersion: row.version - 1,
    expectedVersion: originals.originals[0].version,
    epoch: client.config.devices[client.config.active].epoch,
  };
  await assert.rejects(
    client.request(
      client.config.active,
      "POST",
      "/api/v4/originals/purge-reference",
      request,
    ),
    (e) => e.code === "REVISION_CONFLICT",
  );
  assert.equal(
    (
      await client.request(
        client.config.active,
        "GET",
        "/api/v4/storage?packetId=first&includeDeleted=true",
      )
    ).originals[0].state,
    "available",
  );
  await client.action("purgeAttachment", { packetId: "first", id: "file" });
  assert.equal(
    (await client.packets()).find((p) => p.id === "first").attachments.length,
    0,
  );
  const all = await client.request(
    client.config.active,
    "GET",
    "/api/v4/storage",
  );
  assert.equal(
    all.originals.find((f) => f.packetId === "first").state,
    "deleted",
  );
  assert.equal(
    all.originals.find((f) => f.packetId === "shared").available,
    true,
  );
  assert.deepEqual(
    (await client.packets()).find((p) => p.id === "shared").attachments[0]
      .bytes,
    Uint8Array.from(bytes).buffer,
  );
  assert.deepEqual(client.status().account.wallet, walletBefore);
  assert.equal(calls, 0);
});
