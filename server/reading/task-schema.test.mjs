import { manufactureLegacyTaskTenant } from "./legacy-task-fixtures.mjs";
import { finishMerge } from "./merge-fixtures.mjs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { AccountRegistry } from "../sync-accounts.mjs";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import {
  TENANT_SYNC_SCHEMA,
  ACCOUNTS_CORE_SCHEMA,
  LEDGER_CORE_SCHEMA,
  READING_TASKS_SCHEMA,
} from "../database-schemas.mjs";
import { applyReadingMigrations } from "./schema.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mergeFixture } from "./merge-fixtures.mjs";
import { ReadingTasks } from "./tasks.mjs";
for (const [name, side, sql] of [
  ["publication table", "store", "DROP TABLE reading_publications"],
  ["root table", "store", "DROP TABLE reading_roots"],
  [
    "paid-proof trigger",
    "ledger",
    "DROP TRIGGER reading_paid_proofs_no_update",
  ],
  [
    "chat-proof trigger",
    "ledger",
    "DROP TRIGGER reading_chat_proofs_no_delete",
  ],
  [
    "visual-proof trigger",
    "ledger",
    "DROP TRIGGER reading_visual_proofs_update",
  ],
  ["reading cursor table", "store", "DROP TABLE reading_windows"],
])
  test(
    "task startup refuses a lost " +
      name +
      " instead of repairing it before checking history",
    (t) => {
      const f = mergeFixture(t, { sourceText: "合成" });
      f[side].db.exec(sql);
      assert.throws(() => {
        const opened = new ReadingTasks(f.args);
        opened.close();
      }, /DATABASE_SCHEMA_MISMATCH/);
      assert.equal(f.ledger.wallet("synthetic").spent, 0);
    },
  );

test("protected reading components advance both version histories once and roll both back on receipt failure", (t) => {
  const f = mergeFixture(t, { sourceText: "合成" }),
    m1 = {
      version: 1,
      sql: "CREATE TABLE synthetic_reading_upgrade(id TEXT PRIMARY KEY);",
    },
    m2 = {
      version: 2,
      sql: "ALTER TABLE synthetic_reading_upgrade ADD COLUMN state TEXT NOT NULL DEFAULT 'kept';",
    };
  assert.equal(applyReadingMigrations(f.ledger, "synthetic-upgrade", [m1]), 1);
  f.ledger.db
    .prepare("INSERT INTO synthetic_reading_upgrade VALUES(?)")
    .run("old");
  const prepare = f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO reading_schema_versions"))
      throw Error("INJECTED_VERSION_RECEIPT");
    return prepare(sql);
  };
  try {
    assert.throws(
      () => applyReadingMigrations(f.ledger, "synthetic-upgrade", [m1, m2]),
      /INJECTED_VERSION_RECEIPT/,
    );
  } finally {
    f.ledger.db.prepare = prepare;
  }
  assert.equal(
    f.ledger.db.prepare("PRAGMA table_info(synthetic_reading_upgrade)").all()
      .length,
    1,
  );
  assert.equal(
    f.ledger.db
      .prepare(
        "SELECT COUNT(*) n FROM reading_schema_versions WHERE component='synthetic-upgrade'",
      )
      .get().n,
    1,
  );
  assert.equal(
    f.ledger.db
      .prepare(
        "SELECT COUNT(*) n FROM service_schema_versions WHERE component='reading-synthetic-upgrade'",
      )
      .get().n,
    1,
  );
  assert.equal(
    applyReadingMigrations(f.ledger, "synthetic-upgrade", [m1, m2]),
    2,
  );
  assert.equal(
    applyReadingMigrations(f.ledger, "synthetic-upgrade", [m1, m2]),
    2,
  );
  assert.equal(
    f.ledger.db.prepare("SELECT state FROM synthetic_reading_upgrade").get()
      .state,
    "kept",
  );
  assert.throws(
    () => applyReadingMigrations(f.ledger, "synthetic-upgrade", [m1]),
    /READING_SCHEMA_MISMATCH/,
  );
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
});

