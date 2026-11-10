// Manufacture an unversioned legacy tenant baseline in a new synthetic file.
// Never remove migration receipts or protections from an upgraded database.
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { SyncStore as LegacyStore } from "../../scripts/stage-a/legacy/sync-store.mjs";
import { createAttachmentStore as legacyFiles } from "../../scripts/stage-a/legacy/sync-files.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import {
  READING_TASKS_SCHEMA,
  READING_ROOTS_SCHEMA,
  READING_REUSE_SCHEMA,
  READING_WINDOWS_SCHEMA,
  READING_CHAT_REQUESTS_SCHEMA,
  READING_VISUAL_RESULTS_SCHEMA,
  READING_MERGE_RESULTS_SCHEMA,
  READING_ASSOCIATION_RESULTS_SCHEMA,
} from "../database-schemas.mjs";
export function manufactureLegacyTaskTenant(f, { includeRoots = false } = {}) {
  if (
    dirname(resolve(f.directory)) !== resolve(tmpdir()) ||
    !["shixu-reading-task-", "shixu-merge-"].some((p) =>
      basename(f.directory).startsWith(p),
    )
  )
    throw Error("SYNTHETIC_FIXTURE_REQUIRED");
  const path = join(f.directory, "legacy-task-tenant.sqlite");
  if (existsSync(path)) throw Error("SYNTHETIC_TARGET_EXISTS");
  const legacy = new LegacyStore(path);
  legacyFiles(legacy);
  for (const schema of [
    READING_TASKS_SCHEMA,
    READING_REUSE_SCHEMA,
    READING_WINDOWS_SCHEMA,
    READING_CHAT_REQUESTS_SCHEMA,
    READING_VISUAL_RESULTS_SCHEMA,
    READING_MERGE_RESULTS_SCHEMA,
    READING_ASSOCIATION_RESULTS_SCHEMA,
    ...(includeRoots ? [READING_ROOTS_SCHEMA] : []),
  ])
    legacy.db.exec(schema[0].sql);
  legacy.db.exec("DELETE FROM sync_meta");
  try {
    const order = [
      "sync_meta",
      "sync_records",
      "sync_devices",
      "sync_operations",
      "sync_blobs",
      "sync_attachments",
    ];
    const projections = legacy.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sync_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    for (const table of [...order, ...projections]) {
      const names = legacy.db
          .prepare("PRAGMA table_info(" + table + ")")
          .all()
          .map((r) => r.name),
        insert = legacy.db.prepare(
          "INSERT INTO " +
            table +
            "(" +
            names.join(",") +
            ") VALUES(" +
            names.map(() => "?").join(",") +
            ")",
        );
      for (const row of f.store.db
        .prepare("SELECT * FROM " + table + " ORDER BY rowid")
        .iterate())
        insert.run(...names.map((n) => row[n]));
    }
  } finally {
    legacy.close();
  }
  const store = new SyncStore(path);
  createAttachmentStore(store);
  return store;
}
