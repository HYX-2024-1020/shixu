// Root safety metadata contains no input, extracted text or model result. A
// packet's later task IDs/revisions share counters, including after purge.
export class ReadingRoots {
  constructor(store, ledger, account) {
    this.db = store.db;
    this.ledger = ledger;
    this.account = account;
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS reading_roots(id TEXT PRIMARY KEY,packet TEXT NOT NULL UNIQUE,reason TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS reading_root_progress(root TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(root,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_root_checkpoints(root TEXT NOT NULL,calls INTEGER NOT NULL,completed INTEGER NOT NULL,spent INTEGER NOT NULL,unknown_risk INTEGER NOT NULL,active_ms INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(root,calls));
      CREATE INDEX IF NOT EXISTS reading_tasks_packet ON reading_tasks(packet);`);
    ledger.db.exec(
      "CREATE INDEX IF NOT EXISTS reading_calls_account_task ON reading_calls(account,task)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const task of this.db
        .prepare(
          "SELECT id,packet,state,reason FROM reading_tasks ORDER BY rowid",
        )
        .all()) {
        const fresh = this.db
          .prepare("INSERT OR IGNORE INTO reading_roots(id,packet) VALUES(?,?)")
          .run(task.id, task.packet).changes;
        const root = this.forTask(task.id);
        if (
          task.reason === "SHUTDOWN_TIME_UNCERTAIN" ||
          ["running", "applying"].includes(task.state)
        )
          this.block(task.id, "ACTIVE_TIME_RECONCILIATION");
        for (const block of this.db
          .prepare(
            `SELECT b.fingerprint,b.call_id FROM reading_blocks b
             LEFT JOIN reading_reused_blocks r ON r.task=b.task AND r.fingerprint=b.fingerprint
             WHERE b.task=? AND r.task IS NULL`,
          )
          .all(task.id))
          if (ledger.call(block.call_id)?.state === "settled")
            this.progress(task.id, block.fingerprint);
        // Historical per-task checkpoints cannot prove progress across a root's
        // complete 24-call interval. Do not invent that evidence on upgrade.
        if (fresh && this.stats(task.id).calls >= 24)
          this.db
            .prepare(
              "UPDATE reading_roots SET reason='CHECKPOINT_RECONCILIATION' WHERE id=? AND reason=''",
            )
            .run(root.id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  attach(task) {
    this.db
      .prepare("INSERT OR IGNORE INTO reading_roots(id,packet) VALUES(?,?)")
      .run(task.id, task.packet);
  }
  forTask(id) {
    return this.db
      .prepare(
        "SELECT r.* FROM reading_roots r JOIN reading_tasks t ON r.packet=t.packet WHERE t.id=?",
      )
      .get(id);
  }
  block(id, reason) {
    // Unknown active time has priority and cannot be washed by another reason.
    this.db
      .prepare(
        "UPDATE reading_roots SET reason=? WHERE packet=(SELECT packet FROM reading_tasks WHERE id=?) AND reason!='ACTIVE_TIME_RECONCILIATION'",
      )
      .run(reason, id);
  }
  progress(id, fingerprint) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO reading_root_progress(root,fingerprint) VALUES(?,?)",
      )
      .run(this.forTask(id).id, fingerprint);
  }
  stats(id) {
    const root = this.forTask(id);
    const tasks = this.db
      .prepare(
        "SELECT id,calls,active_ms,reason FROM reading_tasks WHERE packet=?",
      )
      .all(root.packet);
    let calls = 0,
      spent = 0,
      unknownRisk = 0;
    // Separate databases: bounded SQL parameter batches instead of attaching a
    // mutable tenant DB to the independent billing connection.
    for (let i = 0; i < tasks.length; i += 400) {
      const ids = tasks.slice(i, i + 400).map((t) => t.id);
      const totals = this.ledger.db
        .prepare(
          `SELECT COUNT(*) calls,COALESCE(SUM(actual),0) spent,
        COALESCE(SUM(CASE WHEN state='unknown' THEN reserved ELSE 0 END),0) risk
        FROM reading_calls WHERE account=? AND task IN (${ids.map(() => "?").join(",")}) AND state IN ('sent','settled','unknown')`,
        )
        .get(this.account, ...ids);
      calls += totals.calls;
      spent += totals.spent;
      unknownRisk += totals.risk;
    }
    const checkpoint = this.db
      .prepare(
        "SELECT * FROM reading_root_checkpoints WHERE root=? ORDER BY calls DESC LIMIT 1",
      )
      .get(root.id);
    return {
      id: root.id,
      calls: Math.max(
        calls,
        tasks.reduce((n, t) => n + t.calls, 0),
      ),
      activeMs: tasks.reduce((n, t) => n + t.active_ms, 0),
      spent,
      unknownRisk,
      completed: this.db
        .prepare("SELECT COUNT(*) n FROM reading_root_progress WHERE root=?")
        .get(root.id).n,
      reason: tasks.some((t) => t.reason === "SHUTDOWN_TIME_UNCERTAIN")
        ? "ACTIVE_TIME_RECONCILIATION"
        : root.reason,
      checkpointCalls: checkpoint?.calls || 0,
      nextCheckpointCalls: (checkpoint?.calls || 0) + 24,
    };
  }
  checkpoint(id) {
    const stats = this.stats(id);
    if (stats.calls < stats.nextCheckpointCalls) return stats;
    const prior = this.db
      .prepare(
        "SELECT completed FROM reading_root_checkpoints WHERE root=? ORDER BY calls DESC LIMIT 1",
      )
      .get(stats.id);
    const reason =
      stats.completed <= (prior?.completed || 0)
        ? "CHECKPOINT_NO_PROGRESS"
        : "";
    this.db
      .prepare("INSERT INTO reading_root_checkpoints VALUES(?,?,?,?,?,?,?)")
      .run(
        stats.id,
        stats.calls,
        stats.completed,
        stats.spent,
        stats.unknownRisk,
        stats.activeMs,
        reason,
      );
    if (reason) this.block(id, reason);
    return this.stats(id);
  }
}
