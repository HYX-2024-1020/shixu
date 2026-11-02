import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureDatabaseSchema } from "./database-schema.mjs";
import { ACCOUNTS_CORE_SCHEMA } from "./database-schemas.mjs";
import { AccountRegistry } from "./sync-accounts.mjs";
import { AccountsV4 } from "./accounts-v4.mjs";
import { SyncStore } from "./sync-store.mjs";
import { createAttachmentStore } from "./sync-files.mjs";
import { createJobQueue } from "./sync-jobs.mjs";
import { OriginalStore } from "./originals.mjs";
import { ReadingTasks } from "./reading/tasks.mjs";

// Host-only offline schema/data migrator for prepareShadowVersion. No network,
// provider credentials, scheduling or wallet grants. Every connection closes
// before the version manifest is sealed; independent safety/fees stay external.
export function createRuntimeMigrator({
  secret,
  ledger,
  priceId,
  modelVersion,
  credentials = true,
}) {
  if (
    !ledger ||
    typeof secret !== "string" ||
    !modelVersion ||
    typeof credentials !== "boolean"
  )
    throw Error("MIGRATION_CONFIGURATION_REQUIRED");
  ledger.price(priceId);
  const never = () => {
    throw Error("MIGRATION_CANNOT_EXECUTE_WORK");
  };
  return ({ directory, path, kind }) => {
    if (kind === "registry") {
      if (
        basename(dirname(directory)) !== "data-versions" ||
        resolve(path) !== resolve(join(directory, "accounts.sqlite"))
      )
        throw Error("MIGRATION_SHADOW_REQUIRED");
      const db = new DatabaseSync(path);
      try {
        ensureDatabaseSchema(db, "accounts-core", ACCOUNTS_CORE_SCHEMA, {
          compatibleObjects: [
            "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
          ],
        });
        db.prepare("DELETE FROM account_meta WHERE key=?").run(
          "data_version_required",
        );
      } finally {
        db.close();
      }
      const registry = new AccountRegistry(directory, secret);
      try {
        if (credentials) new AccountsV4(registry).close();
      } finally {
        registry.close();
      }
      return;
    }
    if (kind !== "tenant") throw Error("INVALID_MIGRATION_MEMBER");
    const account = basename(dirname(path));
    if (!/^[a-f0-9-]{36}$/.test(account))
      throw Error("INVALID_MIGRATION_ACCOUNT");
    const store = new SyncStore(path);
    let jobs, tasks;
    try {
      createAttachmentStore(store);
      jobs = createJobQueue(store, null, {}, { archiveLegacy: true });
      new OriginalStore(store, store.meta('tenant_safety') ? { safety: { ledger, account } } : {});
      tasks = new ReadingTasks({
        store,
        account,
        ledger,
        priceId,
        modelVersion,
        reader: never,
        provider: never,
        authorize: never,
      });
    } finally {
      tasks?.close();
      jobs?.stop();
      store.originals?.close();
      store.close();
    }
  };
}
