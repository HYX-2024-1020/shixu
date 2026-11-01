import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { ensureDatabaseSchema } from "./database-schema.mjs";
import { ACCOUNTS_CORE_SCHEMA } from "./database-schemas.mjs";
import {
  withDataControl,
  processIdentity,
  terminatedIdentity,
} from "./data-control.mjs";
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
function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
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
  if (!present(path)) return;
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
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  regular(directory, true);
  const root = realpathSync(directory);
  return withDataControl(root, (db) => acquireDataLeaseLocked(root, mode, db));
}
function acquireDataLeaseLocked(directory, mode, db) {
  if (
    db
      .prepare(
        "SELECT 1 FROM data_recovery_intents i WHERE NOT EXISTS(SELECT 1 FROM data_recovery_finalizations f WHERE f.operation=i.operation)",
      )
      .get()
  )
    throw Error("DATA_MAINTENANCE");
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
      durable(path, { version: 1, token: leaseToken, ...processIdentity() });
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
    if (present(lock)) throw Error("DATA_MAINTENANCE");
    path = join(
      writers,
      mode === "runtime" ? "runtime.json" : randomUUID() + ".json",
    );
    try {
      durable(path, { version: 1, token: leaseToken, ...processIdentity() });
    } catch (error) {
      if (error.code === "EEXIST") throw Error("DATA_WRITERS_ACTIVE");
      throw error;
    }
    if (present(lock)) {
      unlinkSync(path);
      syncDirectory(writers);
      throw Error("DATA_MAINTENANCE");
    }
  }
  const lease = {
    root,
    mode,
    release() {
      if (!held.has(lease)) return;
      withDataControl(root, () => {
        if (held.has(lease)) {
          regular(path);
          if (parse(path).token !== leaseToken)
            throw Error("DATA_LEASE_OWNERSHIP");
          unlinkSync(path);
          syncDirectory(dirname(path));
          held.delete(lease);
        }
      });
    },
  };
  held.add(lease);
  return Object.freeze(lease);
}
function exclusive(lease) {
  if (!held.has(lease) || lease.mode !== "maintenance")
    throw Error("DATA_MAINTENANCE_REQUIRED");
}

