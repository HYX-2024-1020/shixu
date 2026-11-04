import { ensureDatabaseSchema } from "../database-schema.mjs";
import { LEGACY_JOB_ARCHIVE_SCHEMA } from "../database-schemas.mjs";
import { sha256 } from "./material.mjs";

const states = {
  queued: "interrupted",
  running: "interrupted",
  applying: "conflict",
  done: "done",
  error: "error",
  conflict: "conflict",
  interrupted: "interrupted",
};
const id = (v) => typeof v === "string" && /^[\w-]{1,120}$/.test(v);
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw Error("LEGACY_JOB_RECONCILIATION");
  }
};
// Only existing small structured results may survive in the live tenant. Raw
// provider envelopes, input copies and arbitrary extra fields require offline
// review of the stopped source copy; never silently truncate or certify them.
function checkOutput(text) {
  if (text === null) return;
  if (Buffer.byteLength(text) > 128000)
    throw Error("LEGACY_OUTPUT_RECONCILIATION");
  const output = parse(text);
  const allowed = new Set(["result", "reply", "patch"]);
  if (
    !output ||
    Array.isArray(output) ||
    typeof output !== "object" ||
    Object.keys(output).some((k) => !allowed.has(k))
  )
    throw Error("LEGACY_OUTPUT_RECONCILIATION");
  let quoted = 0;
  function visit(v, depth = 0) {
    if (depth > 20) throw Error("LEGACY_OUTPUT_RECONCILIATION");
    if (typeof v === "string" && v.length > 4000)
      throw Error("LEGACY_OUTPUT_RECONCILIATION");
    if (!v || typeof v !== "object") return;
    for (const [k, value] of Object.entries(v)) {
      if (
        [
          "sources",
          "request",
          "messages",
          "body",
          "content",
          "text",
          "__proto__",
          "constructor",
          "prototype",
        ].includes(k)
      )
        throw Error("LEGACY_OUTPUT_RECONCILIATION");
      if (k === "quote") {
        if (typeof value !== "string" || value.length > 500)
          throw Error("LEGACY_OUTPUT_RECONCILIATION");
        quoted += value.length;
      }
      visit(value, depth + 1);
    }
  }
  visit(output);
  if (quoted > 2000) throw Error("LEGACY_OUTPUT_RECONCILIATION");
}

