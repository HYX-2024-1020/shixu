import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountRegistry } from "./sync-accounts.mjs";
import { AccountsV4 } from "./accounts-v4.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { AdminBackend } from "./admin-backend.mjs";

test("a sustained service alert survives restart and recovers only when live failures subside", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-admin-risk-restart-"));
  const registry = new AccountRegistry(
    directory,
    "synthetic-secret-".repeat(4),
  );
  const credentials = new AccountsV4(registry);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  let at = Date.now();
  let failures = [
    { account: "synthetic-a", reason: "READING_TIMEOUT", count: 2 },
    { account: "synthetic-b", reason: "READING_TIMEOUT", count: 2 },
    { account: "synthetic-c", reason: "READING_TIMEOUT", count: 1 },
  ];
  const options = {
    path: join(directory, "ops.sqlite"),
    registry,
    ledger,
    directory,
    now: () => at,
    routes: { snapshot: () => ({ running: 0, waiting: 0, failures }) },
  };
  let backend = new AdminBackend(options);
  t.after(() => {
    backend.close();
    credentials.close();
    registry.close();
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const alerts = () =>
    backend.alerts().filter((a) => a.kind === "task-READING_TIMEOUT");
  assert.equal(alerts().length, 0);
  at += 120001;
  backend.sample();
  const original = alerts()[0];
  assert.ok(original);
  assert.equal(original.recoveredAt, null);
  backend.close();
  at += 1000;
  backend = new AdminBackend(options);
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].id, original.id);
  assert.equal(alerts()[0].recoveredAt, null);
  failures = failures.slice(0, 2);
  backend.sample();
  assert.ok(alerts()[0].recoveredAt);
  backend.close();
  backend = new AdminBackend(options);
  assert.equal(alerts().length, 1);
  assert.ok(alerts()[0].recoveredAt);
});