function database(path, { versioned = false } = {}) {
  regular(path);
  if (present(path + "-wal") || present(path + "-shm"))
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
  if (present(users)) {
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
  if (!present(path)) {
    if (
      present(join(root, ".data-version-required")) ||
      (present(join(root, "data-version-commits")) &&
        readdirSync(join(root, "data-version-commits")).length)
    )
      fail();
    return null;
  }
  regular(path);
  const pointer = parse(path);
  if (
    ![1, 2].includes(pointer.version) ||
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
  withDataControl(lease.root, (db) => {
    const activation = db
      .prepare("SELECT * FROM data_activations WHERE id=?")
      .get(pointer.id);
    if (
      pointer.version === 2 &&
      (!activation ||
        activation.manifest_hash !== pointer.manifestHash ||
        activation.previous !== saved.previous)
    )
      fail();
    if (
      db
        .prepare("SELECT 1 FROM data_activations WHERE previous=?")
        .get(pointer.id)
    )
      fail();
  });
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
  {
    id,
    ledgerPath,
    migrate,
    afterStep,
    now = Date.now(),
    recoverInitial = false,
  } = {},
) {
  exclusive(lease);
  if (
    !versionId(id) ||
    typeof migrate !== "function" ||
    typeof recoverInitial !== "boolean" ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + 7 * 86400000)
  )
    throw Error("INVALID_DATA_VERSION");
  const initialRecovery =
    recoverInitial &&
    !present(join(lease.root, "data-version.json")) &&
    (!present(join(lease.root, "data-version-commits")) ||
      !readdirSync(join(lease.root, "data-version-commits")).length) &&
    withDataControl(
      lease.root,
      (db) =>
        !db.prepare("SELECT 1 FROM data_activations").get() &&
        !!db
          .prepare("SELECT 1 FROM data_shadow_intents WHERE source=?")
          .get("@legacy"),
    );
  if (recoverInitial && !initialRecovery)
    throw Error("INITIAL_DATA_RECOVERY_FORBIDDEN");
  const source = initialRecovery
      ? lease.root
      : resolveDataVersion(lease, { ledgerPath }).directory,
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
  withDataControl(lease.root, (db) =>
    db
      .prepare("INSERT INTO data_shadow_intents VALUES(?,?,?,?,?)")
      .run(
        id,
        source === lease.root
          ? "@legacy"
          : relative(join(lease.root, "data-versions"), source),
        JSON.stringify(
          [...members, "manifest.json"].map(
            (member) => "data-versions/" + id + "/" + member,
          ),
        ),
        now + 7 * 86400000,
        now,
      ),
  );
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
  {
    expectedVersion = null,
    beforeRename,
    afterRename,
    afterReceipt,
    now = Date.now(),
  } = {},
) {
  exclusive(lease);
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + 7 * 86400000)
  )
    throw Error("INVALID_RETIREMENT_TIME");
  const commits = join(lease.root, "data-version-commits");
  const initialRecovery =
    !present(join(lease.root, "data-version.json")) &&
    expectedVersion === null &&
    (!present(commits) || !readdirSync(commits).length);
  const previous = initialRecovery ? null : readPointer(lease.root);
  if ((previous?.id || null) !== expectedVersion)
    throw Error("STALE_DATA_VERSION");
  const pointer = {
    version: 2,
    id: prepared.id,
    manifestHash: prepared.manifestHash,
  };
  const selected = manifestFor(lease.root, pointer);
  const shadow = withDataControl(lease.root, (db) =>
    db
      .prepare("SELECT expires FROM data_shadow_intents WHERE id=?")
      .get(pointer.id),
  );
  if (!shadow || shadow.expires <= now) throw Error("DATA_SHADOW_EXPIRED");
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
  if (present(receipt)) throw Error("DATA_VERSION_ALREADY_ACTIVATED");
  const temp = join(lease.root, "data-version-" + randomUUID() + ".tmp");
  durable(temp, pointer);
  fenceLegacyRoot(lease.root);
  recordRetirement(lease.root, pointer.id, previous?.id || null, now);
  if (!present(join(lease.root, ".data-version-required")))
    durable(join(lease.root, ".data-version-required"), { version: 1 });
  beforeRename?.();
  renameSync(temp, join(lease.root, "data-version.json"));
  syncDirectory(lease.root);
  afterRename?.();
  durable(receipt, {
    manifestHash: pointer.manifestHash,
    previous: previous?.id || null,
  });
  afterReceipt?.();
  recordActivation(lease.root, pointer, previous?.id || null, now);
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
  if (present(receipt)) {
    const saved = parse(receipt);
    if (saved.manifestHash !== pointer.manifestHash) fail();
    if (
      pointer.version === 2 &&
      !withDataControl(lease.root, (db) =>
        db.prepare("SELECT 1 FROM data_activations WHERE id=?").get(pointer.id),
      )
    ) {
      for (const member of selected.manifest.databases) {
        const { path, ...expected } = member;
        if (
          JSON.stringify(
            database(join(selected.directory, path), { versioned: true }),
          ) !== JSON.stringify(expected)
        )
          fail();
      }
      recordActivation(lease.root, pointer, saved.previous, Date.now());
    }
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
  if (pointer.version === 2)
    recordActivation(lease.root, pointer, previous, Date.now());
  return pointer;
}