// Called before legacy queue recovery, only when the shared v4 service owns the
// tenant. No v4 task/block/publication, wallet grant or provider call is created.
export function migrateLegacyJobs(store, { now = Date.now() } = {}) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + 7 * 86400000)
  )
    throw Error("INVALID_MIGRATION_TIME");
  const db = store.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='legacy_job_archive'")
      .get();
    ensureDatabaseSchema(db, "tenant-legacy-jobs", LEGACY_JOB_ARCHIVE_SCHEMA);
    const archived = db
      .prepare("SELECT * FROM legacy_job_archive ORDER BY id")
      .all();
    const marked = store.meta("legacy_jobs_v4");
    if (marked && marked !== "1") throw Error("LEGACY_JOB_RECONCILIATION");
    if (!marked && existing) throw Error("LEGACY_JOB_RECONCILIATION");
    if (marked) {
      for (const receipt of archived) {
        const row = db
          .prepare("SELECT * FROM sync_jobs WHERE id=?")
          .get(receipt.id);
        // Permanent deletion is allowed to remove a job, never revive it.
        if (!row) {
          if (!store.record(receipt.packet)?.purged)
            throw Error("LEGACY_JOB_RECONCILIATION");
        } else if (
          sha256(JSON.stringify(row)) !==
          (db
            .prepare("SELECT target_hash FROM legacy_job_disposals WHERE id=?")
            .get(row.id)?.target_hash || receipt.target_hash)
        )
          throw Error("LEGACY_JOB_RECONCILIATION");
        if (row?.output !== null && row && receipt.expires <= now) {
          db.prepare("UPDATE sync_jobs SET output=NULL WHERE id=?").run(row.id);
          db.prepare("INSERT INTO legacy_job_disposals VALUES(?,?,?)").run(
            row.id,
            sha256(JSON.stringify({ ...row, output: null })),
            now,
          );
        }
      }
      if (
        db
          .prepare(
            "SELECT 1 FROM sync_jobs j WHERE NOT EXISTS(SELECT 1 FROM legacy_job_archive a WHERE a.id=j.id)",
          )
          .get()
      )
        throw Error("LEGACY_JOB_RECONCILIATION");
      db.exec("COMMIT");
      return { jobs: archived.length, repeated: true };
    }
    let jobs = 0,
      records = 0;
    for (const row of db
      .prepare("SELECT * FROM sync_jobs ORDER BY id")
      .iterate()) {
      const state = Object.hasOwn(states, row.state) ? states[row.state] : null;
      if (!state || !id(row.id) || !id(row.record_id))
        throw Error("LEGACY_JOB_RECONCILIATION");
      const request = parse(row.request);
      if (
        !request ||
        !["organize", "chat"].includes(request.kind) ||
        request.id !== row.id ||
        request.packetId !== row.record_id
      )
        throw Error("LEGACY_JOB_RECONCILIATION");
      checkOutput(row.output);
      const safeRequest = JSON.stringify({
        id: row.id,
        packetId: row.record_id,
        kind: request.kind,
        legacy: true,
        eligible: false,
      });
      db.prepare(
        "UPDATE sync_jobs SET state=?,request=?,error=? WHERE id=?",
      ).run(
        state,
        safeRequest,
        state === "done"
          ? ""
          : "旧任务已归档，结果尚未验证；请核对后主动发起新整理",
        row.id,
      );
      const target = db
        .prepare("SELECT * FROM sync_jobs WHERE id=?")
        .get(row.id);
      db.prepare(
        "INSERT INTO legacy_job_archive VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        row.id,
        row.record_id,
        row.state,
        state,
        sha256(row.request),
        row.output === null ? null : sha256(row.output),
        sha256(JSON.stringify(row)),
        sha256(JSON.stringify(target)),
        now + 7 * 86400000,
      );
      jobs++;
    }
    // Source text is an obsolete full extraction cache. The canonical user text,
    // attachment descriptors, saved items, order, citations and management state
    // remain byte-for-byte JSON values. Every changed record advances the cursor.
    for (const row of db
      .prepare(
        "SELECT id,data FROM sync_records WHERE data IS NOT NULL ORDER BY id",
      )
      .iterate()) {
      const data = parse(row.data);
      if (data.sources != null && !Array.isArray(data.sources))
        throw Error("LEGACY_SOURCE_RECONCILIATION");
      if (!Array.isArray(data.sources) || !data.sources.length) continue;
      const originals = new Set((data.attachments || []).map((f) => f.id));
      for (const source of data.sources) {
        if (
          !source ||
          typeof source.text !== "string" ||
          (!originals.has(source.id) && source.text !== (data.text || ""))
        )
          throw Error("LEGACY_SOURCE_RECONCILIATION");
      }
      const before = sha256(row.data);
      data.sources = [];
      const serialized = JSON.stringify(data),
        version = store.sequence + 1;
      if (!Number.isSafeInteger(version))
        throw Error("LEGACY_SEQUENCE_OVERFLOW");
      db.prepare("UPDATE sync_records SET data=?,version=? WHERE id=?").run(
        serialized,
        version,
        row.id,
      );
      db.prepare("UPDATE sync_meta SET value=? WHERE key='sequence'").run(
        String(version),
      );
      db.prepare("INSERT INTO legacy_source_cleanup VALUES(?,?,?,?)").run(
        row.id,
        before,
        sha256(serialized),
        version,
      );
      records++;
    }
    db.prepare("INSERT INTO sync_meta VALUES('legacy_jobs_v4','1')").run();
    db.exec("COMMIT");
    return { jobs, records, repeated: false };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
