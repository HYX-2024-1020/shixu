import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { AccountRegistry } from "./sync-accounts.mjs";
import { AccountsV4 } from "./accounts-v4.mjs";
import { AccountSafety } from "./account-safety.mjs";
import { SyncStore } from "./sync-store.mjs";
import { createAttachmentStore } from "./sync-files.mjs";
import { OriginalStore } from "./originals.mjs";
import { ReadingTasks } from "./reading/tasks.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { CloudOperations } from "./cloud-operations.mjs";
import {
  takeCloudSnapshot,
  restoreCloudSnapshot,
  listCloudSnapshots,
  verifyCloudSnapshot,
  rotateCloudSnapshots,
  cleanCloudStorage,
  recoverCloudMaintenance,
} from "./cloud-backup.mjs";
import {
  acquireDataLease,
  resolveDataVersion,
  readingAuthorityFloor,
} from "./data-versions.mjs";
import { spawnSync } from "node:child_process";
const secret = "synthetic-backup-secret-".repeat(3);
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
  const root = mkdtempSync(join(tmpdir(), "shixu-cloud-backup-")),
    directory = join(root, "data"),
    ledgerPath = join(root, "authority.sqlite"),
    operationsPath = join(root, "ops.sqlite");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new AccountRegistry(directory, secret),
    credentials = new AccountsV4(registry),
    ledger = new ReadingLedger(ledgerPath);
  new AccountSafety(registry, ledger);
  const invite = registry.generate(1)[0];
  const user = await credentials.register(
    {
      username: "synthetic",
      password: "synthetic-password",
      invite: invite.invite,
      operationId: "register-user",
    },
    {
      kind: "windows",
      identity: "a".repeat(64),
      publicKey: "synthetic-only",
      name: "合成设备",
    },
    "synthetic",
  );
  ledger.grantInitial(invite.userId);
  ledger.freezePrice(price);
  const store = new SyncStore(
    join(directory, "users", invite.userId, "workspace.sqlite"),
  );
  createAttachmentStore(store);
  new OriginalStore(store, { safety: { ledger, account: invite.userId } });
  const tasks = new ReadingTasks({
    store,
    account: invite.userId,
    ledger,
    priceId: price.id,
    modelVersion: price.model,
    reader() {},
    provider() {},
    authorize() {},
  });
  const device = store.createDevice("synthetic");
  store.apply(
    device.deviceId,
    {
      opId: "put-data",
      type: "put",
      id: "packet",
      baseVersion: 0,
      data: { text: "合成资料，仅供恢复演练", attachments: [], sources: [] },
    },
    store.epoch,
  );
  const epoch = store.epoch;
  tasks.close();
  store.originals.close();
  store.close();
  credentials.close();
  registry.close();
  ledger.close();
  const ops = new CloudOperations(operationsPath);
  ops.close();
  return {
    root,
    account: invite.userId,
    user,
    epoch,
    config: {
      directory,
      ledgerPath,
      operationsPath,
      backupRoot: join(root, "backups"),
      secret,
    },
  };
}
test("real cross-database snapshots restore old tenant data using the live trusted registry and authority, preserving deletion, password revocation and costs", async (t) => {
  const f = await fixture(t),
    snapshot = await takeCloudSnapshot(f.config);
  const registry = new AccountRegistry(f.config.directory, secret),
    credentials = new AccountsV4(registry),
    ledger = new ReadingLedger(f.config.ledgerPath);
  new AccountSafety(registry, ledger);
  await credentials.changePassword(
    f.account,
    {
      oldPassword: "synthetic-password",
      newPassword: "synthetic-new-password",
      operationId: "change-password",
      revokeAll: true,
    },
    f.user.binding.id,
    "synthetic",
  );
  const store = new SyncStore(
    join(f.config.directory, "users", f.account, "workspace.sqlite"),
  );
  createAttachmentStore(store);
  new OriginalStore(store, { safety: { ledger, account: f.account } });
  const device = store.createDevice("synthetic");
  store.apply(
    device.deviceId,
    {
      opId: "delete-data",
      type: "delete",
      id: "packet",
      baseVersion: store.record("packet").version,
    },
    store.epoch,
  );
  ledger.legacy.approve(f.account, "synthetic-call", 1);
  ledger.reserve({
    callId: "call",
    account: f.account,
    task: "synthetic-call",
    block: "b",
    generation: 1,
    priceId: price.id,
    maxPromptTokens: 10,
    maxOutputTokens: 5,
  });
  ledger.sent("call");
  ledger.settle("call", { prompt_tokens: 10, completion_tokens: 5 });
  const wallet = ledger.wallet(f.account),
    floor = readingAuthorityFloor(f.config.ledgerPath);
  store.originals.close();
  store.close();
  credentials.close();
  registry.close();
  ledger.close();
  const result = restoreCloudSnapshot(
    { ...f.config, authorityFloor: floor },
    snapshot.id,
  );
  assert.equal(result.tenants, 1);
  const lease = acquireDataLease(f.config.directory, "maintenance"),
    selected = resolveDataVersion(lease, { ledgerPath: f.config.ledgerPath });
  const db = new DatabaseSync(
    join(selected.directory, "users", f.account, "workspace.sqlite"),
    { readOnly: true },
  );
  try {
    assert.ok(
      db.prepare("SELECT deleted_at FROM sync_records WHERE id='packet'").get()
        .deleted_at,
    );
    assert.notEqual(
      db.prepare("SELECT value FROM sync_meta WHERE key='epoch'").get().value,
      f.epoch,
    );
  } finally {
    db.close();
    lease.release();
  }
  const live = new ReadingLedger(f.config.ledgerPath);
  try {
    assert.deepEqual(live.wallet(f.account), wallet);
    assert.equal(live.call("call").state, "settled");
    live.audit();
  } finally {
    live.close();
  }
  const current = new AccountRegistry(selected.directory, secret);
  try {
    assert.throws(() => current.authenticate(f.user.binding.token));
    assert.equal(
      current.db
        .prepare("SELECT version FROM account_credentials WHERE user_id=?")
        .get(f.account).version,
      2,
    );
  } finally {
    current.close();
  }
});
test("snapshot hashes and seven-day expiry fail closed, rotation retains only two verified successes and never changes authority", async (t) => {
  const f = await fixture(t),
    now = Date.now();
  for (let i = 0; i < 3; i++)
    await takeCloudSnapshot(f.config, { now: now + i });
  const rows = listCloudSnapshots(f.config.backupRoot, { now: now + 3 });
  assert.equal(rows.length, 2);
  const a = rows[0];
  verifyCloudSnapshot(f.config.backupRoot, a.id, { now: now + 3 });
  assert.throws(
    () =>
      verifyCloudSnapshot(f.config.backupRoot, a.id, {
        now: now + 8 * 86400000,
      }),
    /BACKUP_MANIFEST_REJECTED/,
  );
  const authority = readFileSync(f.config.ledgerPath);
  appendFileSync(join(f.config.backupRoot, a.id, "accounts.sqlite"), "tamper");
  assert.throws(
    () => verifyCloudSnapshot(f.config.backupRoot, a.id),
    /BACKUP_HASH_MISMATCH/,
  );
  assert.throws(
    () => restoreCloudSnapshot(f.config, "../outside"),
    /INVALID_SNAPSHOT/,
  );
  rotateCloudSnapshots(f.config.backupRoot, { now: now + 8 * 86400000 });
  assert.deepEqual(readFileSync(f.config.ledgerPath), authority);
  assert.equal(listCloudSnapshots(f.config.backupRoot).length, 0);
});
test("durable operation requests serialize, deduplicate and leave maintenance gates across worker failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "shixu-cloud-jobs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let ops = new CloudOperations(join(root, "ops.sqlite"));
  ops.request("backup", { reason: "合成备份" }, "backup-request", "operator");
  ops.request("backup", { reason: "合成备份" }, "backup-request", "operator");
  assert.throws(
    () =>
      ops.request(
        "restart",
        { reason: "合成重启" },
        "restart-request",
        "operator",
      ),
    (e) => e.code === "OPERATION_BUSY",
  );
  ops.event("backup-request", "running");
  ops.close();
  ops = new CloudOperations(join(root, "ops.sqlite"));
  try {
    assert.equal(ops.maintenance().paused, true);
    assert.equal(ops.jobs()[0].state, "running");
    ops.event("backup-request", "failed", "BACKUP_SPACE_REQUIRED");
    assert.equal(ops.maintenance().paused, true);
    assert.throws(
      () => ops.db.exec("DELETE FROM cloud_job_events"),
      /APPEND_ONLY/,
    );
  } finally {
    ops.close();
  }
});
test("offline maintenance refuses a live writer; page reclamation preserves current data and does not execute a provider", async (t) => {
  const f = await fixture(t),
    lease = acquireDataLease(f.config.directory, "runtime");
  try {
    await assert.rejects(takeCloudSnapshot(f.config));
  } finally {
    lease.release();
  }
  const result = cleanCloudStorage(f.config);
  assert.equal(result.tenants, 1);
  const db = new DatabaseSync(
    join(f.config.directory, "users", f.account, "workspace.sqlite"),
    { readOnly: true },
  );
  try {
    assert.equal(db.prepare("PRAGMA auto_vacuum").get().auto_vacuum, 2);
    assert.ok(
      db
        .prepare("SELECT data FROM sync_records WHERE id='packet'")
        .get()
        .data.includes("合成资料"),
    );
  } finally {
    db.close();
  }
});

test("host maintenance recovery proves child death and cannot clear a live writer or change billing", async (t) => {
  const f = await fixture(t),
    floor = readingAuthorityFloor(f.config.ledgerPath),
    config = { ...f.config, authorityFloor: floor };
  const alive = acquireDataLease(f.config.directory, "runtime");
  try {
    assert.throws(
      () => recoverCloudMaintenance(config, "recover-alive"),
      /DATA_WRITERS_ACTIVE/,
    );
  } finally {
    alive.release();
  }
  const module = new URL("./data-versions.mjs", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {acquireDataLease} from ${JSON.stringify(module)};acquireDataLease(${JSON.stringify(f.config.directory)},'maintenance');`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  const result = recoverCloudMaintenance(config, "recover-dead-maintenance");
  assert.equal(result.registrationsRecovered, 1);
  assert.deepEqual(readingAuthorityFloor(f.config.ledgerPath), floor);
  const lease = acquireDataLease(f.config.directory, "runtime");
  lease.release();
});
