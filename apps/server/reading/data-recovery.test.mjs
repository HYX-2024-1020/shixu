import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  acquireDataLease,
  reviewDataWriters,
  recoverDataWriters,
} from "../data-versions.mjs";
import { withDataControl } from "../data-control.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { DatabaseSync } from "node:sqlite";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import { ACCOUNTS_CORE_SCHEMA } from "../database-schemas.mjs";
const authorize = ({ actor }) => actor === "synthetic-host";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "shixu-data-recovery-")),
    leases = [];
  t.after(() => {
    for (const lease of leases) lease.release();
    rmSync(root, { recursive: true, force: true });
  });
  const acquire = (mode = "runtime") => {
    const lease = acquireDataLease(root, mode);
    leases.push(lease);
    return lease;
  };
  return { root, acquire };
}
async function leaveDeadRegistration(root, mode = "runtime") {
  const url = new URL("../data-versions.mjs", import.meta.url).href;
  const code = `import {acquireDataLease} from ${JSON.stringify(url)};acquireDataLease(process.argv[1],process.argv[2]);process.send('registered');process.on('message',()=>process.exit(0));`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, root, mode],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  const exited = new Promise((done) => child.once("close", done));
  await new Promise((done, reject) => {
    child.once("message", done);
    child.once("error", reject);
    child.once("exit", () => reject(Error("CHILD_REGISTRATION_FAILED")));
  });
  child.send("exit-without-release");
  assert.equal(await exited, 0);
}
const request = (review, extra = {}) => ({
  operationId: "recovery",
  actor: "synthetic-host",
  expectedSnapshotHash: review.snapshotHash,
  ...extra,
});
test("host authorization and current kernel liveness cannot be replaced by request flags or an expired timestamp", (t) => {
  const f = fixture(t);
  f.acquire();
  assert.throws(
    () => reviewDataWriters(f.root, "user", authorize),
    /DATA_MAINTENANCE_FORBIDDEN/,
  );
  const review = reviewDataWriters(f.root, "synthetic-host", authorize);
  assert.equal(review.allTerminated, false);
  assert.throws(
    () =>
      recoverDataWriters(
        f.root,
        request(review, { terminated: true, final: true }),
        authorize,
      ),
    /DATA_WRITERS_ACTIVE/,
  );
  assert.equal(
    withDataControl(
      f.root,
      (db) =>
        db.prepare("SELECT COUNT(*) n FROM data_recovery_intents").get().n,
    ),
    0,
  );
});
test("actual child process death permits idempotent host recovery without touching unknown cost or granting credit", async (t) => {
  const f = fixture(t),
    ledger = new ReadingLedger(join(f.root, "ledger.sqlite"));
  try {
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
    ledger.grantInitial("synthetic");
    ledger.reserve({
      callId: "unknown",
      account: "synthetic",
      task: "task",
      block: "block",
      generation: 1,
      priceId: "synthetic",
      maxPromptTokens: 1000,
      maxOutputTokens: 0,
    });
    ledger.sent("unknown");
    ledger.unknown("unknown");
    const before = ledger.wallet("synthetic"),
      sequence = ledger.sequence("synthetic");
    await leaveDeadRegistration(f.root);
    assert.throws(() => f.acquire(), /DATA_WRITERS_ACTIVE/);
    const review = reviewDataWriters(f.root, "synthetic-host", authorize);
    assert.equal(review.allTerminated, true);
    assert.throws(
      () =>
        recoverDataWriters(
          f.root,
          request(review, { expectedSnapshotHash: "a".repeat(64) }),
          authorize,
        ),
      /STALE_DATA_RECOVERY/,
    );
    const result = recoverDataWriters(f.root, request(review), authorize);
    assert.equal(result.repeated, false);
    f.acquire();
    assert.equal(
      recoverDataWriters(f.root, request(review), authorize).repeated,
      true,
    );
    assert.equal(readdirSync(join(f.root, ".data-writers")).length, 1);
    assert.deepEqual(ledger.wallet("synthetic"), before);
    assert.equal(ledger.sequence("synthetic"), sequence);
    withDataControl(f.root, (db) =>
      assert.throws(
        () => db.exec("DELETE FROM data_recovery_intents"),
        /APPEND_ONLY/,
      ),
    );
  } finally {
    ledger.close();
  }
});
for (const hook of ["afterIntent", "afterUnlink"])
  test(
    "a recovery crash " +
      hook +
      " keeps the startup gate closed until the same audited operation completes",
    async (t) => {
      const f = fixture(t);
      await leaveDeadRegistration(f.root);
      const review = reviewDataWriters(f.root, "synthetic-host", authorize);
      assert.throws(
        () =>
          recoverDataWriters(
            f.root,
            request(review, {
              [hook]: () => {
                throw Error("INJECTED_RECOVERY_CRASH");
              },
            }),
            authorize,
          ),
        /INJECTED_RECOVERY_CRASH/,
      );
      assert.throws(() => f.acquire(), /DATA_MAINTENANCE/);
      assert.throws(() => f.acquire("maintenance"), /DATA_MAINTENANCE/);
      assert.equal(
        reviewDataWriters(f.root, "synthetic-host", authorize)
          .pendingRecoveries[0].snapshot_hash,
        review.snapshotHash,
      );
      assert.throws(
        () =>
          recoverDataWriters(
            f.root,
            request(review, { operationId: "other-operation" }),
            authorize,
          ),
        /DATA_RECOVERY_IN_PROGRESS/,
      );
      assert.throws(
        () =>
          recoverDataWriters(
            f.root,
            request(review, { expectedSnapshotHash: "b".repeat(64) }),
            authorize,
          ),
        /DATA_RECOVERY_CONFLICT/,
      );
      recoverDataWriters(f.root, request(review), authorize);
      f.acquire();
    },
  );
