const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { AccountWorkspace } = require("./accounts.cjs");
const { DesktopStore } = require("./storage.cjs");
test("Windows activation retains an encrypted signing identity across lost replies, isolates accounts and routes AI through the server", async (t) => {
  const { createMultiUserService } = await import(
    "../server/sync-multi-user.mjs"
  );
  const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-account-client-"));
  let calls = 0,
    drop = true,
    loseNextStatus = false;
  const service = createMultiUserService({
    directory: path.join(root, "server"),
    secret: "synthetic-client-secret-with-32-characters",
    aiLimits: { enabled: true, taskBudgetMicros: 10, dailyBudgetMicros: 100 },
    ai: {
      organize: async () => {
        calls++;
        return {
          result: {
            summary: "合成",
            items: [{ title: "合成待办", kind: "task" }],
            warnings: [],
          },
        };
      },
    },
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => service.server.close(done));
    assert.ok(root.startsWith(path.join(tmpdir(), "shixu-account-client-")));
    await fs.rm(root, { recursive: true, force: true });
  });
  const invitations = service.registry.generate(2),
    base = `http://127.0.0.1:${service.server.address().port}`;
  const options = {
    root: path.join(root, "client"),
    local: new DesktopStore(path.join(root, "local")),
    serviceOrigin: base,
    seal: async (v) => Buffer.from(v).map((n) => n ^ 42),
    unseal: async (v) =>
      Buffer.from(v)
        .map((n) => n ^ 42)
        .toString(),
    fetcher: async (url, init) => {
      if (loseNextStatus && url.endsWith("/api/v3/status")) {
        loseNextStatus = false;
        throw Error("synthetic first sync offline");
      }
      const response = await fetch(url, init);
      if (drop && url.endsWith("/activate/windows")) {
        drop = false;
        throw Error("lost reply");
      }
      return response;
    },
  };
  let cloud = new AccountWorkspace(options);
  await cloud.init();
  await assert.rejects(
    cloud.action("activate", { invite: invitations[0].invite }),
    /lost reply/,
  );
  cloud = new AccountWorkspace(options);
  await cloud.init();
  loseNextStatus = true;
  await cloud.action("activate", { invite: invitations[0].invite });
  assert.match(cloud.status().error, /first sync offline/);
  await cloud.action("sync");
  assert.equal(
    service.registry.db
      .prepare("SELECT COUNT(*) AS n FROM bindings WHERE revoked=0")
      .get().n,
    1,
  );
  assert.ok(!JSON.stringify(cloud.status()).includes("PRIVATE KEY"));
  assert.ok(!JSON.stringify(cloud.status()).includes("sx3_"));
  const originalSpace = cloud.config.active;
  const packet = {
    id: "packet",
    text: "明天交报告",
    sources: [],
    attachments: [
      {
        id: "file",
        name: "fixture.txt",
        type: "text/plain",
        bytes: Buffer.from("合成原件"),
      },
    ],
    status: "pending",
    result: null,
    itemState: {},
    doneIds: [],
    captureDate: "2026-10-25",
    capturedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await cloud.call("savePackets", [packet], originalSpace);
  await cloud.action("sync");
  await cloud.action("ai", { packetId: "packet", kind: "organize" });
  for (let i = 0; i < 50; i++) {
    await cloud.action("sync");
    if ((await cloud.packets())[0].result) break;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal((await cloud.packets())[0].result.items[0].title, "合成待办");
  assert.equal(calls, 1);
  await cloud.call(
    "saveDraft",
    { text: "A账号草稿", attachments: [] },
    originalSpace,
  );
  await cloud.action("activate", { invite: invitations[1].invite });
  assert.equal((await cloud.packets()).length, 0);
  assert.equal((await cloud.call("draft", null, cloud.config.active)).text, "");
  await cloud.action("activate", { invite: invitations[0].invite });
  assert.equal(
    (await cloud.call("draft", null, originalSpace)).text,
    "A账号草稿",
  );
  await cloud.action("local");
  assert.equal(cloud.status().base, "");
  await cloud.action("resume");
  assert.equal(cloud.config.active, originalSpace);
  service.registry.revoke(invitations[0].userId, "windows");
  await assert.rejects(cloud.action("sync"), (e) => e.code === "UNAUTHORIZED");
  assert.equal((await cloud.packets()).length, 1);
});
