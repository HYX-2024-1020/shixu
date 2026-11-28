import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AccountRegistry } from "../sync-accounts.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { createJobQueue } from "../sync-jobs.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingRootSafety } from "./root-safety.mjs";
import { createRuntimeMigrator } from "../data-migration.mjs";
import {
  acquireDataLease,
  prepareShadowVersion,
  activateDataVersion,
  resolveDataVersion,
  purgeRetiredData,
  purgeAbandonedShadows,
} from "../data-versions.mjs";
import { withDataControl } from "../data-control.mjs";
const secret = "fixture-fixture-fixture-fixture-fixture",
  day = 86400000,
  authorize = ({ actor }) => actor === "synthetic-host";
const purgeShadows = (f, now, extra = {}) =>
  purgeAbandonedShadows(
    f.lease,
    { operationId: "orphan-purge", actor: "synthetic-host", now, ...extra },
    authorize,
  );
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-data-retirement-")),
    root = join(directory, "accounts"),
    ledgerPath = join(directory, "ledger.sqlite");
  const registry = new AccountRegistry(root, secret),
    account = registry.generate(1)[0].userId;
  registry.close();
  const tenant = join(root, "users", account, "workspace.sqlite"),
    store = new SyncStore(tenant);
  createAttachmentStore(store);
  createJobQueue(store, null).stop();
  const device = store.createDevice("synthetic").deviceId;
  store.apply(
    device,
    {
      id: "packet",
      opId: "seed",
      type: "put",
      baseVersion: 0,
      data: {
        text: "canonical input",
        sources: [{ id: "input", text: "canonical input" }],
        attachments: [],
        itemIds: ["paid"],
        result: { items: [{ title: "paid result preserved" }] },
      },
    },
    store.epoch,
  );
  store.close();
  const ledger = new ReadingLedger(ledgerPath);
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1000000,
  });
  ledger.grantInitial(account);
  new ReadingRootSafety(ledger, account);
  ledger.reserve({
    callId: "unknown",
    account,
    task: "task",
    block: "block",
    generation: 1,
    priceId: "synthetic",
    maxPromptTokens: 1000,
    maxOutputTokens: 0,
  });
  ledger.sent("unknown");
  ledger.unknown("unknown");
  const lease = acquireDataLease(root, "maintenance"),
    migrate = createRuntimeMigrator({
      secret,
      ledger,
      priceId: "synthetic",
      modelVersion: "synthetic",
      credentials: false,
    });
  const prepare = (id, extra = {}) =>
    prepareShadowVersion(lease, { id, ledgerPath, migrate, ...extra });
  t.after(() => {
    lease.release();
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const purge = (now, extra = {}) =>
    purgeRetiredData(
      lease,
      { operationId: "purge", actor: "synthetic-host", now, ...extra },
      authorize,
    );
  return { root, account, tenant, ledger, lease, prepare, purge };
}
test("seven-day retirement clears old root and old version contents, preserves empty writer fencing and never changes current data or unknown fees", (t) => {
  const f = fixture(t),
    wallet = f.ledger.wallet(f.account),
    sequence = f.ledger.sequence(f.account);
  activateDataVersion(f.lease, f.prepare("v1"), { now: 1000 });
  activateDataVersion(f.lease, f.prepare("v2"), {
    expectedVersion: "v1",
    now: 2000,
  });
  assert.deepEqual(f.purge(1000 + 7 * day - 1), { completed: [] });
  assert.equal(existsSync(f.tenant), true);
  assert.deepEqual(f.purge(1000 + 7 * day), { completed: ["v1"] });
  assert.equal(existsSync(f.tenant), false);
  const tombstone = new DatabaseSync(join(f.root, "accounts.sqlite"), { readOnly: true });
  try { assert.equal(tombstone.prepare("SELECT COUNT(*) n FROM account_safety_checkpoint").get().n, 0); }
  finally { tombstone.close(); }
  assert.equal(
    existsSync(join(f.root, "data-versions", "v1", "accounts.sqlite")),
    true,
  );
  assert.throws(
    () => new AccountRegistry(f.root, secret),
    /DATA_VERSION_ROOT_FENCED/,
  );
  withDataControl(f.root, (db) =>
    assert.throws(() => db.exec("DELETE FROM data_retirements"), /APPEND_ONLY/),
  );
  assert.deepEqual(f.purge(2000 + 7 * day), { completed: ["v1", "v2"] });
  assert.equal(
    existsSync(join(f.root, "data-versions", "v1", "accounts.sqlite")),
    false,
  );
  const selected = resolveDataVersion(f.lease),
    store = new SyncStore(
      join(selected.directory, "users", f.account, "workspace.sqlite"),
    );
  try {
    assert.equal(store.record("packet").data.text, "canonical input");
    assert.equal(
      store.record("packet").data.result.items[0].title,
      "paid result preserved",
    );
  } finally {
    store.close();
  }
  assert.deepEqual(f.ledger.wallet(f.account), wallet);
  assert.equal(f.ledger.sequence(f.account), sequence);
  assert.deepEqual(f.purge(2000 + 8 * day), { completed: ["v1", "v2"] });
});
test("partial retirement resumes from immutable intent after tombstone rename and cannot accept a different operation", (t) => {
  const f = fixture(t);
  activateDataVersion(f.lease, f.prepare("v1"), { now: 1000 });
  assert.throws(
    () =>
      f.purge(1000 + 7 * day, {
        afterFile: () => {
          throw Error("INJECTED_RETIREMENT_CRASH");
        },
      }),
    /INJECTED_RETIREMENT_CRASH/,
  );
  assert.equal(resolveDataVersion(f.lease).version, "v1");
  assert.throws(
    () => f.purge(1000 + 7 * day, { operationId: "changed" }),
    /DATA_RETIREMENT_CONFLICT/,
  );
  assert.deepEqual(f.purge(1000 + 7 * day), { completed: ["v1"] });
  assert.equal(existsSync(f.tenant), false);
});
test("unactivated versions cannot authorize deletion of their still-active source and a changed retired file is preserved for host review", (t) => {
  const f = fixture(t);
  activateDataVersion(f.lease, f.prepare("v1"), { now: 1000 });
  const pending = f.prepare("pending");
  assert.throws(
    () =>
      activateDataVersion(f.lease, pending, {
        expectedVersion: "v1",
        now: 2000,
        beforeRename: () => {
          throw Error("INJECTED_NO_COMMIT");
        },
      }),
    /INJECTED_NO_COMMIT/,
  );
  assert.deepEqual(f.purge(2000 + 7 * day), { completed: ["v1"] });
  assert.equal(
    existsSync(join(f.root, "data-versions", "v1", "accounts.sqlite")),
    true,
  );
  assert.equal(resolveDataVersion(f.lease).version, "v1");
});
test("host authorization is required and a changed obsolete tenant blocks cleanup before any source is removed", (t) => {
  const f = fixture(t);
  activateDataVersion(f.lease, f.prepare("v1"), { now: 1000 });
  assert.throws(
    () =>
      purgeRetiredData(
        f.lease,
        { operationId: "wrong", actor: "user", now: 1000 + 7 * day },
        authorize,
      ),
    /DATA_MAINTENANCE_FORBIDDEN/,
  );
  const old = new SyncStore(f.tenant);
  old.db.prepare("UPDATE sync_records SET version=99").run();
  old.close();
  assert.throws(() => f.purge(1000 + 7 * day), /DATA_RETIREMENT_CHANGED/);
  assert.equal(existsSync(f.tenant), true);
  const row = withDataControl(f.root, (db) =>
    db.prepare("SELECT 1 FROM data_retirement_disposals").get(),
  );
  assert.equal(row, undefined);
});

test("failed shadows and their sidecars expire after seven days and cleanup interruption cannot touch the primary source", (t) => {
  const f = fixture(t),
    wallet = f.ledger.wallet(f.account);
  assert.throws(
    () =>
      f.prepare("failed", {
        now: 1000,
        afterStep: (member) => {
          if (member.startsWith("users/")) throw Error("INJECTED_SHADOW");
        },
      }),
    /INJECTED_SHADOW/,
  );
  const abandoned = join(
    f.root,
    "data-versions",
    "failed",
    "users",
    f.account,
    "workspace.sqlite",
  );
  writeFileSync(abandoned + "-wal", "synthetic abandoned sidecar bytes");
  assert.deepEqual(purgeShadows(f, 1000 + 7 * day - 1), { completed: [] });
  assert.throws(
    () =>
      purgeShadows(f, 1000 + 7 * day, {
        afterFile: () => {
          throw Error("INJECTED_PURGE");
        },
      }),
    /INJECTED_PURGE/,
  );
  assert.throws(
    () => purgeShadows(f, 1000 + 7 * day, { operationId: "changed" }),
    /DATA_RETIREMENT_CONFLICT/,
  );
  assert.deepEqual(purgeShadows(f, 1000 + 7 * day), { completed: ["failed"] });
  assert.equal(existsSync(abandoned), false);
  assert.equal(existsSync(f.tenant), true);
  assert.deepEqual(f.ledger.wallet(f.account), wallet);
});
test("an expired prepared shadow cannot activate, and a committed selected version is never abandoned cleanup input", (t) => {
  const f = fixture(t),
    prepared = f.prepare("expired", { now: 1000 });
  assert.throws(
    () => activateDataVersion(f.lease, prepared, { now: 1000 + 7 * day }),
    /DATA_SHADOW_EXPIRED/,
  );
  assert.deepEqual(purgeShadows(f, 1000 + 7 * day), { completed: ["expired"] });
  const fresh = f.prepare("current", { now: 1000 + 7 * day });
  activateDataVersion(f.lease, fresh, { now: 1000 + 7 * day });
  assert.deepEqual(purgeShadows(f, 1000 + 15 * day), {
    completed: ["expired"],
  });
  assert.equal(resolveDataVersion(f.lease).version, "current");
});
test("a failed initial activation can expire its shadow and rebuild from the preserved fenced source without reverting authority", (t) => {
  const f = fixture(t),
    wallet = f.ledger.wallet(f.account),
    prepared = f.prepare("initial", { now: 1000 });
  assert.throws(
    () =>
      activateDataVersion(f.lease, prepared, {
        now: 1000,
        beforeRename: () => {
          throw Error("INJECTED_FIRST_ACTIVATION");
        },
      }),
    /INJECTED_FIRST_ACTIVATION/,
  );
  assert.deepEqual(purgeShadows(f, 1000 + 7 * day), { completed: ["initial"] });
  const recovered = f.prepare("recovered", {
    now: 1000 + 7 * day,
    recoverInitial: true,
  });
  activateDataVersion(f.lease, recovered, { now: 1000 + 7 * day });
  assert.equal(resolveDataVersion(f.lease).version, "recovered");
  assert.deepEqual(f.ledger.wallet(f.account), wallet);
  assert.throws(
    () => f.prepare("forbidden", { recoverInitial: true }),
    /INITIAL_DATA_RECOVERY_FORBIDDEN/,
  );
});
test("unknown shadow files fail cleanup before any declared member is removed", (t) => {
  const f = fixture(t);
  f.prepare("unexpected", { now: 1000 });
  const directory = join(f.root, "data-versions", "unexpected");
  writeFileSync(join(directory, "unplanned.bin"), "synthetic unknown output");
  assert.throws(
    () => purgeShadows(f, 1000 + 7 * day),
    /DATA_SHADOW_UNEXPECTED_CONTENT/,
  );
  assert.equal(existsSync(join(directory, "accounts.sqlite")), true);
});