test("a dead maintenance registration is recovered using kernel evidence and a changed registration cannot be removed using an old review", async (t) => {
  const f = fixture(t);
  await leaveDeadRegistration(f.root, "maintenance");
  const path = join(f.root, ".data-maintenance"),
    original = readFileSync(path);
  const review = reviewDataWriters(f.root, "synthetic-host", authorize);
  const changed = JSON.parse(original);
  changed.token = "changed";
  writeFileSync(path, JSON.stringify(changed));
  assert.throws(
    () => recoverDataWriters(f.root, request(review), authorize),
    /STALE_DATA_RECOVERY/,
  );
  writeFileSync(path, original);
  recoverDataWriters(f.root, request(review), authorize);
  f.acquire();
});
test("a lost independent control guard is refused without being silently recreated", (t) => {
  const f = fixture(t);
  withDataControl(f.root, (db) =>
    db.exec("DROP TRIGGER data_recovery_intents_no_delete"),
  );
  assert.throws(() => f.acquire(), /DATABASE_SCHEMA_MISMATCH/);
  const check = new DatabaseSync(join(f.root, ".data-control.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      check
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='data_recovery_intents_no_delete'",
        )
        .get(),
      undefined,
    );
  } finally {
    check.close();
  }
});
test("kernel recovery raises the registry writer floor so a connected previous writer cannot bypass an incomplete recovery", async (t) => {
  const f = fixture(t),
    previous = new DatabaseSync(join(f.root, "accounts.sqlite"));
  try {
    ensureDatabaseSchema(
      previous,
      "accounts-core",
      ACCOUNTS_CORE_SCHEMA.slice(0, 3),
      {
        compatibleObjects: [
          "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
        ],
      },
    );
    await leaveDeadRegistration(f.root);
    const review = reviewDataWriters(f.root, "synthetic-host", authorize);
    assert.throws(
      () =>
        recoverDataWriters(
          f.root,
          request(review, {
            afterIntent: () => {
              throw Error("INJECTED_AFTER_FENCE");
            },
          }),
          authorize,
        ),
      /INJECTED_AFTER_FENCE/,
    );
    assert.throws(
      () =>
        previous
          .prepare("INSERT INTO account_meta VALUES(?,?)")
          .run("old-writer", "rejected"),
      /INCOMPATIBLE_SCHEMA_WRITER/,
    );
    recoverDataWriters(f.root, request(review), authorize);
  } finally {
    previous.close();
  }
});
test(
  "a dangling control symlink is refused without creating its target",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t),
      target = join(f.root, "unexpected.sqlite");
    symlinkSync(target, join(f.root, ".data-control.sqlite"));
    assert.throws(() => f.acquire(), /DATA_CONTROL_RECONCILIATION/);
    assert.equal(existsSync(target), false);
  },
);
