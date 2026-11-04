import { reviewDatabaseSchema } from "../server/database-schema.mjs";
// Isolated synthetic rehearsal only. Never accepts an existing data directory.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AccountRegistry as LegacyRegistry } from "./stage-a/legacy/sync-accounts.mjs";
import { SyncStore as LegacyStore } from "./stage-a/legacy/sync-store.mjs";
import { createAttachmentStore as legacyFiles } from "./stage-a/legacy/sync-files.mjs";
import { AccountRegistry } from "../server/sync-accounts.mjs";
import { AccountsV4 } from "../server/accounts-v4.mjs";
import { SyncStore } from "../server/sync-store.mjs";
import { createAttachmentStore } from "../server/sync-files.mjs";
import { OriginalStore } from "../server/originals.mjs";
import { ReadingLedger, validateUsage } from "../server/reading/ledger.mjs";
import {
  TENANT_SYNC_SCHEMA,
  TENANT_ATTACHMENTS_SCHEMA,
  TENANT_ORIGINALS_SCHEMA,
  ACCOUNTS_CORE_SCHEMA,
  ACCOUNTS_AUTH_SCHEMA,
  LEDGER_CORE_SCHEMA,
  LEDGER_COST_SCHEMA,
  LEDGER_TIME_SCHEMA,
  LEDGER_CHECKPOINT_SCHEMA,
} from "../server/database-schemas.mjs";
const secret = "synthetic-schema-rehearsal-secret-32-characters";
const rows = (db, tables) =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
    ]),
  );