function registrationSnapshot(root) {
  const entries = [],
    writers = join(root, ".data-writers");
  if (present(writers)) {
    regular(writers, true);
    const names = readdirSync(writers).sort();
    if (names.length > 200) throw Error("DATA_REGISTRATION_LIMIT");
    for (const name of names) {
      if (name !== "runtime.json" && !/^[a-f0-9-]{36}\.json$/.test(name))
        fail();
      const path = join(writers, name);
      regular(path);
      if (lstatSync(path).size > 4096) fail();
      entries.push({
        name: ".data-writers/" + name,
        hash: fileHash(path),
        registration: parse(path),
      });
    }
  }
  const maintenance = join(root, ".data-maintenance");
  if (present(maintenance)) {
    regular(maintenance);
    if (lstatSync(maintenance).size > 4096) fail();
    entries.push({
      name: ".data-maintenance",
      hash: fileHash(maintenance),
      registration: parse(maintenance),
    });
  }
  return { root, entries };
}
function hostAuthority(actor, operation, authorize) {
  if (
    typeof actor !== "string" ||
    !/^[\w:-]{1,90}$/.test(actor) ||
    typeof authorize !== "function" ||
    authorize({ actor, operation }) !== true
  )
    throw Error("DATA_MAINTENANCE_FORBIDDEN");
}
function fencePreviousRecoveryWriters(root, control) {
  const recoverableInitial =
    !present(join(root, "data-version.json")) &&
    !control.prepare("SELECT 1 FROM data_activations").get() &&
    !!control
      .prepare("SELECT 1 FROM data_shadow_intents WHERE source=?")
      .get("@legacy");
  const pointer = recoverableInitial ? null : readPointer(root),
    paths = new Set([join(root, "accounts.sqlite")]);
  if (
    pointer &&
    present(join(root, "data-version-commits", pointer.id + ".json"))
  )
    paths.add(join(manifestFor(root, pointer).directory, "accounts.sqlite"));
  for (const path of paths)
    if (present(path)) {
      regular(path);
      const db = new DatabaseSync(path);
      try {
        db.exec("PRAGMA synchronous=FULL;PRAGMA busy_timeout=3000");
        ensureDatabaseSchema(db, "accounts-core", ACCOUNTS_CORE_SCHEMA, {
          compatibleObjects: [
            "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
          ],
        });
      } finally {
        db.close();
      }
    }
}
export function reviewDataWriters(directory, actor, authorize) {
  hostAuthority(actor, "review-stale-data-writers", authorize);
  const root = realpathSync(directory);
  regular(root, true);
  return withDataControl(root, (db) => {
    const snapshot = registrationSnapshot(root);
    const evidence = snapshot.entries.map((e) => ({
      name: e.name,
      ...terminatedIdentity(e.registration),
    }));
    return {
      snapshotHash: digest(JSON.stringify(snapshot)),
      registrations: evidence,
      allTerminated: !!evidence.length && evidence.every((e) => e.terminated),
      pendingRecoveries: db
        .prepare(
          "SELECT operation,actor,snapshot_hash,at FROM data_recovery_intents i WHERE NOT EXISTS(SELECT 1 FROM data_recovery_finalizations f WHERE f.operation=i.operation)",
        )
        .all(),
    };
  });
}
// Host-only two-phase recovery. Kernel proof never settles unknown calls,
// estimates active task time, grants credit, or continues queued work.
export function recoverDataWriters(
  directory,
  { operationId, expectedSnapshotHash, actor, afterIntent, afterUnlink } = {},
  authorize,
) {
  hostAuthority(actor, "recover-stale-data-writers", authorize);
  if (
    typeof operationId !== "string" ||
    !/^[\w:-]{1,90}$/.test(operationId) ||
    !/^[a-f0-9]{64}$/.test(expectedSnapshotHash || "")
  )
    throw Error("INVALID_DATA_RECOVERY");
  const root = realpathSync(directory);
  regular(root, true);
  const intent = withDataControl(root, (db) => {
    const previous = db
      .prepare("SELECT * FROM data_recovery_intents WHERE operation=?")
      .get(operationId);
    if (previous) {
      if (
        previous.actor !== actor ||
        previous.snapshot_hash !== expectedSnapshotHash
      )
        throw Error("DATA_RECOVERY_CONFLICT");
      return previous;
    }
    const pending = db
      .prepare(
        "SELECT i.operation FROM data_recovery_intents i WHERE NOT EXISTS(SELECT 1 FROM data_recovery_finalizations f WHERE f.operation=i.operation)",
      )
      .get();
    if (pending)
      throw Object.assign(Error("DATA_RECOVERY_IN_PROGRESS"), {
        operationId: pending.operation,
      });
    const snapshot = registrationSnapshot(root);
    if (digest(JSON.stringify(snapshot)) !== expectedSnapshotHash)
      throw Error("STALE_DATA_RECOVERY");
    if (!snapshot.entries.length) throw Error("NO_STALE_DATA_WRITERS");
    for (const entry of snapshot.entries)
      if (!terminatedIdentity(entry.registration).terminated)
        throw Error("DATA_WRITERS_ACTIVE");
    fencePreviousRecoveryWriters(root, db);
    db.prepare("INSERT INTO data_recovery_intents VALUES(?,?,?,?,?)").run(
      operationId,
      actor,
      expectedSnapshotHash,
      JSON.stringify(snapshot),
      Date.now(),
    );
    return db
      .prepare("SELECT * FROM data_recovery_intents WHERE operation=?")
      .get(operationId);
  });
  afterIntent?.();
  return withDataControl(root, (db) => {
    const final = db
      .prepare("SELECT * FROM data_recovery_finalizations WHERE operation=?")
      .get(operationId);
    if (final)
      return { operationId, evidenceHash: final.evidence_hash, repeated: true };
    const snapshot = JSON.parse(intent.snapshot),
      current = registrationSnapshot(root),
      proof = [];
    for (const entry of current.entries) {
      const expected = snapshot.entries.find((e) => e.name === entry.name);
      if (!expected || expected.hash !== entry.hash)
        throw Error("STALE_DATA_RECOVERY");
      const kernel = terminatedIdentity(entry.registration);
      if (!kernel.terminated) throw Error("DATA_WRITERS_ACTIVE");
      proof.push({ name: entry.name, registrationHash: entry.hash, ...kernel });
    }
    for (const entry of current.entries) {
      const path = join(root, entry.name);
      unlinkSync(path);
      syncDirectory(dirname(path));
      afterUnlink?.(entry.name);
    }
    const evidenceHash = digest(
      JSON.stringify({ snapshotHash: expectedSnapshotHash, proof }),
    );
    db.prepare("INSERT INTO data_recovery_finalizations VALUES(?,?,?)").run(
      operationId,
      evidenceHash,
      Date.now(),
    );
    return { operationId, evidenceHash, repeated: false };
  });
}

