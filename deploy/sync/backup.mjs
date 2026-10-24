import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

// SQLite's backup API includes committed WAL data while the service stays online.
// Each run owns a new directory; it never overwrites an earlier backup.
export async function backupDatabase(source, destination) {
  process.umask(0o077);
  const db = new DatabaseSync(resolve(source), { readOnly: true, timeout: 5000 });
  try {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(resolve(destination), "snapshot-"));
    const file = join(directory, "workspace.sqlite");
    await backup(db, file);
    const restored = new DatabaseSync(file, { readOnly: true });
    try {
      const check = restored.prepare("PRAGMA quick_check").get().quick_check;
      if (check !== "ok") throw new Error("Backup integrity check failed");
      const meta = Object.fromEntries(
        restored.prepare("SELECT key,value FROM sync_meta").all().map(({ key, value }) => [key, value]),
      );
      await writeFile(join(directory, "backup.json"), JSON.stringify({
        createdAt: new Date().toISOString(), schema: meta.schema,
        epoch: meta.epoch, sequence: meta.sequence, integrity: check,
        scope: restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_blobs'").get() ? "sync-v2-database-including-originals" : "sync-v2-text-database-only",
      }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    } finally {
      restored.close();
    }
    return directory;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error("Usage: node backup.mjs SOURCE_DB BACKUP_DIRECTORY");
  console.log(await backupDatabase(process.argv[2], process.argv[3]));
}
