const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { AccountWorkspace } = require("./accounts.cjs");
const { DesktopStore } = require("./storage.cjs");

test("installed account status follows independent AI gates after refresh and restart", async t => {
  const { accountUIFixture } = await import("../scripts/account-ui-fixture.mjs");
  const { ReadingLedger } = await import("../server/reading/ledger.mjs");
  const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-status-gates-"));
  const ledger = new ReadingLedger(path.join(root, "ledger.sqlite"));
  ledger.freezePrice({ id: "synthetic", model: "synthetic", currency: "CNY", source: "synthetic test", verifiedAt: 1, inputMicrosPerMillion: 1, cachedMicrosPerMillion: 0, outputMicrosPerMillion: 1 });
  let paused = false, maintenance = false;
  ledger.dispatchGuard = () => { if (maintenance) throw Error("MAINTENANCE"); if (paused) throw Error("ADMIN_PAUSED"); };
  const f = await accountUIFixture({}, { reading: { credentials: true, ledger, enabled: true, priceId: "synthetic", modelVersion: "synthetic", reader() {}, provider() {} } });
  const options = { root: path.join(root, "client"), local: new DesktopStore(path.join(root, "local")), serviceOrigin: f.base, seal: async s => Buffer.from(s), unseal: async b => b.toString() };
  try {
    let client = new AccountWorkspace(options); await client.init();
    await client.action("register", { username: "status-owner", password: "synthetic-password", invite: f.invitation.invite, deviceName: "合成状态测试" });
    assert.equal(client.status().account.aiAvailability.available, true);
    paused = true; await client.action("sync", { force: true });
    assert.deepEqual(client.status().account.aiAvailability, { available: false, reason: "ADMIN_PAUSED" });
    client = new AccountWorkspace(options); await client.init(); await client.action("sync", { force: true });
    assert.equal(client.status().account.aiAvailability.reason, "ADMIN_PAUSED");
    paused = false; maintenance = true; await client.action("sync", { force: true });
    assert.equal(client.status().account.aiAvailability.reason, "MAINTENANCE");
    maintenance = false; await client.action("sync", { force: true });
    assert.equal(client.status().account.aiAvailability.available, true);
    assert.equal(client.status().account.usageSummary.daySpentMicro, 0);
  } finally { await f.close(); ledger.close(); await fs.rm(root, { recursive: true, force: true }); }
});

