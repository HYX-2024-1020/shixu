import { sha256 } from "./material.mjs";
import { applyReadingMigrations } from "./schema.mjs";
const fail = () => {
  throw Error("WINDOW_STATE_RECONCILIATION");
};
const tables = [
  "reading_window_anchors",
  "reading_window_receipts",
  "reading_window_commits",
  "reading_window_purges",
  "reading_window_audits",
  "reading_window_finalizations",
  "reading_window_views",
  "reading_window_view_commits",
];
const SQL = `CREATE TABLE reading_window_views(seq INTEGER PRIMARY KEY,account TEXT NOT NULL,task TEXT NOT NULL,revision TEXT NOT NULL,previous_hash TEXT NOT NULL,next_hash TEXT NOT NULL,supersedes INTEGER REFERENCES reading_window_views(seq),at INTEGER NOT NULL);
 CREATE INDEX reading_window_view_latest ON reading_window_views(account,task,seq DESC);
 CREATE TABLE reading_window_view_commits(view INTEGER PRIMARY KEY,at INTEGER NOT NULL);
 CREATE TABLE reading_window_anchors(account TEXT NOT NULL,task TEXT NOT NULL,attachment TEXT NOT NULL,root TEXT NOT NULL,revision TEXT NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(account,task,attachment));
 CREATE TABLE reading_window_receipts(seq INTEGER PRIMARY KEY,account TEXT NOT NULL,task TEXT NOT NULL,attachment TEXT NOT NULL,previous_hash TEXT NOT NULL,next_hash TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX reading_window_latest ON reading_window_receipts(account,task,attachment,seq DESC);
 CREATE TABLE reading_window_commits(receipt INTEGER PRIMARY KEY,at INTEGER NOT NULL);
 CREATE TABLE reading_window_purges(account TEXT NOT NULL,task TEXT NOT NULL,root TEXT NOT NULL,revision TEXT NOT NULL,generation INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,task));
 CREATE TABLE reading_window_audits(account TEXT NOT NULL,operation TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL,actor TEXT NOT NULL,evidence_hash TEXT NOT NULL,reference TEXT NOT NULL,request_hash TEXT NOT NULL,proof_hash TEXT NOT NULL,watermark INTEGER NOT NULL,ledger_sequence INTEGER NOT NULL,before_snapshot TEXT NOT NULL,target_snapshot TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,operation));
 CREATE TABLE reading_window_finalizations(account TEXT NOT NULL,operation TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,operation));
 ${tables.flatMap((table) => ["UPDATE", "DELETE"].map((action) => `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WINDOW_PROOF');END;`)).join("\n")}`;
export function windowCoverageHash(value) {
  let coverage;
  try {
    coverage =
      typeof value === "string" ? JSON.parse(value) : structuredClone(value);
    if (!Array.isArray(coverage)) fail();
    for (const c of coverage) {
      if (!c || typeof c !== "object" || Array.isArray(c)) fail();
      delete c.readRetries;
    }
  } catch {
    fail();
  }
  return sha256(JSON.stringify(coverage));
}
export function windowRowHash(row) {
  if (!row) return "empty";
  let coverage;
  try {
    coverage = JSON.parse(row.coverage);
    if (!coverage || typeof coverage !== "object" || Array.isArray(coverage))
      fail();
  } catch {
    fail();
  }
  // Admission retries are diagnostics, not source/cursor evidence. A safe replay
  // may face a different queue without changing a single source range.
  delete coverage.readRetries;
  return sha256(
    JSON.stringify([
      row.task,
      row.attachment,
      row.content_hash,
      row.next_page,
      row.next_offset,
      coverage,
    ]),
  );
}
export class ReadingWindowSafety {
  constructor(engine) {
    this.e = engine;
    this.ledger = engine.ledger;
    this.db = this.ledger.db;
    applyReadingMigrations(this.ledger, "window-safety", [
      { version: 1, sql: SQL },
    ]);
    const normalize = (value) =>
      value.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
    const objects = [
      ...SQL.matchAll(/CREATE (TABLE|INDEX) ([a-z_]+) [^;]+;/g),
    ].map((m) => ({ name: m[2], sql: m[0] }));
    for (const table of tables)
      for (const action of ["UPDATE", "DELETE"])
        objects.push({
          name: table + "_" + action.toLowerCase(),
          sql: `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_WINDOW_PROOF');END;`,
        });
    for (const object of objects) {
      const stored = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE name=?")
        .get(object.name);
      if (!stored || normalize(stored.sql) !== normalize(object.sql))
        throw Error("READING_SCHEMA_MISMATCH");
    }
  }

