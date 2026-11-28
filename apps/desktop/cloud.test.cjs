const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { CloudWorkspace, serviceURL } = require("./cloud.cjs");
const { DesktopStore } = require("./storage.cjs");
const packet = (id, text) => ({
  id,
  text,
  sources: [{ id: "input", name: "随手输入", text }],
  attachments: [],
  capturedAt: "2026-10-24T00:00:00.000Z",
  captureDate: "2026-10-24",
  updatedAt: "2026-10-24T00:00:00.000Z",
  status: "ready",
  result: { summary: text, items: [], warnings: [] },
  error: "",
  doneIds: [],
  itemState: {},
});
test("desktop and WeChat queue round trip, durable offline edits, originals, conflicts, deletion and workspace isolation", async () => {
  const { createSyncService } = await import("../server/sync-server.mjs");
  const { createSyncClient } = require("../miniprogram/lib/sync-client.js");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shixu-cloud-test-"));
  const password = "synthetic-password-cloud-test";
  const service = createSyncService({
    database: path.join(root, "server.sqlite"),
    password,
  });
  await new Promise((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${service.server.address().port}`;
  let online = true,
    loseAck = false;
  const seal = async (s) => Buffer.from(s).map((x) => x ^ 42),
    unseal = async (b) =>
      Buffer.from(b)
        .map((x) => x ^ 42)
        .toString();
  const local = new DesktopStore(path.join(root, "local"));
  const options = {
    root: path.join(root, "desktop"),
    local,
    seal,
    unseal,
    fetcher: async (...args) => {
      if (!online) throw Error("offline");
      const response = await fetch(...args);
      const op =
        args[1]?.method === "POST" && args[1]?.body
          ? JSON.parse(args[1].body).operation
          : null;
      if (loseAck && op && !op.opId.endsWith("_originals")) {
        loseAck = false;
        throw Error("lost acknowledgement");
      }
      return response;
    },
  };
  let cloud = new CloudWorkspace(options);
  await cloud.init();
  const localPacket = packet("local-only", "本机保留");
  await cloud.serial(() => cloud.call("savePackets", [localPacket], ""));
  try {
    await cloud.action("connect", { base, password });
    assert.equal(
      (await cloud.serial(() => cloud.call("packets", null, base))).length,
      0,
    );
    assert.equal("token" in cloud.status(), false);
    assert.equal(
      (
        await fs.readFile(path.join(root, "desktop", "connection.enc"), "utf8")
      ).includes(password),
      false,
    );
    const d = await fetch(base + "/api/v2/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, name: "WeChat synthetic" }),
    }).then((r) => r.json());
    let miniState;
    const request = async (method, api, data) => {
      const r = await fetch(base + api, {
        method,
        headers: {
          Authorization: `Bearer ${d.token}`,
          "Content-Type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      const body = await r.json();
      if (!r.ok) throw Object.assign(Error(body.error), body);
      return body;
    };
    const mini = createSyncClient({
      read: () => miniState,
      write: (s) => {
        miniState = s;
      },
      request,
    });
    const text = packet("round-trip", "双端测试");
    text.itemState = {
      item_1: {
        starred: true,
        chat: [
          { id: "chat1", role: "user", text: "保留上下文", at: "2026-10-24" },
        ],
        checkins: ["2026-10-24"],
      },
    };
    text.attachments = [
      {
        id: "file_1",
        name: "sample.txt",
        type: "text/plain",
        size: 3,
        bytes: Uint8Array.from([65, 66, 67]).buffer,
      },
    ];
    await cloud.serial(() => cloud.call("savePackets", [text], base));
    loseAck = true;
    await assert.rejects(cloud.action("sync"), /lost acknowledgement/);
    cloud = new CloudWorkspace(options);
    await cloud.init();
    await cloud.action("sync");
    await mini.sync();
    assert.equal(
      mini.records().length,
      1,
      "lost original acknowledgement replays without duplication",
    );
    assert.equal(
      (await cloud.serial(() => cloud.call("packets", null, base)))[0]
        .syncAutoOrganize,
      true,
    );
    assert.equal(mini.records()[0].data.text, "双端测试");
    assert.deepEqual(mini.records()[0].data.itemState, text.itemState);
    assert.equal(mini.records()[0].data.attachments[0].size, 3);
    const bytes = Buffer.from(
      await fetch(
        base + `/api/v2/attachments/round-trip/file_1?epoch=${d.epoch}`,
        { headers: { Authorization: `Bearer ${d.token}` } },
      ).then((r) => r.arrayBuffer()),
    );
    assert.equal(bytes.toString(), "ABC");
    const stale = (
      await cloud.serial(() => cloud.call("packets", null, base))
    )[0];
    mini.put("round-trip", { text: "手机较新的版本" });
    await mini.sync();
    await cloud.action("sync");
    await assert.rejects(
      cloud.serial(() => cloud.call("savePackets", [stale], base)),
      /已有新修改/,
    );
    assert.equal(
      (await cloud.serial(() => cloud.call("packets", null, base)))[0].text,
      "手机较新的版本",
    );
    online = false;
    let desktopPacket = (
      await cloud.serial(() => cloud.call("packets", null, base))
    )[0];
    desktopPacket.text = "离线 Windows 修改";
    await cloud.serial(() => cloud.call("savePackets", [desktopPacket], base));
    await assert.rejects(cloud.action("sync"), /offline/);
    cloud = new CloudWorkspace(options);
    await cloud.init();
    assert.ok(cloud.status().pending > 0);
    mini.put("round-trip", { text: "手机同时修改" });
    await mini.sync();
    online = true;
    await cloud.action("sync");
    assert.equal(cloud.status().conflicts.length, 1);
    await cloud.action("resolve", { id: "round-trip", keep: true });
    await cloud.action("sync");
    await mini.sync();
    assert.equal(mini.records().filter((r) => !r.purged).length, 2);
    assert.ok(mini.records().some((r) => r.data?.text === "离线 Windows 修改"));
    mini.remove("round-trip");
    await mini.sync();
    await cloud.action("sync");
    desktopPacket = (
      await cloud.serial(() => cloud.call("packets", null, base))
    ).find((p) => p.id === "round-trip");
    assert.ok(desktopPacket.deletedAt);
    delete desktopPacket.deletedAt;
    await cloud.serial(() => cloud.call("savePackets", [desktopPacket], base));
    await cloud.action("sync");
    await mini.sync();
    assert.equal(
      mini.records().find((r) => r.id === "round-trip").deletedAt,
      null,
    );
    mini.remove("round-trip");
    await mini.sync();
    await cloud.action("sync");
    await cloud.serial(() => cloud.call("removePacket", "round-trip", base));
    await cloud.action("sync");
    await mini.sync();
    assert.equal(
      mini.records().find((r) => r.id === "round-trip").purged,
      true,
    );
    await cloud.action("local");
    await assert.rejects(
      cloud.serial(() => cloud.call("savePackets", [text], base)),
      /空间已切换/,
    );
    assert.deepEqual(await local.call("packets"), [localPacket]);
  } finally {
    await new Promise((resolve) => service.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("cloud service address validation", () => {
  assert.equal(serviceURL("http://127.0.0.1:18788"), "http://127.0.0.1:18788");
  assert.equal(
    serviceURL("https://sync.example.test/"),
    "https://sync.example.test",
  );
  for (const value of [
    "http://example.test",
    "https://a:b@example.test",
    "https://example.test/path",
    "https://example.test?token=x",
    "file:///tmp/x",
  ])
    assert.throws(() => serviceURL(value));
});
