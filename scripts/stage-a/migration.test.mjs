import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SyncStore } from "../../server/sync-store.mjs";
import {
  makeFixture,
  openFixture,
  restoreBeforeNewWrites,
} from "./fixture.mjs";
import { migrate, openMigration } from "./migration.mjs";

function fixture(t) {
  const f = makeFixture();
  t.after(() => f.cleanup());
  return f;
}
function legacyRows(db) {
  return Object.fromEntries(
    [
      "accounts",
      "bindings",
      "account_meta",
      "ai_usage",
      "nonces",
      "request_rates",
      "tenant.sync_meta",
      "tenant.sync_records",
      "tenant.sync_devices",
      "tenant.sync_operations",
      "tenant.sync_jobs",
      "tenant.sync_attachments",
      "tenant.sync_blobs",
    ].map((name) => [
      name,
      db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}
function originalRows(f) {
  const db = openFixture(f, false);
  try {
    db.prepare("ATTACH DATABASE ? AS tenant").run(
      join(f.original, "tenant.sqlite"),
    );
    return legacyRows(db);
  } finally {
    db.close();
  }
}

test("old real-module schema migrates without changing identities, content, blobs, cursors or dedup history", (t) => {
  const f = fixture(t),
    before = originalRows(f);
  migrate(f);
  const db = openMigration(f);
  try {
    assert.deepEqual(legacyRows(db), before);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM account_credentials WHERE claim_required=1 AND password_hash IS NULL",
        )
        .get().n,
      2,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM device_slots").get().n, 2);
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM device_slots WHERE binding_id=?")
        .get(f.revokedId).n,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM tenant.task_v4").get().n,
      7,
    );
    assert.equal(
      db.prepare("SELECT state FROM tenant.task_v4 WHERE id='job_0'").get()
        .state,
      "interrupted",
    );
    assert.equal(
      db.prepare("SELECT state FROM tenant.task_v4 WHERE id='job_2'").get()
        .state,
      "conflict",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM tenant.task_v4 WHERE eligible=1").get()
        .n,
      0,
    );
    const retention = db
      .prepare("SELECT * FROM tenant.original_retention")
      .get();
    assert.equal(retention.state, "legacy_pending_notice");
    assert.equal(retention.cleanup_at, null);
    for (const name of ["main", "tenant", "ledger", "safety"]) {
      assert.equal(
        Object.values(db.prepare(`PRAGMA ${name}.integrity_check`).get())[0],
        "ok",
      );
      assert.deepEqual(
        db.prepare(`PRAGMA ${name}.foreign_key_check`).all(),
        [],
      );
    }
  } finally {
    db.close();
  }
  const oldStore = new SyncStore(join(f.target, "tenant.sqlite"));
  try {
    assert.equal(
      oldStore.record("packet_3").data.result.items[0].title,
      "合成报告",
    );
    assert.equal(
      oldStore.db.prepare("SELECT COUNT(*) n FROM sync_operations").get().n,
      1,
    );
  } finally {
    oldStore.close();
  }
});

test("legacy reservations remain unknown, cannot become actual spending or a fresh grant, and repeat migration is idempotent", (t) => {
  const f = fixture(t);
  assert.equal(migrate(f).repeated, false);
  assert.equal(migrate(f).repeated, true);
  const db = openMigration(f);
  try {
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM ledger.legacy_unknown").get().n,
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
          "SELECT SUM(granted_micros+spent_micros+reconciled) n FROM ledger.wallets",
        )
        .get().n,
      0,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM ledger.events").get().n, 7);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM safety.events").get().n, 1);
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO ledger.events(operation_key,user_id,kind,amount_micros) SELECT operation_key,user_id,kind,amount_micros FROM ledger.events LIMIT 1",
          )
          .run(),
      /UNIQUE/,
    );
  } finally {
    db.close();
  }
});