test("the immediately previous tenant, task and ledger writers cannot run partial successors", t => {
  const f = mergeFixture(t, { sourceText: "合成" });
  for (const [owner, component, migrations, sql, options] of [
    [f.store, "tenant-sync", TENANT_SYNC_SCHEMA, "UPDATE sync_meta SET value=value", {}],
    [f.store, "tenant-reading", READING_TASKS_SCHEMA, "INSERT INTO reading_tasks(id,packet,device,input_revision,base_version,state) VALUES('old','packet','old','old',0,'queued')", { compatibleObjects: ["CREATE INDEX reading_tasks_packet ON reading_tasks(packet)"] }],
    [f.ledger, "ledger-core", LEDGER_CORE_SCHEMA, "UPDATE reading_controls SET paused=paused", { compatibleObjects: ["CREATE INDEX reading_calls_account_task ON reading_calls(account,task)"] }],
  ]) {
    const old = new DatabaseSync(owner.db.location());
    try {
      assert.throws(() => ensureDatabaseSchema(old, component, migrations.slice(0, -1), options), /DATABASE_SCHEMA_MISMATCH/);
      assert.throws(() => old.exec(sql), /INCOMPATIBLE_SCHEMA_WRITER/);
    } finally { old.close(); }
  }
});

test("all initialized tenant and independent-ledger tables have verified writer guards", (t) => {
  const f = mergeFixture(t, { sourceText: "合成" });
  for (const db of [f.store.db, f.ledger.db])
    for (const { name } of db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='service_schema_versions'",
      )
      .all())
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND name LIKE 'service_guard_%'",
          )
          .get(name).n,
        3,
        name,
      );
});
test("the previous runtime core manifests cannot reopen or write any upgraded database family", (t) => {
  const f = mergeFixture(t, { sourceText: "合成" }),
    directory = join(f.directory, "account-writer");
  const registry = new AccountRegistry(
    directory,
    "synthetic-task-schema-secret-32-chars",
  );
  registry.close();
  for (const [path, component, migrations, options, sql] of [
    [
      join(f.directory, "tenant.sqlite"),
      "tenant-sync",
      TENANT_SYNC_SCHEMA.slice(0, 1),
      {},
      "UPDATE sync_meta SET value=value WHERE key='schema'",
    ],
    [
      join(directory, "accounts.sqlite"),
      "accounts-core",
      ACCOUNTS_CORE_SCHEMA.slice(0, 1),
      {
        compatibleObjects: [
          "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
        ],
      },
      "UPDATE account_meta SET value=value WHERE key='secret_check'",
    ],
    [
      join(f.directory, "ledger.sqlite"),
      "ledger-core",
      LEDGER_CORE_SCHEMA.slice(0, 2),
      {
        compatibleObjects: [
          "CREATE INDEX reading_calls_account_task ON reading_calls(account,task)",
        ],
      },
      "UPDATE reading_controls SET paused=paused",
    ],
  ]) {
    const old = new DatabaseSync(path);
    try {
      assert.throws(
        () => ensureDatabaseSchema(old, component, migrations, options),
        /DATABASE_SCHEMA_MISMATCH/,
      );
      assert.throws(() => old.exec(sql), /INCOMPATIBLE_SCHEMA_WRITER/);
    } finally {
      old.close();
    }
  }
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
});

test("unversioned compatible task projections upgrade and reuse paid recognition and semantic decisions without another fee", async (t) => {
  const f = mergeFixture(t);
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  const calls = f.calls(),
    spent = f.ledger.wallet("synthetic").spent;
  const legacy = manufactureLegacyTaskTenant(f, { includeRoots: true });
  let upgraded;
  try {
    upgraded = new ReadingTasks({ ...f.args, store: legacy });
    upgraded.enqueue({
      id: "schema-revision",
      packetId: "packet",
      deviceId: f.device,
    });
    assert.equal(
      (await finishMerge(upgraded, "schema-revision")).state,
      "done",
    );
    assert.deepEqual(f.calls(), calls);
    assert.equal(f.ledger.wallet("synthetic").spent, spent);
    assert.equal(legacy.record("packet").data.result.items.length, 1);
    assert.equal(upgraded.reuse.count("schema-revision"), 2);
  } finally {
    upgraded?.close();
    legacy.close();
  }
});
