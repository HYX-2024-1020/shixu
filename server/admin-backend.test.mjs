import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountRegistry } from "./sync-accounts.mjs";
import { AccountsV4 } from "./accounts-v4.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { AdminBackend } from "./admin-backend.mjs";

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
  registry.pauseAI(false);
  backend.sample();
  assert.ok(backend.alerts().find((a) => a.id === alert.id).recoveredAt);
  assert.ok(backend.overview().resources.source);
});