  view(task) {
    return this.db
      .prepare(
        "SELECT v.*,c.view AS committed FROM reading_window_views v LEFT JOIN reading_window_view_commits c ON c.view=v.seq WHERE v.account=? AND v.task=? ORDER BY v.seq DESC LIMIT 1",
      )
      .get(this.e.account, task);
  }
  verifyCoverage(task, { final = false } = {}) {
    const current = this.e.get(task),
      view = this.view(task);
    if (!view) {
      if (final) fail();
      return;
    }
    if (!current || current.input_revision !== view.revision) fail();
    const value = windowCoverageHash(current.coverage);
    if (value === view.next_hash) return;
    if (!final && !view.committed && value === view.previous_hash) return;
    fail();
  }
  observeCoverage(task, coverage) {
    this.verifyCoverage(task);
    const previousHash = windowCoverageHash(this.e.get(task).coverage),
      nextHash = windowCoverageHash(coverage);
    let last = this.view(task);
    if (last && !last.committed && previousHash === last.next_hash) {
      this.confirmCoverage(task);
      last = this.view(task);
    }
    if (previousHash !== nextHash || !last) {
      if (last && !last.committed) {
        if (last.previous_hash !== previousHash) fail();
        if (last.next_hash !== nextHash)
          this.db
            .prepare(
              "INSERT INTO reading_window_views(account,task,revision,previous_hash,next_hash,supersedes,at) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              this.e.account,
              task,
              this.e.get(task).input_revision,
              previousHash,
              nextHash,
              last.seq,
              this.ledger.now(),
            );
      } else
        this.db
          .prepare(
            "INSERT INTO reading_window_views(account,task,revision,previous_hash,next_hash,at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            this.e.account,
            task,
            this.e.get(task).input_revision,
            previousHash,
            nextHash,
            this.ledger.now(),
          );
    }
    this.e.db
      .prepare("UPDATE reading_tasks SET coverage=? WHERE id=?")
      .run(JSON.stringify(coverage), task);
    this.confirmCoverage(task);
  }
  confirmCoverage(task) {
    const view = this.view(task);
    if (
      view &&
      !view.committed &&
      windowCoverageHash(this.e.get(task).coverage) === view.next_hash
    )
      this.db
        .prepare("INSERT INTO reading_window_view_commits VALUES(?,?)")
        .run(view.seq, this.ledger.now());
  }
  guardCoverage(task, coverage) {
    this.verifyCoverage(task, { final: true });
    this.confirmCoverage(task);
    if (windowCoverageHash(coverage) !== this.view(task)?.next_hash) fail();
  }
  anchors(task) {
    return this.db
      .prepare(
        "SELECT * FROM reading_window_anchors WHERE account=? AND task=? ORDER BY attachment",
      )
      .all(this.e.account, task);
  }
  latest(task, attachment) {
    return this.db
      .prepare(
        "SELECT r.*,c.receipt AS committed FROM reading_window_receipts r LEFT JOIN reading_window_commits c ON c.receipt=r.seq WHERE r.account=? AND r.task=? AND r.attachment=? ORDER BY r.seq DESC LIMIT 1",
      )
      .get(this.e.account, task, attachment);
  }
  purged(task) {
    return this.db
      .prepare("SELECT * FROM reading_window_purges WHERE account=? AND task=?")
      .get(this.e.account, task);
  }
  lastAudit(root) {
    return this.db
      .prepare(
        "SELECT a.* FROM reading_window_audits a JOIN reading_window_finalizations f ON f.account=a.account AND f.operation=a.operation WHERE a.account=? AND a.root=? ORDER BY a.rowid DESC LIMIT 1",
      )
      .get(this.e.account, root);
  }
  verify(task, anchor, row) {
    const current = this.e.get(task);
    if (!current || anchor.revision !== current.input_revision) fail();
    const receipt = this.latest(task, anchor.attachment),
      value = windowRowHash(row);
    if (row && row.content_hash !== anchor.content_hash) fail();
    if (!receipt) {
      if (value !== "empty") fail();
      return;
    }
    if (value === receipt.next_hash) return;
    if (!receipt.committed && value === receipt.previous_hash) return;
    fail();
  }
  registerInputs(task, files) {
    if (new Set(files.map((f) => f.id)).size !== files.length) fail();
    for (const file of files)
      this.select(
        task,
        file,
        this.e.db
          .prepare(
            "SELECT * FROM reading_windows WHERE task=? AND attachment=?",
          )
          .get(task, file.id),
      );
  }
  select(task, file, row) {
    if (this.purged(task)) fail();
    let anchor = this.anchors(task).find((a) => a.attachment === file.id);
    if (!anchor) {
      if (
        row ||
        this.db
          .prepare(
            "SELECT 1 FROM reading_calls WHERE account=? AND task=? AND state IN ('sent','settled','unknown','released') LIMIT 1",
          )
          .get(this.e.account, task)
      )
        fail();
      this.db
        .prepare("INSERT INTO reading_window_anchors VALUES(?,?,?,?,?,?)")
        .run(
          this.e.account,
          task,
          file.id,
          this.e.roots.forTask(task).id,
          this.e.get(task).input_revision,
          file.hash,
        );
      anchor = this.anchors(task).find((a) => a.attachment === file.id);
    }
    if (anchor.content_hash !== file.hash) fail();
    this.verify(task, anchor, row);
  }
  assertRoot(task, { latch = true } = {}) {
    try {
      return this.checkRoot(task);
    } catch (e) {
      if (
        latch &&
        e.message === "WINDOW_STATE_RECONCILIATION" &&
        !this.e.finalSnapshots
      )
        this.e.roots.block(task, e.message);
      throw e;
    }
  }
  checkRoot(task) {
    const root = this.e.roots.forTask(task).id;
    for (const linked of this.e.roots.safety.tasks(root)) {
      const current = this.e.get(linked),
        purge = this.purged(linked),
        rows = this.e.windows.rows(linked),
        anchors = this.anchors(linked);
      if (purge) {
        if (current?.state !== "purged" || rows.length) fail();
        continue;
      }
      if (!current && anchors.length) fail();
      if (current) this.verifyCoverage(linked);
      if (rows.some((r) => !anchors.some((a) => a.attachment === r.attachment)))
        fail();
      for (const a of anchors)
        this.verify(
          linked,
          a,
          rows.find((r) => r.attachment === a.attachment),
        );
    }
  }
  stage(task, row) {
    const old = this.e.db
      .prepare("SELECT * FROM reading_windows WHERE task=? AND attachment=?")
      .get(task, row.attachment);
    const anchor = this.anchors(task).find(
      (a) => a.attachment === row.attachment,
    );
    if (!anchor) fail();
    this.verify(task, anchor, old);
    const previousHash = windowRowHash(old),
      nextHash = windowRowHash(row),
      last = this.latest(task, row.attachment);
    if (previousHash === nextHash) return;
    if (last && !last.committed) {
      if (last.previous_hash !== previousHash || last.next_hash !== nextHash)
        fail();
      return;
    }
    this.db
      .prepare(
        "INSERT INTO reading_window_receipts(account,task,attachment,previous_hash,next_hash,at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        this.e.account,
        task,
        row.attachment,
        previousHash,
        nextHash,
        this.ledger.now(),
      );
  }
  confirm(task) {
    for (const anchor of this.anchors(task)) {
      const receipt = this.latest(task, anchor.attachment);
      if (!receipt || receipt.committed) continue;
      const row = this.e.db
        .prepare("SELECT * FROM reading_windows WHERE task=? AND attachment=?")
        .get(task, anchor.attachment);
      if (windowRowHash(row) !== receipt.next_hash) continue;
      this.db
        .prepare("INSERT INTO reading_window_commits VALUES(?,?)")
        .run(receipt.seq, this.ledger.now());
    }
  }
  purge(task) {
    const current = this.e.get(task),
      prior = this.purged(task);
    if (prior) {
      if (
        prior.revision !== current.input_revision ||
        prior.generation !== current.generation
      )
        fail();
      return;
    }
    this.db
      .prepare("INSERT INTO reading_window_purges VALUES(?,?,?,?,?,?)")
      .run(
        this.e.account,
        task,
        this.e.roots.forTask(task).id,
        current.input_revision,
        current.generation,
        this.ledger.now(),
      );
  }
}