for (const scenario of ["stop", "settlement"])
  test(`installed XLSX adapter ${scenario === "stop" ? "stops without waiting for the provider" : "returns a settled wallet with a task completed during polling"}`, async (t) => {
    const { accountUIFixture } = await import(
      "../scripts/account-ui-fixture.mjs"
    );
    const { ReadingLedger } = await import("../server/reading/ledger.mjs");
    const { readMaterial } = await import("../server/reading/material.mjs");
    const { xlsxBytes, inline } = await import(
      "../server/reading/xlsx-fixtures.mjs"
    );
    const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-stop-client-"));
    const ledger = new ReadingLedger(path.join(root, "ledger.sqlite"));
    ledger.freezePrice({
      id: "fixture",
      model: "fixture",
      currency: "CNY",
      source: "synthetic",
      verifiedAt: 1,
      inputMicrosPerMillion: 1000000,
      cachedMicrosPerMillion: 0,
      outputMicrosPerMillion: 1000000,
    });
    let started,
      finish,
      aborted = false;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const fixture = await accountUIFixture(
      {},
      {
        reading: {
          enabled: true,
          ledger,
          priceId: "fixture",
          modelVersion: "fixture",
          reader: readMaterial,
          provider: async (sources, signal) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
              },
              { once: true },
            );
            started();
            await pending;
            return {
              usage: { prompt_tokens: 10, completion_tokens: 10 },
              result: {
                summary: "合成",
                warnings: [],
                items: [
                  {
                    kind: "note",
                    title: "合成要点",
                    summary: "合成",
                    facts: [],
                    nextSteps: [],
                    uncertainties: [],
                    due: null,
                    evidence: [
                      {
                        sourceId: sources[0].id,
                        quote: sources[0].text.slice(0, 10),
                      },
                    ],
                  },
                ],
              },
            };
          },
        },
      },
    );
    t.after(async () => {
      finish();
      await fixture.close();
      ledger.close();
      await fs.rm(root, { recursive: true, force: true });
    });
    ledger.grantInitial(fixture.invitation.userId);
    let settleOnPoll = false;
    const client = new AccountWorkspace({
      root: path.join(root, "client"),
      local: new DesktopStore(path.join(root, "local")),
      serviceOrigin: fixture.base,
      fetcher: async (url, init) => {
        if (settleOnPoll && url.endsWith("/api/v4/tasks")) {
          settleOnPoll = false;
          finish();
          const deadline = Date.now() + 5000;
          while (fixture.service.readingRoutes.snapshot().accounts) {
            assert.ok(
              Date.now() < deadline,
              "synthetic settlement did not finish",
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        return fetch(url, init);
      },
      seal: async (s) => Buffer.from(s),
      unseal: async (b) => b.toString(),
    });
    await client.init();
    await client.action("activate", { invite: fixture.invitation.invite });
    const bytes = xlsxBytes([
      {
        name: "资料表",
        xml: `<row r="1">${inline("A1", "合成完整材料😀。\n".repeat(scenario === "stop" ? 16000 : 100))}</row>`,
      },
    ]);
    await client.call(
      "savePackets",
      [
        {
          id: "stop-xlsx",
          text: "",
          sources: [],
          attachments: [
            {
              id: "original",
              name: "synthetic.xlsx",
              type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              bytes,
            },
          ],
          doneIds: [],
          capturedAt: "2026-11-11T00:00:00Z",
          captureDate: "2026-11-11",
          updatedAt: "2026-11-11T00:00:00Z",
          result: null,
          status: "pending",
        },
      ],
      client.config.active,
    );
    await client.action("sync");
    const submitted = await client.action("ai", {
      kind: "organize",
      packetId: "stop-xlsx",
    });
    await entered;
    if (scenario === "settlement") {
      settleOnPoll = true;
      const result = await client.action("sync", { force: true });
      assert.equal(
        result.jobs.find((j) => j.id === submitted.job).state,
        "done",
      );
      assert.equal(ledger.wallet(fixture.invitation.userId).spent, 20);
      assert.equal(
        result.account.wallet.spent,
        20,
        "completed task and returned wallet must include the same settlement",
      );
      return;
    }
    await client.action("sync");
    const start = performance.now();
    const stopped = await client.action("taskAction", {
      id: submitted.job,
      action: "stop",
    });
    assert.ok(
      performance.now() - start < 5000,
      "stop must not wait for the held provider result",
    );
    assert.equal(
      stopped.jobs.find((j) => j.id === submitted.job).state,
      "cancelled",
    );
    assert.equal(aborted, true);
    assert.equal(ledger.wallet(fixture.invitation.userId).spent, 0);
    assert.ok(
      ledger.wallet(fixture.invitation.userId).reserved > 0,
      "in-flight cost remains reserved until final evidence",
    );
  });

test("installed account adapter can enter restricted temporary-password login and change password before any material sync", async (t) => {
  const { createMultiUserService } = await import(
    "../server/sync-multi-user.mjs"
  );
  const { ReadingLedger } = await import("../server/reading/ledger.mjs");
  const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-temporary-client-"));
  const ledger = new ReadingLedger(path.join(root, "ledger.sqlite"));
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  const service = createMultiUserService({
    directory: path.join(root, "server"),
    secret: "synthetic-temporary-secret-".repeat(2),
    reading: {
      ledger,
      reader() {},
      provider() {
        throw Error("NO_MODEL_CALLS");
      },
      priceId: "synthetic",
      modelVersion: "synthetic",
      enabled: false,
      credentials: true,
      accountSafety: true,
      tenantSafety: true,
    },
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await service.quiesce();
    ledger.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const make = async (name) => {
    const client = new AccountWorkspace({
      root: path.join(root, name),
      local: new DesktopStore(path.join(root, name + "-local")),
      serviceOrigin: base,
      seal: async (v) => Buffer.from(v),
      unseal: async (v) => v.toString(),
    });
    await client.init();
    return client;
  };
  const original = await make("original"),
    [invite] = service.registry.generate(1);
  await original.action("register", {
    username: "synthetic",
    password: "synthetic-password",
    invite: invite.invite,
  });
  const user = original.config.devices[original.config.active].userId;
  const reset = await service.credentials.adminReset(
    user,
    "admin-reset",
    "operator",
  );
  const client = await make("new");
  const pending = await client.action("login", {
    username: "synthetic",
    password: reset.temporaryPassword,
  });
  assert.equal(pending.activation, "active");
  assert.equal(pending.account.authentication.passwordChangeRequired, true);
  await assert.rejects(
    client.request(client.config.active, "GET", "/api/v4/storage"),
    (e) => e.code === "PASSWORD_CHANGE_REQUIRED",
  );
  await client.action("password", {
    oldPassword: reset.temporaryPassword,
    newPassword: "new-synthetic-password",
    revokeAll: false,
  });
  assert.equal(
    client.status().account.authentication.passwordChangeRequired,
    false,
  );
  assert.equal(ledger.wallet(user).spent, 0);
});

test("installed polling coalesces reads, flushes edits, and preserves paid task state across 429 and 503", async (t) => {
  const { createMultiUserService } = await import(
    "../server/sync-multi-user.mjs"
  );
  const root = await fs.mkdtemp(path.join(tmpdir(), "shixu-rate-client-"));
  const service = createMultiUserService({
    directory: path.join(root, "server"),
    secret: "synthetic-rate-secret-".repeat(3),
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    await new Promise((done) => service.server.close(done));
    await fs.rm(root, { recursive: true, force: true });
  });
  const [invitation] = service.registry.generate(1),
    base = `http://127.0.0.1:${service.server.address().port}`;
  let requests = 0,
    transient = 0;
  const cloud = new AccountWorkspace({
    root: path.join(root, "client"),
    local: new DesktopStore(path.join(root, "local")),
    serviceOrigin: base,
    minimumReadIntervalMs: 10000,
    seal: async (v) => Buffer.from(v),
    unseal: async (v) => v.toString(),
    fetcher: async (url, init) => {
      requests++;
      if (url.endsWith("/api/v3/jobs/paid-task"))
        return transient
          ? new Response(
              JSON.stringify({
                error: "synthetic temporary failure",
                code: "RATE_LIMIT",
              }),
              {
                status: transient,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": "1",
                },
              },
            )
          : new Response(
              JSON.stringify({
                state: "paused",
                reason: "ADMIN_PAUSED",
                calls: 1,
              }),
              { headers: { "Content-Type": "application/json" } },
            );
      return fetch(url, init);
    },
  });
  await cloud.init();
  await cloud.action("activate", { invite: invitation.invite });
  const initial = requests;
  for (let i = 0; i < 100; i++) await cloud.action("sync");
  assert.equal(
    requests,
    initial,
    "UI wait loops must not exhaust server rate limits",
  );
  await cloud.call(
    "savePackets",
    [
      {
        id: "edit",
        text: "synthetic edit",
        sources: [],
        attachments: [],
        doneIds: [],
        result: null,
        status: "pending",
      },
    ],
    cloud.config.active,
  );
  await cloud.action("sync");
  assert.ok(requests > initial);
  assert.equal(cloud.space().client.pendingCount(), 0);
  cloud.writeJobs([
    {
      id: "paid-task",
      state: "running",
      calls: 1,
      request: { packetId: "edit", kind: "organize" },
    },
  ]);
  for (const status of [429, 503]) {
    transient = status;
    await assert.rejects(cloud.pollJobs(), (e) => e.status === status);
    assert.equal(cloud.readJobs()[0].state, "running");
    assert.equal(cloud.readJobs()[0].calls, 1);
    if (status === 429) {
      const count = requests;
      await cloud.action("sync");
      assert.equal(requests, count);
      await new Promise((done) => setTimeout(done, 1050));
    }
  }
  transient = 0;
  await cloud.pollJobs();
  assert.equal(cloud.readJobs()[0].state, "paused");
  assert.equal(cloud.readJobs()[0].reason, "ADMIN_PAUSED");
  assert.equal(cloud.readJobs()[0].calls, 1);
});
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
