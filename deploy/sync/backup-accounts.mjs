import { backup, DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readdir, lstat, writeFile } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

export async function backupAccounts(
  source,
  destination,
  { serviceStopped = false } = {},
) {
  if (!serviceStopped)
    throw Error(
      "Stop the account service before taking a cross-database snapshot",
    );
  process.umask(0o077);
  const root = resolve(source),
    files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if ((await lstat(file)).isSymbolicLink())
        throw Error("Refusing a symlink in account data");
      if (entry.isDirectory()) await collect(file);
      else if (entry.isFile() && entry.name.endsWith(".sqlite"))
        files.push(file);
    }
  }
  await collect(root);
  await mkdir(resolve(destination), { recursive: true, mode: 0o700 });
  const target = await mkdtemp(
    join(resolve(destination), "accounts-snapshot-"),
  );
  for (const file of files) {
    const output = join(target, relative(root, file));
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      await backup(db, output);
    } finally {
      db.close();
    }
    const check = new DatabaseSync(output, { readOnly: true });
    try {
      if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw Error("Snapshot integrity check failed");
    } finally {
      check.close();
    }
  }
  await writeFile(
    join(target, "backup.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        scope: "stopped-account-registry-and-user-databases",
        databases: files.length,
        integrity: "ok",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return target;
}
if (
  process.argv[1] &&
  [resolve(process.argv[1]), realpathSync(process.argv[1])].some(
    (path) => import.meta.url === pathToFileURL(path).href,
  )
) {
  if (process.argv.length !== 5 || process.argv[4] !== "--service-stopped")
    throw Error(
      "Usage: backup-accounts.mjs DATA_DIRECTORY BACKUP_DIRECTORY --service-stopped",
    );
  console.log(
    await backupAccounts(process.argv[2], process.argv[3], {
      serviceStopped: true,
    }),
  );
}
