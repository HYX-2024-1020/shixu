const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const files = require("../lib/files");
const transport = require("../lib/transport");

function filesystem() {
  const data = new Map(),
    dirs = new Set(),
    reads = [];
  return {
    data,
    reads,
    accessSync: (p) => {
      if (!dirs.has(p) && !data.has(p)) throw Error("missing");
    },
    mkdirSync: (p) => dirs.add(p),
    copyFileSync: (a, b) => {
      if (!data.has(a)) throw Error("missing original");
      data.set(b, Buffer.from(data.get(a)));
    },
    statSync: (p) => {
      if (!data.has(p)) throw Error("missing");
      return { size: data.get(p).length };
    },
    readFileSync: (p, encoding) => {
      reads.push(p);
      const b = data.get(p);
      if (!b) throw Error("missing");
      if (encoding) return b.toString(encoding);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    writeFileSync: (p, bytes) => data.set(p, Buffer.from(bytes)),
    unlinkSync: (p) => data.delete(p),
  };
}
function fixture({
  store = new Map(),
  fs = filesystem(),
  failWrite = () => false,
  request = () => assert.fail("unexpected network"),
} = {}) {
  let definition;
  const wx = {
    env: { USER_DATA_PATH: "/synthetic" },
    getFileSystemManager: () => fs,
    getStorageSync: (k) => store.get(k),
    setStorageSync: (k, v) => {
      if (failWrite(k, v)) throw Error("disk full");
      store.set(k, structuredClone(v));
    },
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    showToast() {},
    showModal: (o) => o.success({ confirm: true, content: "合成事项" }),
    request,
  };
  const requireFromPage = createRequire(
    resolve(__dirname, "../pages/index/index.js"),
  );
  const requireModule = (name) => {
    if (name.endsWith("/files"))
      return {
        ...files,
        createFileTransport: (base, token) =>
          files.createFileTransport(base, token, wx),
      };
    if (name.endsWith("/transport"))
      return {
        ...transport,
        createTransport: (base, token) =>
          transport.createTransport(base, token, wx),
      };
    return requireFromPage(name);
  };
  vm.runInNewContext(
    readFileSync(resolve(__dirname, "../pages/index/index.js"), "utf8"),
    {
      Page: (value) => (definition = value),
      getApp: () => ({ globalData: { updateReady: false } }),
      require: requireModule,
      wx,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    },
  );
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  page.onLoad();
  return { page, store, fs, wx };
}
const source = (f, body = Buffer.from("合成原件"), name = "通知.txt") => {
  f.fs.data.set("/chosen/file", body);
  return { path: "/chosen/file", name, size: body.length };
};
test("attachment-only capture persists original bytes and resumes after page restart", () => {
  const f = fixture();
  const chosen = source(f);
  f.page._collectFiles([chosen]);
  assert.equal(f.page.data.draftFiles.length, 1);
  f.page.submit();
  const record = f.page._client.records()[0];
  assert.equal(record.data.text, "");
  assert.equal(record.data.attachments.length, 1);
  assert.equal("path" in record.data.attachments[0], false);
  const reopened = fixture({ store: f.store, fs: f.fs });
  const entry = reopened.page._fileEntries(record.id, "local")[0];
  assert.equal(
    Buffer.from(reopened.page._library().bytes(entry)).toString(),
    "合成原件",
  );
});
test("a failed draft clear retries the same capture and same original rather than duplicating", () => {
  let fail = false;
  const f = fixture({
    failWrite: (key, value) => fail && key.includes(":draft:") && value === "",
  });
  f.page._collectFiles([source(f)]);
  const id = f.page._draftId;
  fail = true;
  f.page.submit();
  const reopened = fixture({ store: f.store, fs: f.fs });
  reopened.page.submit();
  assert.equal(reopened.page._client.records().length, 1);
  assert.equal(reopened.page._client.records()[0].id, id);
  assert.equal(reopened.page._client.records()[0].data.attachments.length, 1);
});
test("copy or manifest failure cannot fabricate a durable attachment", () => {
  const f = fixture();
  f.page._collectFiles([{ path: "/missing", name: "lost.txt", size: 10 }]);
  assert.equal(f.page.data.draftFiles.length, 0);
  assert.match(f.page.data.error, /missing original/);
  const full = fixture({ failWrite: (key) => key === files.KEY });
  full.page._collectFiles([source(full)]);
  assert.equal(full.page.data.draftFiles.length, 0);
  assert.match(full.page.data.error, /disk full/);
});
test("corrupted local paths are refused before any original bytes are read", () => {
  const fs = filesystem(),
    entry = {
      id: "a",
      packetId: "p",
      name: "x.txt",
      size: 3,
      type: "text/plain",
      space: "local",
      path: "C:/private/file",
    };
  const lib = files.createFileLibrary({
    read: () => ({ version: 1, entries: [entry] }),
    write() {},
    fs,
    root: "/synthetic/originals",
  });
  assert.throws(() => lib.bytes(entry), /路径无效/);
  assert.equal(fs.reads.length, 0);
});
test("remote file IDs reused in different packets cannot overwrite cached original bytes", () => {
  const fs = filesystem();
  let saved,
    n = 0;
  const lib = files.createFileLibrary({
    read: () => saved,
    write: (v) => (saved = v),
    fs,
    root: "/synthetic/originals",
    newId: () => `disk${++n}`,
  });
  const file = {
    id: "same-id",
    name: "a.txt",
    size: 3,
    type: "text/plain",
    hash: "a".repeat(64),
  };
  const a = lib.cache(
      file,
      "p",
      "https://first",
      new Uint8Array([1, 2, 3]).buffer,
    ),
    b = lib.cache(
      file,
      "q",
      "https://second",
      new Uint8Array([4, 5, 6]).buffer,
    );
  assert.notEqual(a, b);
  assert.deepEqual(
    [...new Uint8Array(lib.bytes(lib.entries("p")[0]))],
    [1, 2, 3],
  );
});
test("real HTTP upload acknowledgement loss retries the same bytes and retains local originals", async (t) => {
  const { createSyncService } = await import("../../server/sync-server.mjs");
  const service = createSyncService({
    database: ":memory:",
    password: "synthetic-file-ui-passphrase",
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => new Promise((resolve) => service.server.close(resolve)));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  let uploads = 0,
    drop = true;
  const f = fixture({
    request: async (options) => {
      try {
        const binary =
          options.header["Content-Type"] === "application/octet-stream";
        const response = await fetch(options.url, {
          method: options.method,
          headers: options.header,
          ...(options.data
            ? { body: binary ? options.data : JSON.stringify(options.data) }
            : {}),
        });
        if (options.method === "PUT") {
          uploads++;
          if (drop) {
            drop = false;
            options.fail();
            return;
          }
        }
        const data =
          options.responseType === "arraybuffer"
            ? await response.arrayBuffer()
            : await response.json();
        options.success({ statusCode: response.status, data });
      } catch (error) {
        options.fail(error);
      }
    },
  });
  f.page._collectFiles([source(f)]);
  f.page.submit();
  const id = f.page.data.currentCaptureId;
  f.page.setData({ serverUrl: base, password: "synthetic-file-ui-passphrase" });
  await f.page.connect();
  assert.equal(f.page.data.connected, true);
  await f.page.importLocal();
  assert.equal(f.page.data.pendingFiles, 1);
  assert.match(f.page.data.error, /原件/);
  await f.page.sync();
  assert.equal(f.page.data.error, "");
  assert.equal(f.page.data.pendingFiles, 0);
  assert.equal(uploads, 2);
  assert.equal(
    service.store.db.prepare("SELECT COUNT(*) AS n FROM sync_attachments").get()
      .n,
    1,
  );
  const record = service.store.record(id);
  assert.equal(record.data.attachments.length, 1);
  assert.equal(
    service.files.get(id, record.data.attachments[0].id).body.toString(),
    "合成原件",
  );
  assert.equal(
    f.page._localWorkspace().records()[0].data.attachments.length,
    1,
  );
  const second = fixture({ request: f.wx.request });
  second.page.setData({
    serverUrl: base,
    password: "synthetic-file-ui-passphrase",
  });
  await second.page.connect();
  await second.page.openAttachment({
    currentTarget: {
      dataset: { id: record.data.attachments[0].id, packet: id },
    },
  });
  assert.equal(second.page.data.error, "");
  assert.equal(second.page.data.originalPreview.text, "合成原件");
  let received, release;
  const arrival = new Promise((resolve) => (received = resolve)),
    gate = new Promise((resolve) => (release = resolve));
  const third = fixture({
    request: (options) =>
      f.wx.request(
        options.url.includes("/attachments/") && options.method === "GET"
          ? {
              ...options,
              success: async (response) => {
                received();
                await gate;
                options.success(response);
              },
            }
          : options,
      ),
  });
  third.page.setData({
    serverUrl: base,
    password: "synthetic-file-ui-passphrase",
  });
  await third.page.connect();
  const inflight = third.page.openAttachment({
    currentTarget: {
      dataset: { id: record.data.attachments[0].id, packet: id },
    },
  });
  await arrival;
  third.page._client.remove(id);
  third.page._refresh();
  release();
  await inflight;
  assert.match(third.page.data.error, /状态已变化/);
  assert.equal(
    third.page._library().entries(id, base).length,
    0,
    "a deleted packet cannot cache a late download",
  );
});

test("text original preview reads its saved bytes and never changes the original", async () => {
  const f = fixture(),
    chosen = source(f);
  f.page._collectFiles([chosen]);
  f.page.submit();
  const record = f.page._client.records()[0],
    file = record.data.attachments[0];
  await f.page.openAttachment({
    currentTarget: { dataset: { id: file.id, packet: record.id } },
  });
  assert.equal(f.page.data.originalPreview.text, "合成原件");
  assert.equal(f.page.data.error, "");
  assert.equal(f.page._fileEntries(record.id, "local")[0].size, chosen.size);
});
test("invalid upload confirmations cannot enter the sync outbox or mark an original uploaded", () => {
  const f = fixture();
  f.page._collectFiles([source(f)]);
  const entry = f.page._fileEntries(f.page._draftId)[0],
    library = f.page._library();
  assert.throws(
    () =>
      library.confirmation(entry, {
        ...entry,
        size: 1000,
        hash: "a".repeat(64),
      }),
    /确认不完整/,
  );
  const confirmed = library.confirmation(entry, {
    ...entry,
    hash: "a".repeat(64),
    path: "C:/should-not-sync",
  });
  assert.equal("path" in confirmed, false);
  assert.equal(library.entries()[0].remote, null);
});

test("permanent cache cleanup preserves an explicitly retained copy in another workspace", () => {
  const f = fixture();
  f.page._collectFiles([source(f)]);
  const id = f.page._draftId,
    library = f.page._library();
  library.assign(id, "local");
  const original = library.entries(id, "local")[0];
  library.copySpace(id, "local", "https://synthetic-service");
  library.forgetPacket(id, "https://synthetic-service");
  assert.equal(f.fs.data.has(original.path), true);
  assert.equal(library.entries(id, "local").length, 1);
  library.forgetPacket(id, "local");
  assert.equal(f.fs.data.has(original.path), false);
  assert.equal(library.entries(id).length, 0);
});