for (const failAt of ["accounts", "ledger", "commit"])
  test(`failure after ${failAt} rolls back every attached schema; safe retry succeeds`, (t) => {
    const f = fixture(t),
      before = originalRows(f);
    assert.throws(() => migrate(f, { failAt }), /INJECTED_/);
    const db = openMigration(f);
    try {
      assert.deepEqual(legacyRows(db), before);
      for (const [schema, table] of [
        ["main", "account_credentials"],
        ["main", "stage_a_versions"],
        ["tenant", "task_v4"],
        ["ledger", "wallets"],
        ["safety", "events"],
      ])
        assert.equal(
          db
            .prepare(
              `SELECT COUNT(*) n FROM ${schema}.sqlite_master WHERE name=?`,
            )
            .get(table).n,
          0,
        );
    } finally {
      db.close();
    }
    assert.equal(migrate(f).version, 1);
  });

test("unknown old states abort migration without erasing original jobs", (t) => {
  const f = fixture(t);
  const db = new DatabaseSync(join(f.target, "tenant.sqlite"));
  db.exec("UPDATE sync_jobs SET state='future_state' WHERE id='job_0'");
  db.close();
  assert.throws(() => migrate(f), /UNKNOWN_LEGACY_STATE/);
  const check = openMigration(f);
  try {
    assert.equal(
      check.prepare("SELECT state FROM tenant.sync_jobs WHERE id='job_0'").get()
        .state,
      "future_state",
    );
    assert.equal(
      check
        .prepare(
          "SELECT COUNT(*) n FROM ledger.sqlite_master WHERE name='wallets'",
        )
        .get().n,
      0,
    );
  } finally {
    check.close();
  }
});

test("before-new-writes checkpoint rollback restores exact source bytes and original readers", (t) => {
  const f = fixture(t);
  migrate(f);
  restoreBeforeNewWrites(f);
  for (const name of ["accounts.sqlite", "tenant.sqlite"])
    assert.deepEqual(
      readFileSync(join(f.target, name)),
      readFileSync(join(f.original, name)),
    );
  const db = openFixture(f);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts").get().n, 2);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM sqlite_master WHERE name='account_credentials'",
        )
        .get().n,
      0,
    );
  } finally {
    db.close();
  }
});

test("database constraints enforce three Windows slots, one WeChat identity, ownership and one publication per block item", (t) => {
  const f = fixture(t);
  migrate(f);
  const db = openMigration(f);
  try {
    for (let slot = 2; slot <= 4; slot++) {
      const insert = () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "INSERT INTO bindings(id,user_id,kind,identity,public_key,expires) VALUES(?,?,'windows',?,'synthetic',9999999999999)",
          ).run("win_" + slot, f.userId, "synthetic-" + slot);
          db.prepare("INSERT INTO device_slots VALUES(?,?,'windows',?)").run(
            "win_" + slot,
            f.userId,
            slot,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      };
      if (slot <= 3) insert();
      else assert.throws(insert, /CHECK/);
    }
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM bindings WHERE user_id=? AND kind='windows' AND revoked=0",
        )
        .get(f.userId).n,
      3,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE device_slots SET user_id=? WHERE binding_id=?")
          .run(f.otherUserId, f.bindingId),
      /SLOT_BINDING_MISMATCH/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO bindings(id,user_id,kind,identity,expires) VALUES('wx2',?,'wechat','synthetic-openid-2',9999999999999)",
          )
          .run(f.userId),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO bindings(id,user_id,kind,identity,expires) VALUES('wx3',?,'wechat','synthetic-openid',9999999999999)",
          )
          .run(f.otherUserId),
      /UNIQUE/,
    );
    db.exec(
      "INSERT INTO tenant.blocks VALUES('block','job_3','input-range-version','completed')",
    );
    db.exec("INSERT INTO tenant.publications VALUES('job_3','block','item')");
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO tenant.publications VALUES('job_3','block','item')",
        ),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO tenant.publications VALUES('job_4','block','item2')",
        ),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        db.exec(
          "INSERT INTO tenant.original_retention VALUES('packet_0','missing-time','retained',1,NULL)",
        ),
      /CHECK/,
    );
  } finally {
    db.close();
  }
});

