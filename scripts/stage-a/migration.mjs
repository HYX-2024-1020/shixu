// Offline synthetic rehearsal ONLY: never imported by server/desktop/miniprogram.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { assertManufactured, fixtureTime } from "./fixture.mjs";
import { migrateState } from "./contract.mjs";

function validateProjection(db) {
  for (const schema of ["main", "tenant", "ledger", "safety"]) {
    if (
      Object.values(db.prepare(`PRAGMA ${schema}.integrity_check`).get())[0] !==
        "ok" ||
      db.prepare(`PRAGMA ${schema}.foreign_key_check`).all().length
    )
      throw Error("MIGRATION_INTEGRITY");
  }
  const mismatches = db
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM accounts) - (SELECT COUNT(*) FROM account_credentials) AS credentials,
    (SELECT COUNT(*) FROM accounts) - (SELECT COUNT(*) FROM ledger.wallets) AS wallets,
    (SELECT COUNT(*) FROM ai_usage) - (SELECT COUNT(*) FROM ledger.legacy_unknown) AS calls,
    (SELECT COUNT(*) FROM bindings WHERE revoked=0) - (SELECT COUNT(*) FROM device_slots) AS slots,
    (SELECT COUNT(*) FROM tenant.sync_jobs) - (SELECT COUNT(*) FROM tenant.task_v4) AS tasks`,
    )
    .get();
  if (Object.values(mismatches).some((n) => n !== 0))
    throw Error("MIGRATION_INTEGRITY");
  for (const usage of db.prepare("SELECT * FROM ai_usage").all()) {
    const unknown = db
      .prepare(
        "SELECT * FROM ledger.legacy_unknown WHERE user_id=? AND job_id=?",
      )
      .get(usage.user_id, usage.job_id);
    if (
      !unknown ||
      unknown.reserved_micros !== usage.reserved_micros ||
      unknown.legacy_state !== usage.state ||
      unknown.legacy_day !== usage.day
    )
      throw Error("MIGRATION_INTEGRITY");
  }
  for (const job of db.prepare("SELECT * FROM tenant.sync_jobs").all()) {
    const task = db
      .prepare("SELECT * FROM tenant.task_v4 WHERE id=?")
      .get(job.id);
    if (
      !task ||
      task.state !== migrateState(job.state) ||
      task.packet_id !== job.record_id ||
      task.input_revision !== "legacy-unverified:" + job.fingerprint
    )
      throw Error("MIGRATION_INTEGRITY");
  }
}

export function openMigration(fixture) {
  assertManufactured(fixture);
  const db = new DatabaseSync(join(fixture.target, "accounts.sqlite"));
  try {
    for (const name of ["tenant", "ledger", "safety"])
      db.prepare(`ATTACH DATABASE ? AS ${name}`).run(
        join(fixture.target, name + ".sqlite"),
      );
    for (const name of ["main", "tenant", "ledger", "safety"])
      db.exec(
        `PRAGMA ${name}.journal_mode=DELETE; PRAGMA ${name}.synchronous=FULL;`,
      );
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function migrate(fixture, { failAt = "" } = {}) {
  const db = openMigration(fixture);
  try {
    db.exec("BEGIN IMMEDIATE");
    const old = db
      .prepare("SELECT name FROM sqlite_master WHERE name='stage_a_versions'")
      .get();
    if (
      old &&
      db.prepare("SELECT version FROM stage_a_versions WHERE version=1").get()
    ) {
      validateProjection(db);
      db.exec("COMMIT");
      return { version: 1, repeated: true };
    }
    db.exec(`
      CREATE TABLE stage_a_versions(version INTEGER PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE account_credentials(
        user_id TEXT PRIMARY KEY REFERENCES accounts(id), username_key TEXT UNIQUE,
        password_hash TEXT, claim_required INTEGER NOT NULL CHECK(claim_required IN (0,1)),
        CHECK((claim_required=1 AND username_key IS NULL AND password_hash IS NULL) OR
          (claim_required=0 AND username_key IS NOT NULL AND password_hash IS NOT NULL)));
      CREATE TABLE device_slots(
        binding_id TEXT PRIMARY KEY REFERENCES bindings(id), user_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL CHECK(kind IN ('windows','wechat')), slot INTEGER NOT NULL,
        CHECK((kind='windows' AND slot BETWEEN 1 AND 3) OR (kind='wechat' AND slot=1)),
        UNIQUE(user_id,kind,slot));
      CREATE TRIGGER slot_binding_insert BEFORE INSERT ON device_slots
        WHEN NOT EXISTS(SELECT 1 FROM bindings WHERE id=NEW.binding_id AND user_id=NEW.user_id AND kind=NEW.kind AND revoked=0)
        BEGIN SELECT RAISE(ABORT,'SLOT_BINDING_MISMATCH'); END;
      CREATE TRIGGER slot_binding_update BEFORE UPDATE ON device_slots
        WHEN NOT EXISTS(SELECT 1 FROM bindings WHERE id=NEW.binding_id AND user_id=NEW.user_id AND kind=NEW.kind AND revoked=0)
        BEGIN SELECT RAISE(ABORT,'SLOT_BINDING_MISMATCH'); END;
      CREATE TABLE ledger.wallets(user_id TEXT PRIMARY KEY, granted_micros INTEGER NOT NULL DEFAULT 0 CHECK(granted_micros>=0),
        spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(spent_micros>=0), reconciled INTEGER NOT NULL DEFAULT 0 CHECK(reconciled IN (0,1)));
      CREATE TABLE ledger.legacy_unknown(user_id TEXT NOT NULL,job_id TEXT NOT NULL,legacy_day TEXT NOT NULL,
        reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),legacy_state TEXT NOT NULL,
        PRIMARY KEY(user_id,job_id));
      CREATE TABLE ledger.price_snapshots(id TEXT PRIMARY KEY,model TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency='CNY'),
        effective_at INTEGER NOT NULL,input_micros_per_million INTEGER NOT NULL CHECK(input_micros_per_million>=0),
        cached_input_micros_per_million INTEGER NOT NULL CHECK(cached_input_micros_per_million>=0),
        output_micros_per_million INTEGER NOT NULL CHECK(output_micros_per_million>=0),source_hash TEXT NOT NULL);
      CREATE TABLE ledger.calls(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES wallets(user_id),root_task_id TEXT NOT NULL,
        task_id TEXT NOT NULL,block_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=1),
        price_snapshot TEXT NOT NULL REFERENCES price_snapshots(id),day TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('planned','reserved','sent','settled','unknown','released')),
        reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),settled_micros INTEGER CHECK(settled_micros>=0),
        usage TEXT CHECK(usage IS NULL OR json_valid(usage)),
        CHECK((state='settled' AND settled_micros IS NOT NULL AND usage IS NOT NULL) OR
          (state!='settled' AND settled_micros IS NULL)),
        CHECK(state!='settled' OR COALESCE(CASE WHEN json_valid(usage) THEN
          json_type(usage)='object' AND json_type(usage,'$.prompt_tokens')='integer' AND
          json_type(usage,'$.completion_tokens')='integer' AND
          json_extract(usage,'$.prompt_tokens')>=0 AND json_extract(usage,'$.completion_tokens')>=0
          ELSE 0 END,0)));
      CREATE TABLE ledger.events(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_key TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,kind TEXT NOT NULL,amount_micros INTEGER NOT NULL CHECK(amount_micros>=0));
      CREATE TABLE safety.events(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_key TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,object_id TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TRIGGER ledger.events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER ledger.events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER ledger.prices_no_update BEFORE UPDATE ON price_snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRICE'); END;
      CREATE TRIGGER ledger.prices_no_delete BEFORE DELETE ON price_snapshots BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRICE'); END;
      CREATE TRIGGER safety.events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER safety.events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TABLE tenant.task_v4(
        id TEXT PRIMARY KEY,packet_id TEXT NOT NULL REFERENCES sync_records(id),input_revision TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK(generation>=1),state TEXT NOT NULL CHECK(state IN
          ('queued','running','applying','paused','cancelled','interrupted','error','conflict','done','partial','purged')),
        eligible INTEGER NOT NULL DEFAULT 0 CHECK(eligible IN (0,1)));
      CREATE TABLE tenant.blocks(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES task_v4(id),
        fingerprint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed','discarded')),
        UNIQUE(task_id,fingerprint),UNIQUE(id,task_id));
      CREATE TABLE tenant.publications(task_id TEXT NOT NULL REFERENCES task_v4(id),block_id TEXT NOT NULL,
        item_key TEXT NOT NULL,PRIMARY KEY(task_id,block_id,item_key),
        FOREIGN KEY(block_id,task_id) REFERENCES blocks(id,task_id));
      CREATE TABLE tenant.original_retention(packet_id TEXT NOT NULL,id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('legacy_pending_notice','retained','pending_cleanup','cleared')),
        expires_at INTEGER,cleanup_at INTEGER,
        CHECK((state='legacy_pending_notice' AND expires_at IS NULL AND cleanup_at IS NULL) OR
          (state!='legacy_pending_notice' AND expires_at IS NOT NULL AND cleanup_at IS NOT NULL AND cleanup_at>=expires_at)),
        PRIMARY KEY(packet_id,id));
    `);
    for (const { id } of db.prepare("SELECT id FROM accounts").all()) {
      db.prepare("INSERT INTO account_credentials VALUES(?,NULL,NULL,1)").run(
        id,
      );
      db.prepare("INSERT INTO ledger.wallets(user_id) VALUES(?)").run(id);
    }
    if (failAt === "accounts") throw Error("INJECTED_AFTER_ACCOUNTS");
    for (const binding of db
      .prepare("SELECT * FROM bindings WHERE revoked=0 ORDER BY id")
      .all())
      db.prepare("INSERT INTO device_slots VALUES(?,?,?,1)").run(
        binding.id,
        binding.user_id,
        binding.kind,
      );
    db.exec(
      "DROP INDEX active_slot; CREATE UNIQUE INDEX active_wechat_slot ON bindings(user_id) WHERE kind='wechat' AND revoked=0;",
    );
    for (const usage of db.prepare("SELECT * FROM ai_usage").all()) {
      db.prepare("INSERT INTO ledger.legacy_unknown VALUES(?,?,?,?,?)").run(
        usage.user_id,
        usage.job_id,
        usage.day,
        usage.reserved_micros,
        usage.state,
      );
      db.prepare(
        "INSERT INTO ledger.events(operation_key,user_id,kind,amount_micros) VALUES(?,?,'legacy_unknown',?)",
      ).run(
        `legacy:${usage.user_id}:${usage.job_id}`,
        usage.user_id,
        usage.reserved_micros,
      );
    }
    if (failAt === "ledger") throw Error("INJECTED_AFTER_LEDGER");
    for (const job of db.prepare("SELECT * FROM tenant.sync_jobs").all())
      db.prepare("INSERT INTO tenant.task_v4 VALUES(?,?,?,1,?,0)").run(
        job.id,
        job.record_id,
        "legacy-unverified:" + job.fingerprint,
        migrateState(job.state),
      );
    db.exec(`INSERT INTO tenant.original_retention(packet_id,id,state)
      SELECT packet_id,id,'legacy_pending_notice' FROM tenant.sync_attachments;`);
    db.prepare(
      "INSERT INTO safety.events(operation_key,kind,object_id,at) VALUES('stage-a-v1','migration','synthetic',?)",
    ).run(fixtureTime);
    db.prepare("INSERT INTO stage_a_versions VALUES(1,?)").run(fixtureTime);
    if (failAt === "commit") throw Error("INJECTED_BEFORE_COMMIT");
    validateProjection(db);
    db.exec("COMMIT");
    return { version: 1, repeated: false };
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
