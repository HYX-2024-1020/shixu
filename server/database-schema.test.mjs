import { AccountsV4 } from "./accounts-v4.mjs";
import { assertReadingSchema } from "./reading/schema.mjs";
import { spawnSync } from "node:child_process";
import { AccountRegistry } from "./sync-accounts.mjs";
import { createAttachmentStore } from "./sync-files.mjs";
import { OriginalStore } from "./originals.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { runRuntimeSchemaRehearsal } from "../scripts/runtime-schema-rehearsal.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  ensureDatabaseSchema,
  reviewDatabaseSchema,
} from "./database-schema.mjs";
import { SyncStore } from "./sync-store.mjs";
function removeFixture(directory) {
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("shixu-schema-")
  )
    throw Error("UNSAFE_SYNTHETIC_CLEANUP");
  rmSync(directory, { recursive: true, force: true });
}
test("an existing tenant missing its required index fails startup instead of silently healing its schema", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-schema-"));
  t.after(() => removeFixture(directory));
  const path = join(directory, "tenant.sqlite"),
    store = new SyncStore(path);
  store.db.exec("DROP INDEX sync_records_version");
  store.close();
  assert.throws(() => {
    const opened = new SyncStore(path);
    opened.close();
  }, /DATABASE_SCHEMA_MISMATCH/);
});