export function runRuntimeSchemaRehearsal({ failAfter = "" } = {}) {
  if (!["", "accounts", "tenant", "ledger"].includes(failAfter))
    throw Error("INVALID_SYNTHETIC_FAILURE");
  const directory = mkdtempSync(join(tmpdir(), "shixu-runtime-schema-"));
  let registry, store, ledger, legacy;
  try {
    registry = new LegacyRegistry(directory, secret);
    const [first, second] = registry.generate(2);
    registry.bind(
      first.invite,
      "windows",
      "synthetic-windows",
      "synthetic-public",
    );
    registry.bind(first.invite, "wechat", "synthetic-openid");
    registry.bind(second.invite, "windows", "synthetic-revoked");
    registry.revoke(second.userId, "windows");
    const accountBefore = rows(registry.db, [
      "accounts",
      "bindings",
      "nonces",
      "request_rates",
      "ai_usage",
    ]);
    registry.close();
    registry = null;
    const tenantPath = join(directory, "tenant.sqlite");
    store = new LegacyStore(tenantPath);
    const device = store.createDevice("Synthetic", 1, {
      token: "synthetic-device",
      expiresAt: 9999999999999,
    });
    const files = legacyFiles(store);
    store.apply(
      device.deviceId,
      {
        id: "packet",
        opId: "seed",
        type: "put",
        baseVersion: 0,
        data: {
          text: "合成历史",
          sources: [],
          attachments: [],
          captureDate: "2026-10-31",
          status: "pending",
          result: null,
        },
      },
      store.epoch,
    );
    const file = files.put("packet", "synthetic-file", {
      name: "合成.txt",
      type: "text/plain",
      body: Buffer.from("合成迁移原件"),
      epoch: store.epoch,
    });
    const packet = store.record("packet");
    store.apply(
      device.deviceId,
      {
        id: "packet",
        opId: "attachment",
        type: "put",
        baseVersion: packet.version,
        data: { attachments: [file] },
      },
      store.epoch,
    );
    store.db
      .prepare(
        "INSERT INTO sync_records VALUES('removed',3,NULL,'2026-10-31T00:00:00.000Z',1)",
      )
      .run();
    store.db
      .prepare("UPDATE sync_meta SET value='3' WHERE key='sequence'")
      .run();
    const tenantBefore = rows(store.db, [
      "sync_records",
      "sync_devices",
      "sync_operations",
      "sync_attachments",
      "sync_blobs",
    ]);
    const epoch = store.epoch;
    store.close();
    store = null;
    const ledgerPath = join(directory, "ledger.sqlite");
    legacy = new DatabaseSync(ledgerPath);
    for (const schema of [
      LEDGER_CORE_SCHEMA.slice(0, 1),
      LEDGER_COST_SCHEMA,
      LEDGER_TIME_SCHEMA,
      LEDGER_CHECKPOINT_SCHEMA,
    ])
      for (const m of schema) legacy.exec(m.sql);
    const price = {
      id: "synthetic-legacy",
      model: "synthetic",
      currency: "CNY",
      source: "synthetic contract, not provider pricing",
      verifiedAt: 1,
      inputMicrosPerMillion: 1000000,
      cachedMicrosPerMillion: 100000,
      outputMicrosPerMillion: 2000000,
    };
    legacy
      .prepare("INSERT INTO reading_prices VALUES(?,?)")
      .run(price.id, JSON.stringify(price));
    legacy
      .prepare("INSERT INTO reading_wallets VALUES(?,?,?)")
      .run(first.userId, 20000000, 14);
    const usage = JSON.stringify(
      validateUsage({ prompt_tokens: 10, completion_tokens: 2 }),
    );
    for (const [id, state, actual, u] of [
      ["legacy-paid", "settled", 14, usage],
      ["legacy-unknown", "unknown", null, null],
    ])
      legacy
        .prepare("INSERT INTO reading_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          first.userId,
          "legacy-task",
          id,
          1,
          price.id,
          "2026-10-31",
          state,
          1000,
          actual,
          u,
          "synthetic-" + id,
        );
    for (const [op, kind, call, amount] of [
      ["initial:" + first.userId, "grant", null, 20000000],
      ["reserve:legacy-paid", "reserve", "legacy-paid", 1000],
      ["sent:legacy-paid", "sent", "legacy-paid", 0],
      ["settle:legacy-paid", "settle", "legacy-paid", 14],
      ["reserve:legacy-unknown", "reserve", "legacy-unknown", 1000],
      ["sent:legacy-unknown", "sent", "legacy-unknown", 0],
      ["unknown:legacy-unknown", "unknown", "legacy-unknown", 1000],
    ])
      legacy
        .prepare(
          "INSERT INTO reading_events(operation,kind,account,call,amount,at) VALUES(?,?,?,?,?,?)",
        )
        .run(op, kind, first.userId, call, amount, 1);
    const ledgerBefore = rows(legacy, [
      "reading_prices",
      "reading_wallets",
      "reading_calls",
      "reading_events",
    ]);
    legacy.close();
    legacy = null;
    const schemaReviews = [];
    for (const [path, components] of [
      [
        join(directory, "accounts.sqlite"),
        [
          [
            "accounts-core",
            ACCOUNTS_CORE_SCHEMA,
            {
              compatibleObjects: [
                "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
              ],
            },
          ],
          ["accounts-auth", ACCOUNTS_AUTH_SCHEMA, {}],
        ],
      ],
      [
        tenantPath,
        [
          ["tenant-sync", TENANT_SYNC_SCHEMA, {}],
          ["tenant-attachments", TENANT_ATTACHMENTS_SCHEMA, {}],
          ["tenant-originals", TENANT_ORIGINALS_SCHEMA, {}],
        ],
      ],
      [
        ledgerPath,
        [
          [
            "ledger-core",
            LEDGER_CORE_SCHEMA,
            {
              compatibleObjects: [
                "CREATE INDEX reading_calls_account_task ON reading_calls(account,task)",
              ],
            },
          ],
          ["ledger-cost", LEDGER_COST_SCHEMA, {}],
          ["ledger-time", LEDGER_TIME_SCHEMA, {}],
          ["ledger-checkpoint", LEDGER_CHECKPOINT_SCHEMA, {}],
        ],
      ],
    ]) {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        for (const [component, migrations, options] of components)
          schemaReviews.push(
            reviewDatabaseSchema(db, component, migrations, options),
          );
        assert.equal(
          db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
            )
            .get(),
          undefined,
        );
      } finally {
        db.close();
      }
    }
    let failed = false;
    const upgrade = () => {
      registry = new AccountRegistry(directory, secret);
      new AccountsV4(registry);
      assert.deepEqual(
        rows(registry.db, Object.keys(accountBefore)),
        accountBefore,
      );
      const slots = registry.db
        .prepare("SELECT COUNT(*) n FROM account_device_slots")
        .get().n;
      assert.equal(slots, 2);
      registry.close();
      registry = null;
      if (failAfter === "accounts" && !failed) {
        failed = true;
        throw Error("INJECTED_SCHEMA_STAGE");
      }
      store = new SyncStore(tenantPath);
      createAttachmentStore(store);
      new OriginalStore(store);
      assert.equal(store.epoch, epoch);
      assert.deepEqual(rows(store.db, Object.keys(tenantBefore)), tenantBefore);
      assert.equal(
        store.db.prepare("SELECT state FROM original_files").get().state,
        "legacy_pending_notice",
      );
      store.close();
      store = null;
      if (failAfter === "tenant" && !failed) {
        failed = true;
        throw Error("INJECTED_SCHEMA_STAGE");
      }
      ledger = new ReadingLedger(ledgerPath);
      assert.deepEqual(
        rows(ledger.db, Object.keys(ledgerBefore)),
        ledgerBefore,
      );
      ledger.audit(first.userId);
      assert.equal(ledger.wallet(first.userId).spent, 14);
      assert.equal(ledger.wallet(first.userId).unknownRisk, 1000);
      ledger.grantInitial(first.userId);
      assert.deepEqual(
        rows(ledger.db, Object.keys(ledgerBefore)),
        ledgerBefore,
      );
      ledger.close();
      ledger = null;
      if (failAfter === "ledger" && !failed) {
        failed = true;
        throw Error("INJECTED_SCHEMA_STAGE");
      }
    };
    if (failAfter) assert.throws(upgrade, /INJECTED_SCHEMA_STAGE/);
    upgrade();
    upgrade();
    return {
      kind: "synthetic-runtime-core-schema-rehearsal",
      legacySource: "aad190373781a52454a6875426d46b2cf0c8fcd5",
      failAfter,
      interruptedAndResumed: failed,
      schemaReviews,
      accountsPreserved: true,
      revocationPreserved: true,
      slots: 2,
      tenantDataAndBlobPreserved: true,
      epochAndOperationsPreserved: true,
      removedRecordPreserved: true,
      originalState: "legacy_pending_notice",
      legacySpentMicros: 14,
      unknownRiskMicros: 1000,
      initialGrantMicros: 20000000,
      noDuplicateGrants: true,
      repeatedStartupPreserved: true,
      boundaries: [
        "Core component schemas only; not all legacy job/state conversion",
        "No production or caller-provided directory",
        "No shadow-set switch or global safety replay",
        "No live API or final B/C/D acceptance",
      ],
    };
  } finally {
    ledger?.close();
    legacy?.close();
    store?.close();
    registry?.close();
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith("shixu-runtime-schema-")
    )
      throw Error("UNSAFE_SYNTHETIC_CLEANUP");
    rmSync(directory, { recursive: true, force: true });
  }
}
