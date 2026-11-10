import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountRegistry } from "./sync-accounts.mjs";
import { AccountsV4 } from "./accounts-v4.mjs";
import { AccountSafety } from "./account-safety.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { AdminBackend } from "./admin-backend.mjs";
import { SyncStore } from "./sync-store.mjs";
import { createReadingRoutes } from "./reading/routes.mjs";
import { createAttachmentStore } from "./sync-files.mjs";
import { ReadingTasks } from "./reading/tasks.mjs";
import { createAdminService, hashAdminPassword } from "./admin-service.mjs";

const price = {
  id: "synthetic",
  model: "synthetic",
  currency: "CNY",
  source: "synthetic",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 0,
  outputMicrosPerMillion: 1000000,
};
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "shixu-management-"));
  const registry = new AccountRegistry(
    join(root, "data"),
    "synthetic-management-secret-".repeat(2),
  );
  const ledger = new ReadingLedger(join(root, "ledger.sqlite"));
  const credentials = new AccountsV4(registry);
  new AccountSafety(registry, ledger);
  const users = [];
  for (let i = 0; i < 2; i++) {
    const invite = registry.generate(1)[0],
      identity = {
        kind: "windows",
        identity: String(i).repeat(64),
        publicKey: "synthetic-only",
        name: "合成设备" + i,
      };
    const response = await credentials.register(
      {
        username: "synthetic" + i,
        password: "old-synthetic-password",
        invite: invite.invite,
        operationId: "register-" + i,
      },
      identity,
      "synthetic-" + i,
    );
    ledger.grantInitial(invite.userId);
    users.push({ id: invite.userId, identity, binding: response.binding });
  }
  const backend = new AdminBackend({
    path: join(root, "ops.sqlite"),
    registry,
    credentials,
    ledger,
    directory: root,
    routes: { snapshot: () => ({ running: 0, waiting: 0 }) },
  });
  t.after(() => {
    backend.close();
    credentials.close();
    registry.close();
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, registry, ledger, credentials, backend, users };
}
test("quota grants survive acknowledgement loss without duplicate credit or erasing safety and cannot reuse an operation for another target", async (t) => {
  const {
    ledger,
    backend,
    users: [a, b],
  } = await fixture(t);
  backend.control(a.id, true, "pause-first", "operator");
  const original = ledger.grantAdditional.bind(ledger);
  let once = true;
  ledger.grantAdditional = (...args) => {
    const result = original(...args);
    if (once) {
      once = false;
      throw Error("synthetic-ack-loss");
    }
    return result;
  };
  await assert.rejects(
    backend.topup(a.id, 1234567, "合成补额", "grant-test-1", "operator"),
    /ack-loss/,
  );
  const result = await backend.topup(
    a.id,
    1234567,
    "合成补额",
    "grant-test-1",
    "operator",
  );
  assert.equal(result.grantedMicro, 21234567);
  await backend.topup(a.id, 1234567, "合成补额", "grant-test-1", "operator");
  await assert.rejects(
    backend.topup(b.id, 1234567, "合成补额", "grant-test-1", "operator"),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.throws(
    () => backend.control("site", false, "grant-test-1", "operator"),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.throws(() => backend.assertDispatch(a.id), /ADMIN_PAUSED/);
  assert.equal(ledger.wallet(b.id).granted, 20000000);
  assert.equal(
    backend.audits().filter((a) => a.action === "quota-add").length,
    1,
  );
  assert.equal(ledger.audit(a.id).valid, true);
  assert.throws(
    () => backend.db.exec("DELETE FROM operation_intents"),
    /APPEND_ONLY/,
  );
});
test("management revocation and password reset use independent account safety; temporary login is single use and no secret persists in operation receipts", async (t) => {
  const {
    ledger,
    backend,
    credentials,
    registry,
    users: [a, b],
  } = await fixture(t);
  await assert.rejects(
    backend.revokeDevice(a.id, b.binding.id, "wrong-device", "operator"),
    (e) => e.code === "DEVICE_NOT_FOUND",
  );
  await backend.revokeDevice(a.id, a.binding.id, "revoke-device", "operator");
  assert.throws(() => registry.authenticate(a.binding.token));
  assert.doesNotThrow(() => registry.authenticate(b.binding.token));
  const wallet = ledger.wallet(a.id);
  const reset = await backend.resetPassword(a.id, "reset-password", "operator");
  assert.equal(
    (await backend.resetPassword(a.id, "reset-password", "operator"))
      .temporaryPassword,
    reset.temporaryPassword,
  );
  assert.equal(
    JSON.stringify(
      registry.db.prepare("SELECT * FROM account_v4_operations").all(),
    ).includes(reset.temporaryPassword),
    false,
  );
  const identity = { ...a.identity, identity: "2".repeat(64) };
  const value = {
    username: "synthetic0",
    password: reset.temporaryPassword,
    operationId: "login-temporary",
  };
  const login = await credentials.login(value, identity, "synthetic-login");
  assert.equal(
    (await credentials.login(value, identity, "synthetic-login")).binding.id,
    login.binding.id,
  );
  await assert.rejects(
    credentials.login(
      { ...value, operationId: "login-again" },
      identity,
      "synthetic-login",
    ),
    (e) => e.code === "UNAUTHORIZED",
  );
  assert.ok(credentials.passwordResetState(a.id));
  await credentials.changePassword(
    a.id,
    {
      oldPassword: reset.temporaryPassword,
      newPassword: "new-synthetic-password",
      operationId: "change-password",
      revokeAll: false,
    },
    login.binding.id,
    "synthetic-change",
  );
  assert.equal(credentials.passwordResetState(a.id), null);
  assert.deepEqual(ledger.wallet(a.id), wallet);
  registry.safety.assert();
});
test("daily/monthly budgets persist with immutable audit and carry unresolved risk across Beijing boundaries", () => {
  let now = Date.parse("2026-11-30T15:59:59Z");
  const ledger = new ReadingLedger(":memory:", { now: () => now });
  try {
    ledger.freezePrice(price);
    ledger.grantInitial("account");
    ledger.changeBudget(50000000, 100, "合成上限", "budget-change", "operator");
    const reserve = (id, amount) => {
      ledger.legacy.approve("account", id, 1);
      return ledger.reserve({
        callId: id,
        account: "account",
        task: id,
        block: "block",
        generation: 1,
        priceId: price.id,
        maxPromptTokens: amount,
        maxOutputTokens: 0,
      });
    };
    reserve("first", 80);
    ledger.sent("first");
    ledger.unknown("first");
    assert.throws(() => reserve("second", 21), /SITE_MONTH_BUDGET/);
    now += 2000;
    assert.equal(ledger.budget().monthSpentMicro, 0);
    assert.equal(ledger.budget().riskMicro, 80);
    assert.throws(() => reserve("third", 21), /SITE_MONTH_BUDGET/);
    assert.throws(
      () =>
        ledger.changeBudget(
          50000000,
          101,
          "合成上限",
          "budget-change",
          "operator",
        ),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.throws(
      () => ledger.db.exec("DELETE FROM reading_budget_changes"),
      /APPEND_ONLY/,
    );
  } finally {
    ledger.close();
  }
});
test("host task view excludes materials; pause fences a running generation and retry cannot bypass device and cost gates", async (t) => {
  const store = new SyncStore(":memory:"),
    ledger = new ReadingLedger(":memory:");
  createAttachmentStore(store);
  ledger.freezePrice(price);
  ledger.grantInitial("account");
  const device = store.createDevice("synthetic");
  let revoked = false;
  const routes = createReadingRoutes({
    ledger,
    priceId: price.id,
    modelVersion: price.model,
    reader() {},
    provider() {},
    authorize() {
      if (revoked) throw Error("REVOKED");
    },
  });
  t.after(async () => {
    await routes.close();
    store.close();
    ledger.close();
  });
  store.apply(
    device.deviceId,
    {
      opId: "put-packet",
      id: "packet",
      type: "put",
      baseVersion: 0,
      data: { text: "PRIVATE_SYNTHETIC_BODY", sources: [], attachments: [] },
    },
    store.epoch,
  );
  const seed = new ReadingTasks({
    store,
    account: "account",
    ledger,
    priceId: price.id,
    modelVersion: price.model,
    reader() {},
    provider() {},
    authorize() {},
  });
  seed.enqueue({ id: "task", packetId: "packet", deviceId: device.deviceId });
  seed.close();
  routes.attach("account", store);
  store.db
    .prepare(
      "UPDATE reading_tasks SET state='running',reason='' WHERE id='task'",
    )
    .run();
  // The host view binds the normal independent root metadata.
  const rows = routes.adminTasks();
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes("PRIVATE_SYNTHETIC_BODY"), false);
  const review = {
    operationId: "pause-task",
    expectedGeneration: rows[0].generation,
    expectedRevision: rows[0].revision,
    expectedMaintenanceOperation: rows[0].maintenanceOperation,
  };
  const paused = routes.adminTaskAction("account", "task", "pause", review);
  assert.equal(paused.state, "paused");
  assert.equal(paused.generation, rows[0].generation + 1);
  assert.throws(
    () =>
      routes.adminTaskAction("account", "task", "stop", {
        ...review,
        operationId: "stale-stop",
      }),
    (e) => e.code === "STALE_TASK",
  );
  revoked = true;
  assert.throws(
    () =>
      routes.adminTaskAction("account", "task", "retry", {
        ...review,
        operationId: "retry-task",
        expectedGeneration: paused.generation,
      }),
    /REVOKED/,
  );
});

test("real administration HTTP enforces session/CSRF for new quota, account, budget and operation routes, and exposes audit/storage metadata only", async (t) => {
  const {
    backend,
    ledger,
    users: [a, b],
  } = await fixture(t);
  const service = createAdminService({
      username: "synthetic-admin",
      passwordHash: await hashAdminPassword("synthetic-admin-password"),
      backend,
      audit() {},
    }),
    origin = await service.listen(0);
  t.after(() => service.close());
  const login = await fetch(origin + "/admin/v1/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "synthetic-admin",
      password: "synthetic-admin-password",
    }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0],
    session = await login.json();
  const request = (
    path,
    value,
    operation = "synthetic-operation",
    csrf = true,
  ) =>
    fetch(origin + "/admin/v1" + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-Operation-Id": operation,
        ...(csrf ? { "X-CSRF-Token": session.csrfToken } : {}),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  assert.equal(
    (
      await request(
        `/users/${a.id}/topup`,
        { amountMicro: 1000000, note: "合成" },
        "quota-http-1",
        false,
      )
    ).status,
    403,
  );
  assert.equal(ledger.wallet(a.id).granted, 20000000);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(
          `/users/${a.id}/topup`,
          { amountMicro: 1000000, note: "合成" },
          "quota-http-1",
        )
      ).status,
      200,
    );
  assert.equal(ledger.wallet(a.id).granted, 21000000);
  assert.equal(ledger.wallet(b.id).granted, 20000000);
  assert.equal(
    (
      await request(
        `/users/${a.id}/topup`,
        { amountMicro: 1000001, note: "合成" },
        "quota-http-1",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/users/${a.id}/enabled`,
        { enabled: false, reason: "合成停用" },
        "disable-http",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/users/${a.id}/enabled`,
        { enabled: true, reason: "合成恢复" },
        "enable-http",
      )
    ).status,
    200,
  );
  await request(
    `/users/${a.id}/enabled`,
    { enabled: false, reason: "合成停用" },
    "disable-http",
  );
  assert.equal(
    backend.user(a.id).status,
    "active",
    "old HTTP retry must not undo the newer enable",
  );
  assert.equal(
    (
      await request(
        "/budget",
        { dailyMicro: 40000000, monthlyMicro: 100000000, reason: "合成预算" },
        "budget-http",
      )
    ).status,
    200,
  );
  const report = await (await request("/storage")).json();
  assert.equal(report.users.length, 2);
  assert.equal(JSON.stringify(report).includes("public_key"), false);
  const audit = await (
    await request("/audit/search?keyword=quota-add&page=1")
  ).json();
  assert.equal(audit.total, 1);
  assert.equal((await request(`/users/${a.id}/originals`)).status, 404);
  const op = await request(
    "/operations",
    { kind: "backup", args: { reason: "合成备份" } },
    "backup-http",
  );
  assert.equal(op.status, 202);
  assert.equal((await op.json()).state, "queued");
  assert.equal(
    (await (await request("/operations")).json()).maintenance.paused,
    true,
  );
  assert.throws(() => backend.assertDispatch(a.id), /MAINTENANCE/);
});