test("durable independent controls compose, deduplicate, preserve billing and append-only audit", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-admin-backend-"));
  const registry = new AccountRegistry(
    directory,
    "synthetic-secret-".repeat(4),
  );
  const credentials = new AccountsV4(registry),
    ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  const invitations = registry.generate(2),
    [a, b] = invitations.map((r) => r.userId);
  for (const [index, invitation] of invitations.entries())
    await credentials.register(
      {
        username: `synthetic-${index}`,
        password: "synthetic-password",
        invite: invitation.invite,
        operationId: `register-${index}`,
      },
      {
        kind: "windows",
        identity: String(index).repeat(64),
        publicKey: "synthetic-only",
        name: "合成设备",
      },
      "synthetic",
    );
  registry.generate(1); // Unused invitations must not appear as registered users.
  ledger.grantInitial(a);
  ledger.grantInitial(b);
  let backend = new AdminBackend({
    path: join(directory, "ops.sqlite"),
    registry,
    ledger,
    directory,
    routes: { snapshot: () => ({ running: 0, waiting: 0 }) },
  });
  t.after(() => {
    backend.close();
    credentials.close();
    registry.close();
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const wallet = ledger.wallet(a);
  backend.control(a, true, "pause-user-1", "operator");
  assert.throws(() => backend.assertDispatch(a), /ADMIN_PAUSED/);
  assert.doesNotThrow(() => backend.assertDispatch(b));
  backend.control("site", true, "pause-site-1", "operator");
  backend.control(a, false, "resume-user-1", "operator");
  assert.throws(() => backend.assertDispatch(a), /ADMIN_PAUSED/);
  backend.control("site", false, "resume-site-1", "operator");
  backend.control("site", false, "resume-site-1", "operator");
  assert.equal(backend.audits().length, 4);
  assert.throws(
    () => backend.control("site", true, "resume-site-1", "operator"),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.deepEqual(ledger.wallet(a), wallet);
  assert.throws(() => backend.db.exec("DELETE FROM audit"), /APPEND_ONLY/);
  backend.control(a, true, "pause-user-2", "operator");
  backend.close();
  backend = new AdminBackend({
    path: join(directory, "ops.sqlite"),
    registry,
    ledger,
    directory,
    routes: { snapshot: () => ({ running: 0, waiting: 0 }) },
  });
  assert.throws(() => backend.assertDispatch(a), /ADMIN_PAUSED/);
  const users = backend.users(new URLSearchParams());
  assert.equal(users.total, 2);
  assert.deepEqual(
    backend.users(new URLSearchParams({ keyword: a })).items.map((u) => u.id),
    [a],
  );
  assert.equal(JSON.stringify(users).includes("invite_hash"), false);
  registry.pauseAI(true);
  backend.sample();
  backend.sample();
  const safetyAlerts = () =>
    backend.alerts().filter((a) => a.message.includes("服务安全开关"));
  assert.equal(safetyAlerts().filter((a) => !a.recoveredAt).length, 1);
  const alert = safetyAlerts().find((a) => !a.recoveredAt);
  backend.markRead(alert.id, "read-alert-1", "operator");
  backend.markRead(alert.id, "read-alert-1", "operator");
  assert.ok(backend.alerts().find((a) => a.id === alert.id).readAt);
  assert.equal(safetyAlerts().filter((a) => !a.recoveredAt).length, 1);
  assert.equal(
    backend.audits().filter((a) => a.action === "alert-read").length,
    1,
  );
  assert.throws(
    () =>
      backend.followAlert(
        alert.id,
        "reviewed",
        "尚未恢复",
        "follow-review-1",
        "operator",
      ),
    (e) => e.code === "ALERT_NOT_RECOVERED",
  );
  await backend.followAlert(
    alert.id,
    "developer",
    "已定位安全配置，等待维护修复",
    "follow-developer-1",
    "operator",
  );
  await backend.followAlert(
    alert.id,
    "developer",
    "已定位安全配置，等待维护修复",
    "follow-developer-1",
    "operator",
  );
  assert.equal(
    backend.alerts().find((a) => a.id === alert.id).followup.state,
    "developer",
  );
  assert.equal(
    backend.audits().filter((a) => a.action === "alert-followup-developer")
      .length,
    1,
  );
  assert.equal(
    backend.alerts().find((a) => a.id === alert.id).recoveredAt,
    null,
  );
  assert.deepEqual(ledger.wallet(a), wallet);
  registry.pauseAI(false);
  backend.sample();
  assert.ok(backend.alerts().find((a) => a.id === alert.id).recoveredAt);
  await backend.followAlert(
    alert.id,
    "reviewed",
    "实际恢复已核对",
    "follow-reviewed-1",
    "operator",
  );
  assert.equal(
    backend.alerts().find((a) => a.id === alert.id).followup.state,
    "reviewed",
  );
  assert.ok(backend.overview().resources.source);
});

test("safe storage release requires a fresh matching preview and replays the same maintenance request", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-cleanup-preview-"));
  const registry = new AccountRegistry(
    directory,
    "synthetic-preview-secret-".repeat(3),
  );
  const credentials = new AccountsV4(registry);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  let now = Date.now();
  const backend = new AdminBackend({
    path: join(directory, "ops.sqlite"),
    registry,
    ledger,
    directory,
    now: () => now,
    routes: { snapshot: () => ({ running: 0, waiting: 0 }) },
  });
  t.after(() => {
    backend.close();
    credentials.close();
    registry.close();
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await assert.rejects(
    backend.requestOperation(
      { kind: "cleanup", args: { reason: "合成释放" } },
      "missing-preview",
      "operator",
    ),
    (e) => e.code === "CLEANUP_PREVIEW_CHANGED",
  );
  const preview = backend.operationsStatus().cleanupPreview;
  assert.equal(preview.originals, 0);
  assert.match(preview.protected, /最后一份/);
  now += 120001;
  await assert.rejects(
    backend.requestOperation(
      {
        kind: "cleanup",
        args: {
          reason: "合成释放",
          cleanupBefore: preview.at,
          cleanupFingerprint: preview.fingerprint,
        },
      },
      "expired-preview",
      "operator",
    ),
    (e) => e.code === "CLEANUP_PREVIEW_CHANGED",
  );
  const fresh = backend.operationsStatus().cleanupPreview;
  const request = {
    kind: "cleanup",
    args: {
      reason: "合成释放",
      cleanupBefore: fresh.at,
      cleanupFingerprint: fresh.fingerprint,
    },
  };
  const job = await backend.requestOperation(
    request,
    "confirmed-preview",
    "operator",
  );
  assert.equal(job.kind, "cleanup");
  assert.equal(job.state, "queued");
  now += 180000;
  assert.equal(
    (await backend.requestOperation(request, "confirmed-preview", "operator"))
      .id,
    job.id,
  );
  assert.equal(backend.cloudOperations.jobs().length, 1);
});