function recordRetirement(root, id, previous, now) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + 7 * 86400000)
  )
    throw Error("INVALID_RETIREMENT_TIME");
  const directory = previous ? paths(root, previous).directory : root,
    set = inventory(directory);
  const members = [
    "accounts.sqlite",
    ...set.tenants.map((account) => "users/" + account + "/workspace.sqlite"),
  ];
  const files = members.map((member) => ({
    path: relative(root, join(directory, member)).replaceAll("\\", "/"),
    hash: fileHash(join(directory, member)),
  }));
  withDataControl(root, (db) => {
    const old = db.prepare("SELECT * FROM data_retirements WHERE id=?").get(id);
    if (old) {
      if (
        old.source !== (previous || "@legacy") ||
        old.files !== JSON.stringify(files)
      )
        throw Error("DATA_RETIREMENT_CONFLICT");
      return;
    }
    db.prepare("INSERT INTO data_retirements VALUES(?,?,?,?,?)").run(
      id,
      previous || "@legacy",
      now + 7 * 86400000,
      JSON.stringify(files),
      now,
    );
  });
}
function recordActivation(root, pointer, previous, now) {
  withDataControl(root, (db) => {
    const old = db
      .prepare("SELECT * FROM data_activations WHERE id=?")
      .get(pointer.id);
    if (old) {
      if (
        old.manifest_hash !== pointer.manifestHash ||
        old.previous !== previous
      )
        fail();
      return;
    }
    db.prepare("INSERT INTO data_activations VALUES(?,?,?,?)").run(
      pointer.id,
      pointer.manifestHash,
      previous,
      now,
    );
  });
}
function retiredPath(root, source, path) {
  const prefix = source === "@legacy" ? "" : "data-versions/" + source + "/";
  if (source !== "@legacy" && !versionId(source)) fail();
  if (typeof path !== "string" || !path.startsWith(prefix)) fail();
  const member = path.slice(prefix.length);
  if (
    member !== "accounts.sqlite" &&
    !/^users\/[a-f0-9-]{36}\/workspace\.sqlite$/.test(member)
  )
    fail();
  const segments = path.split("/");
  let directory = root;
  for (const segment of segments.slice(0, -1)) {
    directory = join(directory, segment);
    regular(directory, true);
  }
  return join(root, ...segments);
}
function minimalRootTombstone(root, id) {
  const path = join(root, ".data-tombstone-" + id + ".sqlite");
  if (present(path)) regular(path);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA synchronous=FULL;PRAGMA journal_mode=DELETE");
    ensureDatabaseSchema(db, "accounts-core", ACCOUNTS_CORE_SCHEMA, {
      compatibleObjects: [
        "CREATE UNIQUE INDEX active_slot ON bindings(user_id,kind) WHERE revoked=0",
      ],
    });
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    if (
      JSON.stringify(tables) !==
      JSON.stringify([
        "account_meta",
        "accounts",
        "ai_usage",
        "bindings",
        "nonces",
        "request_rates",
        "service_schema_versions",
      ])
    )
      fail();
    if (
      db
        .prepare("SELECT 1 FROM service_schema_versions WHERE component!=?")
        .get("accounts-core")
    )
      fail();
    for (const table of [
      "accounts",
      "bindings",
      "nonces",
      "request_rates",
      "ai_usage",
    ])
      if (db.prepare("SELECT 1 FROM " + table + " LIMIT 1").get()) fail();
    if (
      db
        .prepare("SELECT 1 FROM account_meta WHERE key!=?")
        .get("data_version_required")
    )
      fail();
    db.prepare("INSERT OR IGNORE INTO account_meta VALUES(?,?)").run(
      "data_version_required",
      "1",
    );
    if (
      db
        .prepare("SELECT value FROM account_meta WHERE key=?")
        .get("data_version_required")?.value !== "1"
    )
      fail();
  } finally {
    db.close();
  }
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(root);
  return {
    path: relative(root, path).replaceAll("\\", "/"),
    hash: fileHash(path),
  };
}
// Offline host cleanup only. Current files, authority stores, pointer and
// immutable metadata are never deleted. Old root registry becomes an empty
// fenced database, so an older binary cannot recreate a fresh writable root.
export function purgeRetiredData(
  lease,
  { operationId, actor, now = Date.now(), afterFile } = {},
  authorize,
) {
  exclusive(lease);
  hostAuthority(actor, "purge-retired-data", authorize);
  if (
    typeof operationId !== "string" ||
    !/^[\w:-]{1,90}$/.test(operationId) ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw Error("INVALID_DATA_RETIREMENT");
  const root = lease.root,
    selected = resolveDataVersion(lease);
  if (!selected.version) fail();
  const due = withDataControl(root, (db) =>
    db
      .prepare("SELECT * FROM data_retirements WHERE expires<=? ORDER BY at,id")
      .all(now),
  );
  const completed = [];
  for (const retirement of due) {
    if (
      !versionId(retirement.id) ||
      typeof retirement.files !== "string" ||
      Buffer.byteLength(retirement.files) > 1024 * 1024
    )
      fail();
    if (!present(join(root, "data-version-commits", retirement.id + ".json")))
      continue;
    if (retirement.source === selected.version) fail();
    const files = JSON.parse(retirement.files);
    if (
      !Array.isArray(files) ||
      !files.length ||
      files.length > 1001 ||
      new Set(files.map((f) => f.path)).size !== files.length ||
      files.some((f) => !/^[a-f0-9]{64}$/.test(f.hash || ""))
    )
      fail();
    let disposal = withDataControl(root, (db) => ({
      intent: db
        .prepare("SELECT * FROM data_retirement_disposals WHERE id=?")
        .get(retirement.id),
      complete: !!db
        .prepare("SELECT 1 FROM data_retirement_completions WHERE id=?")
        .get(retirement.id),
    }));
    if (disposal.complete) {
      completed.push(retirement.id);
      continue;
    }
    if (
      disposal.intent &&
      retirement.source === "@legacy" &&
      (disposal.intent.tombstone_path !==
        ".data-tombstone-" + retirement.id + ".sqlite" ||
        !/^[a-f0-9]{64}$/.test(disposal.intent.tombstone_hash || ""))
    )
      fail();
    for (const file of files) {
      const path = retiredPath(root, retirement.source, file.path);
      if (present(path + "-wal") || present(path + "-shm"))
        throw Error("DATA_DATABASE_NOT_CLOSED");
      if (present(path)) {
        const hash = fileHash(path),
          tombstoned =
            disposal.intent &&
            file.path === "accounts.sqlite" &&
            hash === disposal.intent.tombstone_hash;
        if (hash !== file.hash && !tombstoned)
          throw Error("DATA_RETIREMENT_CHANGED");
      }
    }
    if (!disposal.intent) {
      const tombstone =
        retirement.source === "@legacy"
          ? minimalRootTombstone(root, retirement.id)
          : null;
      disposal.intent = withDataControl(root, (db) => {
        db.prepare(
          "INSERT INTO data_retirement_disposals VALUES(?,?,?,?,?,?)",
        ).run(
          retirement.id,
          operationId + ":" + retirement.id,
          actor,
          tombstone?.path || null,
          tombstone?.hash || null,
          now,
        );
        return db
          .prepare("SELECT * FROM data_retirement_disposals WHERE id=?")
          .get(retirement.id);
      });
    } else if (
      disposal.intent.operation !== operationId + ":" + retirement.id ||
      disposal.intent.actor !== actor
    )
      throw Error("DATA_RETIREMENT_CONFLICT");
    for (const file of files) {
      const path = retiredPath(root, retirement.source, file.path);
      if (file.path === "accounts.sqlite" && retirement.source === "@legacy") {
        if (
          !present(path) ||
          fileHash(path) !== disposal.intent.tombstone_hash
        ) {
          const tombstone = join(root, disposal.intent.tombstone_path);
          if (fileHash(tombstone) !== disposal.intent.tombstone_hash) fail();
          renameSync(tombstone, path);
          syncDirectory(root);
        }
      } else if (present(path)) {
        unlinkSync(path);
        syncDirectory(dirname(path));
      }
      afterFile?.(file.path);
    }
    withDataControl(root, (db) =>
      db
        .prepare("INSERT INTO data_retirement_completions VALUES(?,?)")
        .run(retirement.id, now),
    );
    completed.push(retirement.id);
  }
  return { completed };
}

// Prepared shadows have their own seven-day ceiling. Only paths declared
// before the first byte was copied can be removed, never the selected pointer
// or any committed version. Sidecars of a dead failed migration are discarded
// together with its own database; no recursive delete or mtime guessing.
export function purgeAbandonedShadows(
  lease,
  { operationId, actor, now = Date.now(), afterFile } = {},
  authorize,
) {
  exclusive(lease);
  hostAuthority(actor, "purge-abandoned-data-shadows", authorize);
  if (
    typeof operationId !== "string" ||
    !/^[\w:-]{1,90}$/.test(operationId) ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw Error("INVALID_DATA_RETIREMENT");
  const root = lease.root,
    pointer = present(join(root, "data-version.json"))
      ? readPointer(root)
      : null;
  const due = withDataControl(root, (db) =>
    db
      .prepare(
        "SELECT * FROM data_shadow_intents WHERE expires<=? ORDER BY at,id",
      )
      .all(now),
  );
  const completed = [];
  for (const shadow of due) {
    if (!versionId(shadow.id) || Buffer.byteLength(shadow.files) > 1024 * 1024)
      fail();
    if (
      pointer?.id === shadow.id ||
      present(join(root, "data-version-commits", shadow.id + ".json")) ||
      withDataControl(root, (db) =>
        db.prepare("SELECT 1 FROM data_activations WHERE id=?").get(shadow.id),
      )
    )
      continue;
    const files = JSON.parse(shadow.files);
    if (
      !Array.isArray(files) ||
      !files.length ||
      files.length > 1002 ||
      new Set(files).size !== files.length
    )
      fail();
    assertAbandonedContents(root, shadow.id, files);
    const state = withDataControl(root, (db) => ({
      complete: !!db
        .prepare("SELECT 1 FROM data_shadow_completions WHERE id=?")
        .get(shadow.id),
      intent: db
        .prepare("SELECT * FROM data_shadow_disposals WHERE id=?")
        .get(shadow.id),
    }));
    if (state.complete) {
      completed.push(shadow.id);
      continue;
    }
    if (
      state.intent &&
      (state.intent.operation !== operationId + ":" + shadow.id ||
        state.intent.actor !== actor)
    )
      throw Error("DATA_RETIREMENT_CONFLICT");
    // Validate every existing parent/file before removing any member. A
    // migration may have failed before some planned directories were created.
    const actual = [];
    for (const file of files) {
      if (
        typeof file !== "string" ||
        !file.startsWith("data-versions/" + shadow.id + "/")
      )
        fail();
      const member = file.slice(("data-versions/" + shadow.id + "/").length);
      if (
        !["accounts.sqlite", "manifest.json"].includes(member) &&
        !/^users\/[a-f0-9-]{36}\/workspace\.sqlite$/.test(member)
      )
        fail();
      const segments = file.split("/");
      let directory = root,
        missing = false;
      for (const segment of segments.slice(0, -1)) {
        directory = join(directory, segment);
        if (!present(directory)) {
          missing = true;
          break;
        }
        regular(directory, true);
      }
      if (missing) continue;
      for (const suffix of member === "manifest.json"
        ? [""]
        : ["-wal", "-shm", "-journal", ""]) {
        const path = join(root, ...segments) + suffix;
        if (present(path)) {
          regular(path);
          actual.push(path);
        }
      }
    }
    if (!state.intent)
      withDataControl(root, (db) =>
        db
          .prepare("INSERT INTO data_shadow_disposals VALUES(?,?,?,?)")
          .run(shadow.id, operationId + ":" + shadow.id, actor, now),
      );
    for (const path of actual) {
      unlinkSync(path);
      syncDirectory(dirname(path));
      afterFile?.(relative(root, path).replaceAll("\\", "/"));
    }
    withDataControl(root, (db) =>
      db
        .prepare("INSERT INTO data_shadow_completions VALUES(?,?)")
        .run(shadow.id, now),
    );
    completed.push(shadow.id);
  }
  return { completed };
}
function assertAbandonedContents(root, id, files) {
  const directory = join(root, "data-versions", id);
  if (!present(directory)) return;
  regular(directory, true);
  const allowed = new Set(
    files.flatMap((path) =>
      path.endsWith(".sqlite")
        ? ["", "-wal", "-shm", "-journal"].map((suffix) => path + suffix)
        : [path],
    ),
  );
  const check = (path) => {
    regular(path);
    if (!allowed.has(relative(root, path).replaceAll("\\", "/")))
      throw Error("DATA_SHADOW_UNEXPECTED_CONTENT");
  };
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (entry !== "users") {
      check(path);
      continue;
    }
    regular(path, true);
    for (const account of readdirSync(path)) {
      if (!accountId(account)) fail();
      const tenant = join(path, account);
      regular(tenant, true);
      for (const file of readdirSync(tenant)) check(join(tenant, file));
    }
  }
}