const v1 = {
  version: 1,
  sql: "CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE INDEX records_value ON records(value);",
};
const v2 = {
  version: 2,
  sql: "ALTER TABLE records ADD COLUMN state TEXT NOT NULL DEFAULT 'kept';",
};
function db(t) {
  const d = new DatabaseSync(":memory:");
  t.after(() => d.close());
  return d;
}
test("read-only review, exact legacy adoption and repeated startup preserve data and version receipts", (t) => {
  const d = db(t);
  d.exec(v1.sql);
  d.prepare("INSERT INTO records VALUES(?,?)").run("old", "unchanged");
  const before = d.prepare("SELECT total_changes() n").get().n,
    review = reviewDatabaseSchema(d, "demo-core", [v1]);
  assert.equal(review.action, "adopt");
  assert.equal(d.prepare("SELECT total_changes() n").get().n, before);
  assert.equal(
    d
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
      )
      .get(),
    undefined,
  );
  ensureDatabaseSchema(d, "demo-core", [v1], {
    expectedPlanHash: review.planHash,
    now: () => 1,
  });
  assert.equal(
    d.prepare("SELECT adopted FROM service_schema_versions").get().adopted,
    1,
  );
  assert.deepEqual(
    { ...d.prepare("SELECT * FROM records").get() },
    { id: "old", value: "unchanged" },
  );
  const changes = d.prepare("SELECT total_changes() n").get().n;
  ensureDatabaseSchema(d, "demo-core", [v1]);
  assert.equal(d.prepare("SELECT total_changes() n").get().n, changes);
  assert.throws(
    () => d.exec("DELETE FROM service_schema_versions"),
    /IMMUTABLE_SCHEMA_VERSION/,
  );
});
test("new creation and explicit next-version migration are atomic, review-bound and cannot downgrade", (t) => {
  const d = db(t),
    initial = reviewDatabaseSchema(d, "demo-core", [v1]);
  assert.equal(initial.action, "create");
  ensureDatabaseSchema(d, "demo-core", [v1]);
  d.prepare("INSERT INTO records VALUES(?,?)").run("a", "preserved");
  const review = reviewDatabaseSchema(d, "demo-core", [v1, v2]);
  assert.equal(review.action, "migrate");
  assert.equal(review.currentVersion, 1);
  ensureDatabaseSchema(d, "demo-core", [v1, v2], {
    expectedPlanHash: review.planHash,
  });
  assert.equal(d.prepare("SELECT state FROM records").get().state, "kept");
  assert.throws(
    () => ensureDatabaseSchema(d, "demo-core", [v1]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
  assert.throws(
    () =>
      ensureDatabaseSchema(d, "demo-core", [v1, v2], {
        expectedPlanHash: review.planHash,
      }),
    /STALE_SCHEMA_REVIEW/,
  );
  assert.equal(
    d.prepare("SELECT COUNT(*) n FROM service_schema_versions").get().n,
    2,
  );
  // A failed review never replaces a previously verified runtime capability.
  d.prepare("INSERT INTO records(id,value) VALUES(?,?)").run(
    "b",
    "verified v2",
  );
});
test("injected crash after DDL rolls back schema, data and receipt; restart resumes without a partial version", (t) => {
  const d = db(t);
  assert.throws(
    () =>
      ensureDatabaseSchema(d, "demo-core", [v1], {
        afterStep: () => {
          throw Error("crash");
        },
      }),
    /crash/,
  );
  assert.equal(
    d.prepare("SELECT 1 FROM sqlite_master WHERE name='records'").get(),
    undefined,
  );
  assert.equal(
    d
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
      )
      .get(),
    undefined,
  );
  ensureDatabaseSchema(d, "demo-core", [v1]);
  d.prepare("INSERT INTO records VALUES(?,?)").run("a", "original");
  assert.throws(
    () =>
      ensureDatabaseSchema(d, "demo-core", [v1, v2], {
        afterStep: () => {
          throw Error("crash");
        },
      }),
    /crash/,
  );
  assert.equal(d.prepare("PRAGMA table_info(records)").all().length, 2);
  assert.equal(
    d.prepare("SELECT COUNT(*) n FROM service_schema_versions").get().n,
    1,
  );
  assert.equal(d.prepare("SELECT value FROM records").get().value, "original");
  ensureDatabaseSchema(d, "demo-core", [v1, v2]);
  assert.equal(d.prepare("SELECT state FROM records").get().state, "kept");
});
test("partial legacy DDL, changed migration checksums, unknown extra triggers and missing writer guards fail closed", (t) => {
  const partial = db(t);
  partial.exec("CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
  assert.throws(
    () => ensureDatabaseSchema(partial, "demo-core", [v1]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
  assert.equal(
    partial
      .prepare("SELECT 1 FROM sqlite_master WHERE name='records_value'")
      .get(),
    undefined,
  );
  const d = db(t);
  ensureDatabaseSchema(d, "demo-core", [v1]);
  assert.throws(
    () => ensureDatabaseSchema(d, "demo-core", [{ ...v1, sql: v1.sql + " " }]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
  d.exec(
    "CREATE TRIGGER unexpected BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'surprise');END",
  );
  assert.throws(
    () => ensureDatabaseSchema(d, "demo-core", [v1]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
  d.exec(
    "DROP TRIGGER unexpected; DROP TRIGGER service_guard_demo_core_records_update",
  );
  assert.throws(
    () => ensureDatabaseSchema(d, "demo-core", [v1]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
});
test("a legacy raw SQLite writer has no registered capability and cannot mutate an upgraded database", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-schema-writer-"));
  t.after(() => removeFixture(directory));
  const path = join(directory, "data.sqlite"),
    d = new DatabaseSync(path);
  ensureDatabaseSchema(d, "demo-core", [v1]);
  d.prepare("INSERT INTO records VALUES(?,?)").run("a", "kept");
  d.close();
  const old = new DatabaseSync(path);
  try {
    assert.equal(
      reviewDatabaseSchema(old, "demo-core", [v1]).action,
      "current",
    );
    assert.equal(old.prepare("SELECT value FROM records").get().value, "kept");
    assert.throws(
      () => old.exec("UPDATE records SET value='lost'"),
      /service_schema_writer/,
    );
    assert.throws(
      () => old.exec("DELETE FROM records"),
      /service_schema_writer/,
    );
    assert.throws(
      () => old.exec("INSERT INTO records VALUES('b','bad')"),
      /service_schema_writer/,
    );
    const newer = new DatabaseSync(path);
    ensureDatabaseSchema(newer, "demo-core", [v1, v2]);
    newer.close();
    assert.throws(
      () => ensureDatabaseSchema(old, "demo-core", [v1]),
      /DATABASE_SCHEMA_MISMATCH/,
    );
    assert.throws(
      () => old.exec("UPDATE records SET value='old runtime'"),
      /INCOMPATIBLE_SCHEMA_WRITER/,
    );
    ensureDatabaseSchema(old, "demo-core", [v1, v2]);
    old.exec("UPDATE records SET value='verified v2'");
  } finally {
    old.close();
  }
});
test("nested account-style migration rolls back with its owner transaction", (t) => {
  const d = db(t);
  d.exec("BEGIN IMMEDIATE");
  ensureDatabaseSchema(d, "demo-core", [v1]);
  d.exec("ROLLBACK");
  assert.equal(
    d
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
      )
      .get(),
    undefined,
  );
  ensureDatabaseSchema(d, "demo-core", [v1]);
  assert.equal(reviewDatabaseSchema(d, "demo-core", [v1]).action, "current");
});

for (const failAfter of ["", "accounts", "tenant", "ledger"])
  test(
    "real legacy factories and current core modules preserve account, originals, fees and unknown after " +
      (failAfter || "normal") +
      " migration",
    () => {
      const report = runRuntimeSchemaRehearsal({ failAfter });
      assert.equal(report.legacySpentMicros, 14);
      assert.equal(report.unknownRiskMicros, 1000);
      assert.equal(report.noDuplicateGrants, true);
    },
  );

test("legacy referential damage and a lost tenant cursor cannot be adopted or initialized away", (t) => {
  const d = db(t),
    schema = [
      {
        version: 1,
        sql: "CREATE TABLE parents(id TEXT PRIMARY KEY);CREATE TABLE children(id TEXT PRIMARY KEY,parent TEXT REFERENCES parents(id));",
      },
    ];
  d.exec(schema[0].sql);
  d.exec("PRAGMA foreign_keys=OFF; INSERT INTO children VALUES('c','missing')");
  assert.throws(
    () => ensureDatabaseSchema(d, "demo-foreign", schema),
    /DATABASE_STATE_RECONCILIATION/,
  );
  assert.equal(
    d
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
      )
      .get(),
    undefined,
  );
  const directory = mkdtempSync(join(tmpdir(), "shixu-schema-cursor-"));
  t.after(() => removeFixture(directory));
  const path = join(directory, "tenant.sqlite"),
    store = new SyncStore(path);
  store.db.exec("DELETE FROM sync_meta WHERE key='epoch'");
  store.close();
  assert.throws(() => new SyncStore(path), /DATABASE_STATE_RECONCILIATION/);
});

test("historical factory sources are frozen at the stage-A commit and verified by SHA256", () => {
  const root = new URL("../scripts/stage-a/legacy/", import.meta.url),
    proof = JSON.parse(readFileSync(new URL("provenance.json", root), "utf8"));
  assert.equal(proof.commit, "aad190373781a52454a6875426d46b2cf0c8fcd5");
  assert.equal(proof.files.length, 4);
  for (const file of proof.files)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(new URL(file.file, root)))
        .digest("hex"),
      file.sha256,
    );
});

test("lost registry, original-retention and ledger markers are never replaced with new defaults", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-schema-markers-"));
  t.after(() => removeFixture(directory));
  const secret = "synthetic-schema-marker-secret-32-chars",
    registry = new AccountRegistry(directory, secret);
  registry.generate(1);
  registry.db.exec("DELETE FROM account_meta WHERE key='secret_check'");
  registry.close();
  assert.throws(
    () => new AccountRegistry(directory, secret),
    /DATABASE_STATE_RECONCILIATION/,
  );
  const store = new SyncStore(":memory:");
  createAttachmentStore(store);
  new OriginalStore(store);
  store.db.exec("DELETE FROM sync_meta WHERE key='originals_v4'");
  assert.throws(
    () => new OriginalStore(store),
    /DATABASE_STATE_RECONCILIATION/,
  );
  store.close();
  const path = join(directory, "ledger.sqlite"),
    ledger = new ReadingLedger(path);
  ledger.grantInitial("synthetic");
  ledger.db.exec("DELETE FROM reading_controls");
  ledger.close();
  assert.throws(() => new ReadingLedger(path), /DATABASE_STATE_RECONCILIATION/);
  const raw = new DatabaseSync(path);
  try {
    assert.equal(
      raw.prepare("SELECT COUNT(*) n FROM reading_controls").get().n,
      0,
    );
    assert.equal(
      raw.prepare("SELECT granted FROM reading_wallets").get().granted,
      20000000,
    );
  } finally {
    raw.close();
  }
});

test("frozen stage-A server constructors cannot reopen upgraded tenant and account databases for writing", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-schema-old-binary-"));
  t.after(() => removeFixture(directory));
  const tenant = join(directory, "tenant.sqlite"),
    store = new SyncStore(tenant);
  store.close();
  const secret = "synthetic-old-writer-secret-32-characters",
    registry = new AccountRegistry(directory, secret);
  registry.close();
  const code = `import {SyncStore}from ${JSON.stringify(new URL("../scripts/stage-a/legacy/sync-store.mjs", import.meta.url).href)};import {AccountRegistry}from ${JSON.stringify(new URL("../scripts/stage-a/legacy/sync-accounts.mjs", import.meta.url).href)};for(const open of [()=>new SyncStore(${JSON.stringify(tenant)}),()=>new AccountRegistry(${JSON.stringify(directory)},${JSON.stringify(secret)})]){let rejected=false;try{open()}catch(error){if(!/service_schema_writer/.test(error.message))throw error;rejected=true}if(!rejected)throw Error('OLD_WRITER_ACCEPTED')}console.log('OLD_WRITERS_REJECTED');`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf8", timeout: 5000, maxBuffer: 16384 },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /OLD_WRITERS_REJECTED/);
});

test("schema adoption preserves whitespace inside SQL literals instead of equating different defaults", (t) => {
  const d = db(t);
  d.exec(
    "CREATE TABLE spaced(id TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT 'a b')",
  );
  assert.throws(
    () =>
      ensureDatabaseSchema(d, "demo-spaced", [
        {
          version: 1,
          sql: "CREATE TABLE spaced(id TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT 'a  b')",
        },
      ]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
  assert.equal(
    d
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
      )
      .get(),
    undefined,
  );
  assert.throws(
    () =>
      assertReadingSchema(
        { db: d },
        "CREATE TABLE spaced(id TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT 'a  b')",
      ),
    /READING_SCHEMA_MISMATCH/,
  );
  const unicode = db(t);
  unicode.exec(
    "CREATE TABLE spaced(id TEXT PRIMARY KEY,value\u00a0TEXT DEFAULT 'x')",
  );
  assert.throws(
    () =>
      ensureDatabaseSchema(unicode, "demo-spaced", [
        {
          version: 1,
          sql: "CREATE TABLE spaced(id TEXT PRIMARY KEY,value TEXT DEFAULT 'x')",
        },
      ]),
    /DATABASE_SCHEMA_MISMATCH/,
  );
});

test("auth mode and the legacy slot index must agree; lost markers cannot reopen legacy enrollment", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shixu-schema-auth-mode-"));
  t.after(() => removeFixture(directory));
  const secret = "synthetic-schema-auth-mode-secret-32-chars";
  for (const mode of ["lost-index", "extra-index", "lost-mode"]) {
    const root = join(directory, mode),
      registry = new AccountRegistry(root, secret);
    if (mode === "lost-index") registry.db.exec("DROP INDEX active_slot");
    else {
      new AccountsV4(registry);
      registry.db.exec(
        "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
      );
      if (mode === "lost-mode")
        registry.db.exec("DELETE FROM account_meta WHERE key='auth_v4'");
    }
    registry.close();
    assert.throws(
      () => new AccountRegistry(root, secret),
      /DATABASE_STATE_RECONCILIATION/,
    );
  }
});
