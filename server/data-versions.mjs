import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { ensureDatabaseSchema } from "./database-schema.mjs";
import { ACCOUNTS_CORE_SCHEMA } from "./database-schemas.mjs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import {
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  writeFileSync,
  readFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  existsSync,
  lstatSync,
  readdirSync,
  copyFileSync,
  realpathSync,
  statfsSync,
} from "node:fs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const accountId = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const versionId = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,70}$/.test(value);
const fail = () => {
  throw Error("DATA_VERSION_RECONCILIATION");
};
const parse = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail();
  }
};
function regular(path, directory = false) {
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    (!directory && stat.nlink !== 1) ||
    !(directory ? stat.isDirectory() : stat.isFile())
  )
    fail();
}
function inside(root, path) {
  const r = relative(root, path);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
}
function syncDirectory(path) {
  // Linux directory fsync provides rename durability. Windows cannot open a
  // directory fd this way; its tests cover atomic replacement, not power loss.
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function durable(path, value) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(path));
}
function fileHash(path) {
  regular(path);
  const fd = openSync(path, "r"),
    hash = createHash("sha256"),
    buffer = Buffer.allocUnsafe(65536);
  try {
    for (;;) {
      const n = readSync(fd, buffer);
      if (!n) break;
      hash.update(buffer.subarray(0, n));
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
function fenceLegacyRoot(root) {
  const path = join(root, "accounts.sqlite");
  if (!existsSync(path)) return;
  regular(path);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA synchronous=FULL;BEGIN IMMEDIATE");
    ensureDatabaseSchema(db, "accounts-core", ACCOUNTS_CORE_SCHEMA, {
      compatibleObjects: [
        "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
      ],
    });
    db.prepare(
      "INSERT OR IGNORE INTO account_meta VALUES('data_version_required','1')",
    ).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
const held = new WeakSet();
// Shared writer registrations plus an exclusive maintenance intent. Recheck
// after registering closes the race with the exclusive holder. Stale leases
// fail closed; PID probing or age never grants permission to steal a lease.
export function acquireDataLease(directory, mode = "writer") {
  if (!["writer", "runtime", "maintenance"].includes(mode))
    throw Error("INVALID_DATA_LEASE");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  regular(directory, true);
  const root = realpathSync(directory),
    writers = join(root, ".data-writers"),
    lock = join(root, ".data-maintenance");
  const leaseToken = randomUUID();
  mkdirSync(writers, { recursive: true, mode: 0o700 });
  regular(writers, true);
  let path;
  if (mode === "maintenance") {
    path = lock;
    try {
      durable(path, { version: 1, token: leaseToken, pid: process.pid });
    } catch (error) {
      if (error.code === "EEXIST") throw Error("DATA_WRITERS_ACTIVE");
      throw error;
    }
    if (readdirSync(writers).length) {
      unlinkSync(lock);
      syncDirectory(root);
      throw Error("DATA_WRITERS_ACTIVE");
    }
  } else {
    if (existsSync(lock)) throw Error("DATA_MAINTENANCE");
    path = join(
      writers,
      mode === "runtime" ? "runtime.json" : randomUUID() + ".json",
    );
    try {
      durable(path, { version: 1, token: leaseToken, pid: process.pid });
    } catch (error) {
      if (error.code === "EEXIST") throw Error("DATA_WRITERS_ACTIVE");
      throw error;
    }
    if (existsSync(lock)) {
      unlinkSync(path);
      syncDirectory(writers);
      throw Error("DATA_MAINTENANCE");
    }
  }
  const lease = {
    root,
    mode,
    release() {
      if (held.has(lease)) {
        regular(path);
        if (parse(path).token !== leaseToken)
          throw Error("DATA_LEASE_OWNERSHIP");
        unlinkSync(path);
        syncDirectory(dirname(path));
        held.delete(lease);
      }
    },
  };
  held.add(lease);
  return lease;
}
function exclusive(lease) {
  if (!held.has(lease) || lease.mode !== "maintenance")
    throw Error("DATA_MAINTENANCE_REQUIRED");
}

function database(path, { versioned = false } = {}) {
  regular(path);
  if (existsSync(path + "-wal") || existsSync(path + "-shm"))
    throw Error("DATA_DATABASE_NOT_CLOSED");
  const db = new DatabaseSync(
    pathToFileURL(path).href + "?mode=ro&immutable=1",
    { readOnly: true },
  );
  try {
    if (
      db
        .prepare("PRAGMA integrity_check")
        .all()
        .some((row) => row.integrity_check !== "ok") ||
      db.prepare("PRAGMA foreign_key_check").get()
    )
      fail();
    const schemas = db
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const versions = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='service_schema_versions'",
      )
      .get()
      ? db
          .prepare(
            "SELECT component,version,checksum FROM service_schema_versions ORDER BY component,version",
          )
          .all()
      : [];
    if (versioned) {
      if (!versions.length) throw Error("TARGET_SCHEMA_REQUIRED");
      for (const table of db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='service_schema_versions'",
        )
        .iterate())
        if (
          db
            .prepare(
              "SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND name LIKE 'service_guard_%'",
            )
            .get(table.name).n !== 3
        )
          throw Error("TARGET_SCHEMA_REQUIRED");
    }
    return {
      hash: fileHash(path),
      bytes: lstatSync(path).size,
      schemaHash: digest(JSON.stringify(schemas)),
      versions,
    };
  } finally {
    db.close();
  }
}
function inventory(directory) {
  const registry = join(directory, "accounts.sqlite");
  database(registry);
  const db = new DatabaseSync(
    pathToFileURL(registry).href + "?mode=ro&immutable=1",
    { readOnly: true },
  );
  let accounts;
  try {
    accounts = db
      .prepare("SELECT id FROM accounts ORDER BY id")
      .all()
      .map((r) => r.id);
  } finally {
    db.close();
  }
  if (accounts.some((id) => !accountId(id))) fail();
  const users = join(directory, "users"),
    tenants = [];
  if (existsSync(users)) {
    regular(users, true);
    for (const name of readdirSync(users).sort()) {
      if (!accounts.includes(name)) fail();
      regular(join(users, name), true);
      const files = readdirSync(join(users, name));
      if (
        files.some((f) =>
          ["workspace.sqlite-wal", "workspace.sqlite-shm"].includes(f),
        )
      )
        throw Error("DATA_DATABASE_NOT_CLOSED");
      if (files.some((f) => f !== "workspace.sqlite")) fail();
      if (files.length) tenants.push(name);
    }
  }
  return { accounts, tenants };
}
function prefix(db, table, limit = Number.MAX_SAFE_INTEGER) {
  const hash = createHash("sha256");
  hash.update("[");
  let sequence = 0,
    separator = "";
  for (const row of db
    .prepare("SELECT * FROM " + table + " WHERE seq<=? ORDER BY seq")
    .iterate(limit)) {
    hash.update(separator);
    hash.update(JSON.stringify(row));
    separator = ",";
    sequence = row.seq;
  }
  hash.update("]");
  return { sequence, prefixHash: hash.digest("hex") };
}
function authority(path, table) {
  regular(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      path: realpathSync(path),
      table,
      ...prefix(db, table),
    };
  } finally {
    db.close();
  }
}
function checkAuthority(proof) {
  if (
    !proof ||
    !["reading_events", "reading_safe_events"].includes(proof.table) ||
    !Number.isSafeInteger(proof.sequence) ||
    proof.sequence < 0
  )
    fail();
  regular(proof.path);
  const db = new DatabaseSync(proof.path, { readOnly: true });
  try {
    const checked = prefix(db, proof.table, proof.sequence);
    if (
      checked.sequence !== proof.sequence ||
      checked.prefixHash !== proof.prefixHash
    )
      fail();
  } finally {
    db.close();
  }
}
function paths(root, id) {
  if (!versionId(id)) fail();
  const parent = join(root, "data-versions");
  regular(parent, true);
  const directory = join(parent, id);
  regular(directory, true);
  return { directory, manifest: join(directory, "manifest.json") };
}
function readPointer(root) {
  const path = join(root, "data-version.json");
  if (!existsSync(path)) {
    if (
      existsSync(join(root, ".data-version-required")) ||
      (existsSync(join(root, "data-version-commits")) &&
        readdirSync(join(root, "data-version-commits")).length)
    )
      fail();
    return null;
  }
  regular(path);
  const pointer = parse(path);
  if (
    pointer.version !== 1 ||
    !versionId(pointer.id) ||
    !/^[a-f0-9]{64}$/.test(pointer.manifestHash)
  )
    fail();
  return pointer;
}
function manifestFor(root, pointer) {
  const p = paths(root, pointer.id);
  regular(p.manifest);
  if (fileHash(p.manifest) !== pointer.manifestHash) fail();
  const manifest = parse(p.manifest);
  if (
    manifest.version !== 1 ||
    manifest.id !== pointer.id ||
    !Array.isArray(manifest.databases) ||
    !Array.isArray(manifest.tenants) ||
    !Array.isArray(manifest.authorities) ||
    manifest.authorities.length !== 2 ||
    JSON.stringify(manifest.authorities.map((a) => a.table).sort()) !==
      JSON.stringify(["reading_events", "reading_safe_events"])
  )
    fail();
  const expected = [
    "accounts.sqlite",
    ...manifest.tenants.map((id) => "users/" + id + "/workspace.sqlite"),
  ];
  if (
    !Array.isArray(manifest.accounts) ||
    manifest.accounts.some((id) => !accountId(id)) ||
    new Set(manifest.accounts).size !== manifest.accounts.length ||
    manifest.tenants.some((id) => !manifest.accounts.includes(id)) ||
    JSON.stringify(manifest.databases.map((d) => d.path)) !==
      JSON.stringify(expected)
  )
    fail();
  for (const d of manifest.databases) regular(join(p.directory, d.path));
  for (const proof of manifest.authorities) {
    if (inside(join(root, "data-versions"), resolve(proof.path))) fail();
    checkAuthority(proof);
  }
  return { ...p, manifest };
}

// Resolve only after a shared writer registration, so an exclusive migration
// cannot race service startup. Baseline file hashes are checked at activation;
// active databases subsequently evolve through their verified schema writers.
export function resolveDataVersion(lease, { ledgerPath } = {}) {
  if (!held.has(lease)) throw Error("DATA_LEASE_REQUIRED");
  const pointer = readPointer(lease.root);
  if (!pointer) return { directory: lease.root, version: null };
  const selected = manifestFor(lease.root, pointer),
    commit = join(lease.root, "data-version-commits", pointer.id + ".json");
  regular(commit);
  const saved = parse(commit);
  if (saved.manifestHash !== pointer.manifestHash) fail();
  for (const name of readdirSync(dirname(commit))) {
    if (!name.endsWith(".json") || !versionId(name.slice(0, -5))) fail();
    regular(join(dirname(commit), name));
    if (parse(join(dirname(commit), name)).previous === pointer.id) fail();
  }
  if (
    ledgerPath &&
    selected.manifest.authorities.some(
      (a) => a.path !== realpathSync(ledgerPath),
    )
  )
    fail();
  return {
    directory: selected.directory,
    version: pointer.id,
    manifest: selected.manifest,
  };
}

// Host-only offline operation. It copies the complete stopped registry/tenant
// set, then invokes actual version-aware migrators on the isolated shadow.
export function prepareShadowVersion(
  lease,
  { id, ledgerPath, migrate, afterStep } = {},
) {
  exclusive(lease);
  if (!versionId(id) || typeof migrate !== "function")
    throw Error("INVALID_DATA_VERSION");
  const source = resolveDataVersion(lease, { ledgerPath }).directory,
    set = inventory(source);
  const protectedPath = realpathSync(ledgerPath);
  if (
    inside(join(lease.root, "data-versions"), protectedPath) ||
    protectedPath === join(source, "accounts.sqlite")
  )
    fail();
  const parent = join(lease.root, "data-versions");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  regular(parent, true);
  const target = join(parent, id);
  mkdirSync(target, { mode: 0o700 });
  const members = [
    "accounts.sqlite",
    ...set.tenants.map((id) => "users/" + id + "/workspace.sqlite"),
  ];
  const total = members.reduce(
    (sum, member) =>
      sum + lstatSync(join(source, member), { bigint: true }).size,
    0n,
  );
  const space = statfsSync(lease.root, { bigint: true });
  if (space.bavail * space.bsize < total * 2n)
    throw Error("DATA_MIGRATION_SPACE_REQUIRED");
  for (const member of members) {
    database(join(source, member));
    const destination = join(target, member);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(join(source, member), destination);
    const migrated = migrate({
      directory: target,
      path: destination,
      kind: member === "accounts.sqlite" ? "registry" : "tenant",
    });
    if (migrated && typeof migrated.then === "function")
      throw Error("SYNCHRONOUS_MIGRATOR_REQUIRED");
    database(destination, { versioned: true });
    const fd = openSync(destination, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    for (
      let directory = dirname(destination);
      directory === target || inside(target, directory);
      directory = dirname(directory)
    )
      syncDirectory(directory);
    afterStep?.(member);
  }
  if (JSON.stringify(inventory(target)) !== JSON.stringify(set)) fail();
  const manifest = {
    version: 1,
    id,
    ...set,
    databases: members.map((path) => ({
      path,
      ...database(join(target, path), { versioned: true }),
    })),
    authorities: [
      authority(protectedPath, "reading_events"),
      authority(protectedPath, "reading_safe_events"),
    ],
  };
  durable(join(target, "manifest.json"), manifest);
  syncDirectory(parent);
  return {
    id,
    manifestHash: fileHash(join(target, "manifest.json")),
    accounts: set.accounts.length,
    tenants: set.tenants.length,
  };
}

export function activateDataVersion(
  lease,
  prepared,
  { expectedVersion = null, beforeRename, afterRename } = {},
) {
  exclusive(lease);
  const commits = join(lease.root, "data-version-commits");
  const initialRecovery =
    !existsSync(join(lease.root, "data-version.json")) &&
    expectedVersion === null &&
    (!existsSync(commits) || !readdirSync(commits).length);
  const previous = initialRecovery ? null : readPointer(lease.root);
  if ((previous?.id || null) !== expectedVersion)
    throw Error("STALE_DATA_VERSION");
  const pointer = {
    version: 1,
    id: prepared.id,
    manifestHash: prepared.manifestHash,
  };
  const selected = manifestFor(lease.root, pointer);
  for (const member of selected.manifest.databases) {
    const { path, ...expected } = member;
    if (
      JSON.stringify(
        database(join(selected.directory, path), { versioned: true }),
      ) !== JSON.stringify(expected)
    )
      fail();
  }
  // No replay of an already activated version after it has accepted writes.
  mkdirSync(commits, { recursive: true, mode: 0o700 });
  regular(commits, true);
  const receipt = join(commits, pointer.id + ".json");
  if (existsSync(receipt)) throw Error("DATA_VERSION_ALREADY_ACTIVATED");
  const temp = join(lease.root, "data-version-" + randomUUID() + ".tmp");
  durable(temp, pointer);
  fenceLegacyRoot(lease.root);
  if (!existsSync(join(lease.root, ".data-version-required")))
    durable(join(lease.root, ".data-version-required"), { version: 1 });
  beforeRename?.();
  renameSync(temp, join(lease.root, "data-version.json"));
  syncDirectory(lease.root);
  afterRename?.();
  durable(receipt, {
    manifestHash: pointer.manifestHash,
    previous: previous?.id || null,
  });
  return pointer;
}

// A crash between the pointer rename and its commit receipt leaves startup
// closed. Completion is host-only, under the exclusive lease, and rechecks the
// entire still-unopened baseline instead of guessing which files are current.
export function completeDataActivation(lease) {
  exclusive(lease);
  const pointer = readPointer(lease.root),
    selected = pointer && manifestFor(lease.root, pointer);
  if (!selected) fail();
  const commits = join(lease.root, "data-version-commits"),
    receipt = join(commits, pointer.id + ".json");
  if (existsSync(receipt)) {
    resolveDataVersion(lease);
    return pointer;
  }
  let previous = null;
  const parents = new Set();
  for (const name of readdirSync(commits)) {
    regular(join(commits, name));
    const saved = parse(join(commits, name));
    parents.add(saved.previous);
    const id = name.slice(0, -5);
    if (!versionId(id) || !name.endsWith(".json")) fail();
  }
  const tips = readdirSync(commits)
    .map((name) => name.slice(0, -5))
    .filter((id) => !parents.has(id));
  if (tips.length > 1) fail();
  previous = tips[0] || null;
  for (const member of selected.manifest.databases) {
    const { path, ...expected } = member;
    if (
      JSON.stringify(
        database(join(selected.directory, path), { versioned: true }),
      ) !== JSON.stringify(expected)
    )
      fail();
  }
  durable(receipt, { manifestHash: pointer.manifestHash, previous });
  return pointer;
}