test("two writer connections cannot claim the same third slot", (t) => {
  const f = fixture(t);
  migrate(f);
  const db = openMigration(f),
    rival = openFixture(f);
  try {
    rival.exec("PRAGMA busy_timeout=1");
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "INSERT INTO bindings(id,user_id,kind,identity,expires) VALUES('third',?,'windows','third-synthetic',9999999999999)",
    ).run(f.userId);
    db.prepare("INSERT INTO device_slots VALUES('third',?,'windows',3)").run(
      f.userId,
    );
    assert.throws(() => rival.exec("BEGIN IMMEDIATE"), /locked/);
    db.exec("COMMIT");
    rival.exec("BEGIN IMMEDIATE");
    rival
      .prepare(
        "INSERT INTO bindings(id,user_id,kind,identity,expires) VALUES('rival',?,'windows','rival-synthetic',9999999999999)",
      )
      .run(f.userId);
    assert.throws(
      () =>
        rival
          .prepare("INSERT INTO device_slots VALUES('rival',?,'windows',3)")
          .run(f.userId),
      /UNIQUE/,
    );
    rival.exec("ROLLBACK");
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM bindings WHERE id='rival'").get().n,
      0,
    );
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    if (rival.isTransaction) rival.exec("ROLLBACK");
    rival.close();
    db.close();
  }
});

test("ledger and safety records are append-only, prices frozen, and a settled call cannot omit usage", (t) => {
  const f = fixture(t);
  migrate(f);
  const db = openMigration(f);
  try {
    assert.throws(() => db.exec("DELETE FROM ledger.events"), /APPEND_ONLY/);
    assert.throws(
      () => db.exec("UPDATE ledger.events SET amount_micros=0"),
      /APPEND_ONLY/,
    );
    assert.throws(() => db.exec("DELETE FROM safety.events"), /APPEND_ONLY/);
    // Synthetic numeric prices only; never a live supplier price or permission to call.
    db.exec(
      "INSERT INTO ledger.price_snapshots VALUES('synthetic-price','synthetic-model','CNY',1,100,10,200,'synthetic-source')",
    );
    assert.throws(
      () =>
        db.exec(
          "UPDATE ledger.price_snapshots SET output_micros_per_million=0",
        ),
      /IMMUTABLE_PRICE/,
    );
    const insert = db.prepare(
      "INSERT INTO ledger.calls VALUES('synthetic-call',?,'root','task','block',1,'synthetic-price','2026-10-28','settled',1000,100,NULL)",
    );
    assert.throws(() => insert.run(f.userId), /CHECK/);
    const withUsage = db.prepare(
      "INSERT INTO ledger.calls VALUES('synthetic-call',?,'root','task','block',1,'synthetic-price','2026-10-28','settled',1000,100,?)",
    );
    for (const usage of [
      "null",
      "{}",
      "[]",
      '{"prompt_tokens":1}',
      '{"prompt_tokens":-1,"completion_tokens":2}',
      '{"prompt_tokens":1.5,"completion_tokens":2}',
    ])
      assert.throws(() => withUsage.run(f.userId, usage), /CHECK/);
    withUsage.run(f.userId, '{"prompt_tokens":100,"completion_tokens":20}');
    db.prepare(
      "INSERT INTO ledger.calls VALUES('unknown-call',?,'root','task','block',1,'synthetic-price','2026-10-28','unknown',1000,NULL,NULL)",
    ).run(f.userId);
    assert.equal(
      db
        .prepare(
          "SELECT settled_micros FROM ledger.calls WHERE id='unknown-call'",
        )
        .get().settled_micros,
      null,
    );
  } finally {
    db.close();
  }
});

test("rehearsal cannot accept a caller-supplied personal directory", () => {
  assert.throws(() => migrate({ target: "." }), /SYNTHETIC_FIXTURE_REQUIRED/);
  assert.throws(
    () => restoreBeforeNewWrites({ target: "." }),
    /SYNTHETIC_FIXTURE_REQUIRED/,
  );
});

test("a version marker cannot hide an incomplete migrated projection on repeat", (t) => {
  const f = fixture(t);
  migrate(f);
  const db = openMigration(f);
  db.prepare("DELETE FROM ledger.wallets WHERE user_id=?").run(f.userId);
  db.close();
  assert.throws(() => migrate(f), /MIGRATION_INTEGRITY/);
});
