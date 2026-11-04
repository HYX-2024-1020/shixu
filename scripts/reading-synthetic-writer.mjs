// Test-only fault injection through a fully schema-verified current writer.
// No HTTP route, production bypass switch or constant-return capability function.
import { join, resolve } from "node:path";
import { SyncStore } from "../server/sync-store.mjs";
import { ensureDatabaseSchema } from "../server/database-schema.mjs";
import {
  READING_TASKS_SCHEMA,
  READING_ROOTS_SCHEMA,
  READING_WINDOWS_SCHEMA,
} from "../server/database-schemas.mjs";
const owned = new WeakMap();
export function registerSyntheticTenantWriter(service, directory) {
  owned.set(service, resolve(directory));
}
export function openSyntheticTenantWriter(service, account) {
  const directory = owned.get(service);
  if (
    !directory ||
    typeof account !== "string" ||
    !/^[-\w]{1,90}$/.test(account)
  )
    throw Error("SYNTHETIC_FIXTURE_REQUIRED");
  const store = new SyncStore(
    join(directory, "server", "users", account, "workspace.sqlite"),
  );
  try {
    ensureDatabaseSchema(store.db, "tenant-reading", READING_TASKS_SCHEMA, {
      compatibleObjects: [
        "CREATE INDEX reading_tasks_packet ON reading_tasks(packet)",
      ],
    });
    ensureDatabaseSchema(store.db, "tenant-roots", READING_ROOTS_SCHEMA);
    ensureDatabaseSchema(store.db, "tenant-windows", READING_WINDOWS_SCHEMA);
    return store.db;
  } catch (error) {
    store.close();
    throw error;
  }
}
