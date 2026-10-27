import { makeFixture, restoreBeforeNewWrites } from "./fixture.mjs";
import { migrate, openMigration } from "./migration.mjs";
import assert from "node:assert/strict";

if (process.argv.length > 2)
  throw Error("Synthetic rehearsal accepts no input paths or arguments");
const fixture = makeFixture();
try {
  assert.throws(() => migrate(fixture, { failAt: "ledger" }), /INJECTED_/);
  assert.equal(migrate(fixture).repeated, false);
  assert.equal(migrate(fixture).repeated, true);
  const db = openMigration(fixture);
  try {
    for (const name of ["main", "tenant", "ledger", "safety"])
      assert.equal(
        Object.values(db.prepare(`PRAGMA ${name}.integrity_check`).get())[0],
        "ok",
      );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM tenant.task_v4").get().n,
      7,
    );
    assert.equal(
      db
        .prepare("SELECT SUM(reserved_micros) n FROM ledger.legacy_unknown")
        .get().n,
      700000,
    );
    assert.equal(
      db
        .prepare(
          "SELECT SUM(granted_micros+spent_micros) n FROM ledger.wallets",
        )
        .get().n,
      0,
    );
  } finally {
    db.close();
  }
  restoreBeforeNewWrites(fixture);
  console.log(
    JSON.stringify({
      synthetic: true,
      legacyAccounts: 2,
      migratedTasks: 7,
      unknownPreserved: true,
      duplicateGrant: false,
      rollback: true,
      idempotent: true,
      integrity: true,
      runtimeEnabled: false,
      providerCalls: 0,
    }),
  );
} finally {
  fixture.cleanup();
}
