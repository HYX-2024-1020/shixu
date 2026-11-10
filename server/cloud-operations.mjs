import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chownSync, existsSync, lstatSync } from "node:fs";
import { dirname } from "node:path";

// The root maintenance worker and the unprivileged application share this WAL
// database. A cold worker must not leave root-only WAL/SHM files behind.
export function openHostCloudOperations(path) {
  if (process.getuid?.() !== 0) throw Error("HOST_ADMIN_REQUIRED");
  const owner = lstatSync(dirname(path));
  if (!owner.isDirectory() || owner.isSymbolicLink() || owner.uid === 0)
    throw Error("OPERATION_STATE_OWNER_REQUIRED");
  for (const file of [path, path + "-wal", path + "-shm"])
    if (existsSync(file) && !lstatSync(file).isFile())
      throw Error("OPERATION_STATE_PATH_REJECTED");
  const ops = new CloudOperations(path);
  try {
    for (const file of [path, path + "-wal", path + "-shm"]) {
      if (!existsSync(file)) continue;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw Error("OPERATION_STATE_PATH_REJECTED");
      chownSync(file, owner.uid, owner.gid);
    }
    return ops;
  } catch (error) {
    ops.close();
    throw error;
  }
}

const valid = (v) => typeof v === "string" && /^[\w-]{8,90}$/.test(v);
const fail = (code, status = 409) => {
  throw Object.assign(Error(code), { code, status });
};
const iso = (n) => new Date(n).toISOString();
export function isSealedCloudRelease(value) {
  return (
    !!value &&
    value.role === "private-v4-cloud-console" &&
    value.protocolVersion === 4 &&
    value.nodeMajor === 24 &&
    value.source === "committed-source-archive-plus-platform-build" &&
    /^[a-f0-9]{40}$/.test(value.sourceRevision || "") &&
    Number.isSafeInteger(value.ledgerCoreVersion) &&
    value.ledgerCoreVersion >= 8 &&
    Array.isArray(value.files) &&
    [
      "server/reading-runtime.mjs",
      "server/cloud-backup.mjs",
      "server/cloud-operations.mjs",
      "scripts/cloud-operations-worker.mjs",
      "dist/admin/index.html",
      "deploy/sync/install-cloud.sh",
    ].every((p) => value.files.includes(p))
  );
}
export class CloudOperations {
  constructor(path, { now = Date.now } = {}) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cloud_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,actor TEXT NOT NULL,args TEXT NOT NULL,fingerprint TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_job_events(seq INTEGER PRIMARY KEY,job TEXT NOT NULL,state TEXT NOT NULL,code TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_maintenance(seq INTEGER PRIMARY KEY,paused INTEGER NOT NULL,reason TEXT NOT NULL,job TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cloud_inventory(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
      ${["cloud_jobs", "cloud_job_events", "cloud_maintenance"].flatMap((table) => ["UPDATE", "DELETE"].map((action) => `CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY');END;`)).join("\n")}`);
  }
  jobs() {
    return this.db
      .prepare("SELECT * FROM cloud_jobs ORDER BY at DESC,id DESC LIMIT 100")
      .all()
      .map((r) => {
        const last = this.db
          .prepare(
            "SELECT * FROM cloud_job_events WHERE job=? ORDER BY seq DESC LIMIT 1",
          )
          .get(r.id);
        return {
          id: r.id,
          kind: r.kind,
          actor: r.actor,
          args: JSON.parse(r.args),
          createdAt: iso(r.at),
          state: last?.state || "queued",
          code: last?.code || "",
          result: last ? JSON.parse(last.result) : null,
          updatedAt: iso(last?.at || r.at),
        };
      });
  }
  maintenance() {
    const row = this.db
      .prepare("SELECT * FROM cloud_maintenance ORDER BY seq DESC LIMIT 1")
      .get();
    return {
      paused: !!row?.paused,
      reason: row?.reason || null,
      job: row?.job || null,
    };
  }
  inventory() {
    const r = this.db
      .prepare("SELECT body FROM cloud_inventory WHERE id=1")
      .get();
    return r ? JSON.parse(r.body) : null;
  }
  setInventory(value) {
    this.db
      .prepare(
        "INSERT INTO cloud_inventory VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(JSON.stringify(value));
  }
  setMaintenance(paused, reason, job) {
    this.db
      .prepare(
        "INSERT INTO cloud_maintenance(paused,reason,job,at) VALUES(?,?,?,?)",
      )
      .run(Number(paused), reason, job, this.now());
  }
  request(kind, args, id, actor) {
    if (
      !valid(id) ||
      typeof actor !== "string" ||
      !actor ||
      actor.length > 64 ||
      ![
        "backup",
        "restore",
        "cleanup",
        "restart",
        "rollback",
        "resume",
      ].includes(kind) ||
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).some(
        (k) => !["snapshotId", "releaseId", "reason"].includes(k),
      ) ||
      typeof args.reason !== "string" ||
      !args.reason.trim() ||
      args.reason.length > 200 ||
      (kind === "restore" && !valid(args.snapshotId)) ||
      (kind === "rollback" &&
        !/^deploy-[a-f0-9]{7,40}$/.test(args.releaseId || ""))
    )
      fail("INVALID_OPERATION", 400);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([kind, args, actor]))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT * FROM cloud_jobs WHERE id=?")
        .get(id);
      if (old && old.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT");
      if (!old) {
        if (
          this.db
            .prepare(
              "SELECT 1 FROM cloud_jobs j WHERE NOT EXISTS(SELECT 1 FROM cloud_job_events e WHERE e.job=j.id AND e.state IN ('succeeded','failed'))",
            )
            .get()
        )
          fail("OPERATION_BUSY");
        this.db
          .prepare("INSERT INTO cloud_jobs VALUES(?,?,?,?,?,?)")
          .run(id, kind, actor, JSON.stringify(args), fingerprint, this.now());
        if (kind !== "resume")
          this.setMaintenance(true, "维护操作等待执行：" + kind, id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return this.jobs().find((j) => j.id === id);
  }
  event(id, state, code = "", result = {}) {
    if (!["running", "succeeded", "failed"].includes(state))
      fail("INVALID_JOB_STATE");
    if (!this.db.prepare("SELECT 1 FROM cloud_jobs WHERE id=?").get(id))
      fail("JOB_NOT_FOUND", 404);
    this.db
      .prepare(
        "INSERT INTO cloud_job_events(job,state,code,result,at) VALUES(?,?,?,?,?)",
      )
      .run(id, state, code, JSON.stringify(result), this.now());
  }
  close() {
    this.db.close();
  }
}
