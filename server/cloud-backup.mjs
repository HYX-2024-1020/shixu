import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  rmSync,
  openSync,
  fsyncSync,
  closeSync,
  statfsSync,
  unlinkSync,
  readSync,
} from "node:fs";
import { join, dirname, relative, isAbsolute } from "node:path";
import {
  acquireDataLease,
  resolveDataVersion,
  prepareShadowVersion,
  activateDataVersion,
  readingAuthorityFloor,
  purgeRetiredData,
  purgeAbandonedShadows,
  reviewDataWriters,
  recoverDataWriters,
  completeDataActivation,
} from "./data-versions.mjs";
import { ReadingLedger } from "./reading/ledger.mjs";
import { ReadingRootSafety } from "./reading/root-safety.mjs";
import { AccountRegistry } from "./sync-accounts.mjs";
import { AccountsV4 } from "./accounts-v4.mjs";
import { AccountSafety } from "./account-safety.mjs";
import { createRuntimeMigrator } from "./data-migration.mjs";
import { SyncStore } from "./sync-store.mjs";
import { createAttachmentStore } from "./sync-files.mjs";
import { createJobQueue } from "./sync-jobs.mjs";
import { OriginalStore } from "./originals.mjs";
import { ReadingTasks } from "./reading/tasks.mjs";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const snapshotId = /^snapshot-[a-f0-9-]{36}$/;
const hash = (path) => {
  const value = createHash("sha256"),
    fd = openSync(path, "r"),
    buffer = Buffer.allocUnsafe(1048576);
  try {
    let n;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)))
      value.update(buffer.subarray(0, n));
    return value.digest("hex");
  } finally {
    closeSync(fd);
  }
};
const inside = (root, path) => {
  const p = relative(root, path);
  return p !== "" && !p.startsWith("..") && !isAbsolute(p);
};
function regular(path, root) {
  if (
    lstatSync(path).isSymbolicLink() ||
    !lstatSync(path).isFile() ||
    lstatSync(path).nlink !== 1 ||
    !inside(realpathSync(root), realpathSync(path))
  )
    throw Error("BACKUP_PATH_REJECTED");
}
function durable(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function syncDir(path) {
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function checkDatabase(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode=DELETE");
    if (
      db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw Error("BACKUP_INTEGRITY_FAILED");
  } finally {
    db.close();
  }
}
function members(directory) {
  // Exclusive offline callers may checkpoint the trusted registry so read-only
  // metadata inspection does not leave WAL sidecars in a supposedly closed set.
  const files = ["accounts.sqlite"],
    db = new DatabaseSync(join(directory, "accounts.sqlite"));
  try {
    const known = new Set(
      db
        .prepare("SELECT id FROM accounts")
        .all()
        .map((r) => r.id),
    );
    if (existsSync(join(directory, "users")))
      for (const id of readdirSync(join(directory, "users"))) {
        if (
          !uuid.test(id) ||
          !known.has(id) ||
          lstatSync(join(directory, "users", id)).isSymbolicLink()
        )
          throw Error("BACKUP_TENANT_SET_REJECTED");
        const path = "users/" + id + "/workspace.sqlite";
        regular(join(directory, path), directory);
        files.push(path);
      }
  } finally {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  }
  return files;
}
function openAuthorities(config, selected) {
  const ledger = new ReadingLedger(config.ledgerPath);
  try {
    new ReadingRootSafety(ledger, "system:backup");
    ledger.audit();
    const registry = new AccountRegistry(selected.directory, config.secret);
    try {
      const credentials = new AccountsV4(registry);
      new AccountSafety(registry, ledger);
      registry.safety.assert();
      credentials.close();
    } finally {
      registry.close();
    }
    return ledger;
  } catch (e) {
    ledger.close();
    throw e;
  }
}
export function verifyCloudSnapshot(
  backupRoot,
  id,
  { now = Date.now(), allowExpired = false, verifyHashes = true } = {},
) {
  if (!snapshotId.test(id)) throw Error("INVALID_SNAPSHOT");
  const root = realpathSync(backupRoot),
    directory = join(root, id);
  if (
    lstatSync(directory).isSymbolicLink() ||
    !inside(root, realpathSync(directory))
  )
    throw Error("BACKUP_PATH_REJECTED");
  regular(join(directory, "manifest.json"), root);
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== 1 ||
    manifest.id !== id ||
    !Number.isSafeInteger(manifest.createdAt) ||
    manifest.expiresAt !== manifest.createdAt + 7 * 86400000 ||
    (!allowExpired && manifest.expiresAt <= now) ||
    !Array.isArray(manifest.files)
  )
    throw Error("BACKUP_MANIFEST_REJECTED");
  const seen = new Set();
  for (const file of manifest.files) {
    if (
      !/^(?:accounts\.sqlite|users\/[a-f0-9-]{36}\/workspace\.sqlite|authority\/(?:ledger|operations)\.sqlite)$/.test(
        file.path,
      ) ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw Error("BACKUP_MANIFEST_REJECTED");
    seen.add(file.path);
    regular(join(directory, file.path), directory);
    if (
      verifyHashes &&
      (lstatSync(join(directory, file.path)).size !== file.bytes ||
        hash(join(directory, file.path)) !== file.sha256)
    )
      throw Error("BACKUP_HASH_MISMATCH");
  }
  if (
    ![
      "accounts.sqlite",
      "authority/ledger.sqlite",
      "authority/operations.sqlite",
    ].every((p) => seen.has(p))
  )
    throw Error("BACKUP_MANIFEST_REJECTED");
  return { directory, manifest };
}
export function listCloudSnapshots(
  root,
  { now = Date.now(), verifyHashes = true } = {},
) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((id) => snapshotId.test(id))
    .map((id) => {
      try {
        const { manifest } = verifyCloudSnapshot(root, id, {
          now,
          allowExpired: true,
          verifyHashes,
        });
        return {
          id,
          createdAt: new Date(manifest.createdAt).toISOString(),
          expiresAt: new Date(manifest.expiresAt).toISOString(),
          available: manifest.expiresAt > now,
          databases: manifest.files.length,
          bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
          verification: verifyHashes
            ? "current-hashes"
            : "creation-verified-recheck-before-restore",
        };
      } catch {
        try {
          const { manifest } = verifyCloudSnapshot(root, id, {
            now,
            allowExpired: true,
            verifyHashes: false,
          });
          return {
            id,
            available: false,
            code: "BACKUP_VERIFICATION_FAILED",
            createdAt: new Date(manifest.createdAt).toISOString(),
            expiresAt: new Date(manifest.expiresAt).toISOString(),
          };
        } catch {
          return { id, available: false, code: "BACKUP_VERIFICATION_FAILED" };
        }
      }
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
export function rotateCloudSnapshots(root, { now = Date.now() } = {}) {
  if (existsSync(root))
    for (const id of readdirSync(root).filter((id) =>
      /^\.partial-snapshot-[a-f0-9-]{36}$/.test(id),
    )) {
      const path = join(root, id),
        descriptor = join(path, ".partial.json");
      if (
        lstatSync(path).isSymbolicLink() ||
        !inside(realpathSync(root), realpathSync(path))
      )
        throw Error("BACKUP_PATH_REJECTED");
      if (!existsSync(descriptor))
        throw Error("PARTIAL_BACKUP_REVIEW_REQUIRED");
      regular(descriptor, path);
      const info = JSON.parse(readFileSync(descriptor, "utf8"));
      if (info.id !== id || !Number.isSafeInteger(info.expiresAt))
        throw Error("PARTIAL_BACKUP_REVIEW_REQUIRED");
      if (info.expiresAt <= now) removePartial(root, path, info.files);
    }
  const rows = listCloudSnapshots(root, { now, verifyHashes: false });
  // Keep the most recent checksum-valid snapshot even beyond its normal TTL.
  // Expiry must never leave a host without its final known recovery copy.
  let lastGood = null;
  for (const row of rows) {
    try {
      verifyCloudSnapshot(root, row.id, { now, allowExpired: true });
      lastGood = row.id;
      break;
    } catch {}
  }
  let kept = 0;
  for (const row of rows) {
    if (row.available && kept++ < 2) continue;
    if (row.id === lastGood) continue;
    if (row.code && (!row.expiresAt || Date.parse(row.expiresAt) > now))
      continue;
    const { directory, manifest } = verifyCloudSnapshot(root, row.id, {
      now,
      allowExpired: true,
      verifyHashes: false,
    });
    const allowed = new Set([
      "manifest.json",
      ...manifest.files.map((f) => f.path),
    ]);
    function inspect(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name),
          name = relative(directory, path).replaceAll("\\", "/");
        if (e.isSymbolicLink()) throw Error("BACKUP_PATH_REJECTED");
        if (e.isDirectory()) {
          if (![...allowed].some((p) => p.startsWith(name + "/")))
            throw Error("BACKUP_PATH_REJECTED");
          inspect(path);
        } else if (!allowed.has(name)) throw Error("BACKUP_PATH_REJECTED");
      }
    }
    inspect(directory);
    if (!inside(realpathSync(root), realpathSync(directory)))
      throw Error("BACKUP_PATH_REJECTED");
    rmSync(directory, { recursive: true });
  }
}
function removePartial(root, path, files) {
  if (
    !Array.isArray(files) ||
    files.some(
      (f) =>
        !/^(?:accounts\.sqlite|users\/[a-f0-9-]{36}\/workspace\.sqlite|authority\/(?:ledger|operations)\.sqlite)$/.test(
          f,
        ),
    )
  )
    throw Error("PARTIAL_BACKUP_REVIEW_REQUIRED");
  const allowed = new Set([
    ".partial.json",
    "manifest.json",
    ...files.flatMap((f) => [f, f + "-wal", f + "-shm"]),
  ]);
  function inspect(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, e.name),
        name = relative(path, file).replaceAll("\\", "/");
      if (e.isSymbolicLink()) throw Error("BACKUP_PATH_REJECTED");
      if (e.isDirectory()) {
        if (![...allowed].some((p) => p.startsWith(name + "/")))
          throw Error("BACKUP_PATH_REJECTED");
        inspect(file);
      } else if (!allowed.has(name)) throw Error("BACKUP_PATH_REJECTED");
    }
  }
  inspect(path);
  if (!inside(realpathSync(root), realpathSync(path)))
    throw Error("BACKUP_PATH_REJECTED");
  rmSync(path, { recursive: true });
}
export async function takeCloudSnapshot(config, { now = Date.now() } = {}) {
  const lease = acquireDataLease(config.directory, "maintenance");
  let ledger, partial, partialFiles;
  try {
    const selected = resolveDataVersion(lease, {
      ledgerPath: config.ledgerPath,
    });
    ledger = openAuthorities(config, selected);
    const files = members(selected.directory).map((path) => ({
      path,
      source: join(selected.directory, path),
    }));
    files.push(
      { path: "authority/ledger.sqlite", source: config.ledgerPath },
      { path: "authority/operations.sqlite", source: config.operationsPath },
    );
    mkdirSync(config.backupRoot, { recursive: true, mode: 0o700 });
    if (lstatSync(config.backupRoot).isSymbolicLink())
      throw Error("BACKUP_PATH_REJECTED");
    const space = statfsSync(config.backupRoot),
      bytes = files.reduce((n, f) => n + lstatSync(f.source).size, 0);
    if (space.bavail * space.bsize < bytes * 2)
      throw Error("BACKUP_SPACE_REQUIRED");
    const id = "snapshot-" + randomUUID(),
      target = join(config.backupRoot, id);
    partial = join(config.backupRoot, ".partial-" + id);
    partialFiles = files.map((f) => f.path);
    mkdirSync(partial, { mode: 0o700 });
    const result = [];
    durable(join(partial, ".partial.json"), {
      id: ".partial-" + id,
      expiresAt: now + 300000,
      files: partialFiles,
    });
    for (const file of files) {
      const output = join(partial, file.path);
      mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(file.source, { readOnly: true });
      try {
        await backup(db, output);
      } finally {
        db.close();
      }
      checkDatabase(output);
      result.push({
        path: file.path,
        bytes: lstatSync(output).size,
        sha256: hash(output),
      });
      const fd = openSync(output, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (Date.now() - (config.startedAt || Date.now()) > 270000)
        throw Error("BACKUP_TIMEOUT");
    }
    const manifest = {
      version: 1,
      id,
      createdAt: now,
      expiresAt: now + 7 * 86400000,
      files: result,
      authorityFloor: readingAuthorityFloor(config.ledgerPath),
      sourceVersion: selected.version,
    };
    durable(join(partial, "manifest.json"), manifest);
    unlinkSync(join(partial, ".partial.json"));
    syncDir(partial);
    renameSync(partial, target);
    partial = null;
    syncDir(config.backupRoot);
    verifyCloudSnapshot(config.backupRoot, id, { now });
    rotateCloudSnapshots(config.backupRoot, { now });
    return {
      id,
      databases: result.length,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(manifest.expiresAt).toISOString(),
    };
  } catch (e) {
    if (partial && existsSync(partial))
      removePartial(config.backupRoot, partial, partialFiles);
    throw e;
  } finally {
    ledger?.close();
    lease.release();
  }
}
export function restoreCloudSnapshot(config, id, { now = Date.now() } = {}) {
  const snapshot = verifyCloudSnapshot(config.backupRoot, id, { now });
  // Validate the host-held current floor and the snapshot prefix against the
  // LIVE independent authority. The historical authority copies are not restored.
  if (!Array.isArray(config.authorityFloor))
    throw Error("CURRENT_AUTHORITY_FLOOR_REQUIRED");
  readingAuthorityFloor(config.ledgerPath, config.authorityFloor);
  readingAuthorityFloor(config.ledgerPath, snapshot.manifest.authorityFloor);
  const lease = acquireDataLease(config.directory, "maintenance");
  let ledger;
  try {
    const selected = resolveDataVersion(lease, {
      ledgerPath: config.ledgerPath,
    });
    ledger = openAuthorities(config, selected);
    const price = ledger.db
      .prepare("SELECT body FROM reading_prices ORDER BY id LIMIT 1")
      .get();
    if (!price) throw Error("PRICE_REQUIRED");
    const p = JSON.parse(price.body),
      migrate = createRuntimeMigrator({
        secret: config.secret,
        ledger,
        priceId: p.id,
        modelVersion: p.model,
      });
    const known = new Set(members(selected.directory));
    for (const f of snapshot.manifest.files.filter((f) =>
      f.path.startsWith("users/"),
    ))
      if (!known.has(f.path)) throw Error("RESTORE_TENANT_SET_REQUIRES_REVIEW");
    const prepared = prepareShadowVersion(lease, {
      id: "restore-" + randomUUID(),
      ledgerPath: config.ledgerPath,
      now,
      migrate(args) {
        if (args.kind === "tenant") {
          const member = relative(args.directory, args.path).replaceAll(
            "\\",
            "/",
          );
          if (snapshot.manifest.files.some((f) => f.path === member))
            copyFileSync(join(snapshot.directory, member), args.path);
        }
        // Current registry, independent safety, fee ledger and audit always win.
        migrate(args);
      },
    });
    const pointer = activateDataVersion(lease, prepared, {
      expectedVersion: selected.version,
      now,
    });
    return {
      snapshotId: id,
      dataVersion: pointer.id,
      tenants: prepared.tenants,
    };
  } finally {
    ledger?.close();
    lease.release();
  }
}

// Called only by the stopped-service host executor after an interrupted job.
// Kernel identity proof recovers ownership, never time, cost or task progress.
export function recoverCloudMaintenance(config, operationId) {
  if (!Array.isArray(config.authorityFloor))
    throw Error("CURRENT_AUTHORITY_FLOOR_REQUIRED");
  readingAuthorityFloor(config.ledgerPath, config.authorityFloor);
  const actor = "cloud-operations",
    authorize = () => true,
    review = reviewDataWriters(config.directory, actor, authorize);
  if (review.pendingRecoveries.length) {
    if (review.pendingRecoveries.length !== 1)
      throw Error("DATA_RECOVERY_REQUIRES_REVIEW");
    const pending = review.pendingRecoveries[0];
    recoverDataWriters(
      config.directory,
      {
        operationId: pending.operation,
        expectedSnapshotHash: pending.snapshot_hash,
        actor: pending.actor,
      },
      authorize,
    );
  } else if (review.registrations.length) {
    if (!review.allTerminated) throw Error("DATA_WRITERS_ACTIVE");
    recoverDataWriters(
      config.directory,
      { operationId, expectedSnapshotHash: review.snapshotHash, actor },
      authorize,
    );
  }
  const lease = acquireDataLease(config.directory, "maintenance");
  try {
    if (existsSync(join(config.directory, "data-version.json")))
      completeDataActivation(lease);
    return {
      registrationsRecovered: review.registrations.length,
      independentAuthorityPreserved: true,
    };
  } finally {
    lease.release();
  }
}
export function cleanCloudStorage(config, { now = Date.now() } = {}) {
  const lease = acquireDataLease(config.directory, "maintenance");
  let ledger;
  try {
    const selected = resolveDataVersion(lease, {
      ledgerPath: config.ledgerPath,
    });
    ledger = openAuthorities(config, selected);
    const price = JSON.parse(
      ledger.db
        .prepare("SELECT body FROM reading_prices ORDER BY id LIMIT 1")
        .get().body,
    );
    let count = 0,
      freed = 0;
    for (const member of members(selected.directory).filter((p) =>
      p.startsWith("users/"),
    )) {
      const path = join(selected.directory, member),
        account = member.split("/")[1],
        store = new SyncStore(path);
      let jobs, originals, tasks;
      const before = lstatSync(path).size;
      try {
        createAttachmentStore(store);
        jobs = createJobQueue(store, null, {}, { archiveLegacy: true });
        originals = new OriginalStore(store, {
          safety: { ledger, account },
          now: () => now,
        });
        tasks = new ReadingTasks({
          store,
          account,
          ledger,
          priceId: price.id,
          modelVersion: price.model,
          reader() {
            throw Error("OFFLINE");
          },
          provider() {
            throw Error("OFFLINE");
          },
          authorize() {
            throw Error("OFFLINE");
          },
        });
        tasks.close();
        originals.sweep();
        const space = statfsSync(dirname(path));
        if (store.db.prepare("PRAGMA auto_vacuum").get().auto_vacuum !== 2) {
          if (space.bavail * space.bsize < lstatSync(path).size * 2)
            throw Error("VACUUM_SPACE_REQUIRED");
          store.db.exec("PRAGMA auto_vacuum=INCREMENTAL; VACUUM;");
        } else store.db.exec("PRAGMA incremental_vacuum(1024)");
        store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        count++;
      } finally {
        tasks?.close();
        jobs?.stop();
        originals?.close();
        store.close();
      }
      freed += Math.max(0, before - lstatSync(path).size);
    }
    rotateCloudSnapshots(config.backupRoot, { now });
    const request = {
      operationId: "cleanup-" + randomUUID(),
      actor: "cloud-operations",
    };
    if (selected.version) purgeRetiredData(lease, request, () => true);
    purgeAbandonedShadows(lease, request, () => true);
    return { tenants: count, physicalBytesReclaimed: freed };
  } finally {
    ledger?.close();
    lease.release();
  }
}
