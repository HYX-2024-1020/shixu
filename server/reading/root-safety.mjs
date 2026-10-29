import { randomUUID } from "node:crypto";

// Independent ledger-side metadata. Never contains input, evidence or results.
export class ReadingRootSafety {
  constructor(ledger, account) {
    this.db = ledger.db;
    this.account = account;
    this.now = ledger.now;
    this.transaction = ledger.transaction.bind(ledger);
    this.owned = new Set();
    this.db.exec(`CREATE TABLE IF NOT EXISTS reading_safe_roots(
      account TEXT NOT NULL,packet TEXT NOT NULL,root TEXT NOT NULL,PRIMARY KEY(account,packet));
      CREATE TABLE IF NOT EXISTS reading_safe_links(
      account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,root TEXT NOT NULL,PRIMARY KEY(account,task));
      CREATE TABLE IF NOT EXISTS reading_safe_events(
      seq INTEGER PRIMARY KEY,account TEXT NOT NULL,root TEXT NOT NULL,calls INTEGER NOT NULL,
      active_ms INTEGER NOT NULL,completed INTEGER NOT NULL,checkpoint_calls INTEGER NOT NULL,
      reason TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_safe_steps(
      id TEXT PRIMARY KEY,account TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL,generation INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_safe_drains(step TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reading_safe_pending ON reading_safe_steps(account,root,id);
      CREATE INDEX IF NOT EXISTS reading_safe_latest ON reading_safe_events(account,root,seq DESC);`);
    for (const table of [
      "reading_safe_roots",
      "reading_safe_links",
      "reading_safe_events",
      "reading_safe_steps",
      "reading_safe_drains",
    ])
      for (const action of ["UPDATE", "DELETE"])
        this.db
          .exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table}
          BEGIN SELECT RAISE(ABORT,'SAFETY_APPEND_ONLY'); END;`);
  }
  bind(packet, task, proposedRoot) {
    return this.transaction(() => this.bindLocked(packet, task, proposedRoot));
  }
  bindLocked(packet, task, proposedRoot) {
    this.db
      .prepare("INSERT OR IGNORE INTO reading_safe_roots VALUES(?,?,?)")
      .run(this.account, packet, proposedRoot);
    const { root } = this.db
      .prepare(
        "SELECT root FROM reading_safe_roots WHERE account=? AND packet=?",
      )
      .get(this.account, packet);
    const previous = this.db
      .prepare("SELECT * FROM reading_safe_links WHERE account=? AND task=?")
      .get(this.account, task);
    if (previous && (previous.packet !== packet || previous.root !== root))
      throw Error("SAFETY_RECONCILIATION");
    this.db
      .prepare("INSERT OR IGNORE INTO reading_safe_links VALUES(?,?,?,?)")
      .run(this.account, task, packet, root);
    return root;
  }
  tasks(root) {
    return this.db
      .prepare(
        "SELECT task FROM reading_safe_links WHERE account=? AND root=? ORDER BY rowid",
      )
      .all(this.account, root)
      .map((r) => r.task);
  }
  latest(root) {
    return this.db
      .prepare(
        "SELECT * FROM reading_safe_events WHERE account=? AND root=? ORDER BY seq DESC LIMIT 1",
      )
      .get(this.account, root);
  }
  begin(root, task, generation) {
    const step = randomUUID();
    this.db
      .prepare("INSERT INTO reading_safe_steps VALUES(?,?,?,?,?,?)")
      .run(step, this.account, root, task, generation, this.now());
    this.owned.add(step);
    return step;
  }
  finish(step) {
    try {
      this.db
        .prepare("INSERT INTO reading_safe_drains VALUES(?,?)")
        .run(step, this.now());
    } finally {
      this.owned.delete(step);
    }
  }
  abandon(step) { this.owned.delete(step); }
  observe(root, stats, mismatch = false) {
    return this.transaction(() => this.observeLocked(root, stats, mismatch));
  }
  observeLocked(root, stats, mismatch) {
    const before = this.latest(root);
    const fields = {
      calls: "calls",
      activeMs: "active_ms",
      completed: "completed",
      checkpointCalls: "checkpoint_calls",
    };
    for (const key of Object.keys(fields))
      if (!Number.isSafeInteger(stats[key]) || stats[key] < 0)
        throw Error("INVALID_SAFETY_COUNTER");
    const regressed =
      mismatch ||
      (before &&
        Object.entries(fields).some(
          ([key, column]) => stats[key] < before[column],
        ));
    const result = { ...stats, id: root };
    for (const [key, column] of Object.entries(fields))
      result[key] = Math.max(stats[key], before?.[column] || 0);
    const orphan = this.db
      .prepare(
        `SELECT s.id FROM reading_safe_steps s LEFT JOIN reading_safe_drains d ON d.step=s.id
      WHERE s.account=? AND s.root=? AND d.step IS NULL`,
      )
      .all(this.account, root)
      .some((s) => !this.owned.has(s.id));
    result.reason =
      orphan ||
      [stats.reason, before?.reason].includes("ACTIVE_TIME_RECONCILIATION")
        ? "ACTIVE_TIME_RECONCILIATION"
        : regressed || before?.reason === "SAFETY_RECONCILIATION"
          ? "SAFETY_RECONCILIATION"
          : before?.reason || stats.reason || "";
    if (
      !before ||
      Object.entries(fields).some(
        ([key, column]) => result[key] !== before[column],
      ) ||
      result.reason !== before.reason
    )
      this.db
        .prepare(
          "INSERT INTO reading_safe_events(account,root,calls,active_ms,completed,checkpoint_calls,reason,at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          this.account,
          root,
          result.calls,
          result.activeMs,
          result.completed,
          result.checkpointCalls,
          result.reason,
          this.now(),
        );
    result.nextCheckpointCalls = result.checkpointCalls + 24;
    return result;
  }
}
