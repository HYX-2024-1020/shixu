import { basename, dirname } from "node:path";
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
      new OriginalStore(store);
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
