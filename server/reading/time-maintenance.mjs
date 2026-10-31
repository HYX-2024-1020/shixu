import { sha256 } from "./material.mjs";

const validId = (v) => typeof v === "string" && /^[\w:-]{1,160}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const keys = (v, expected) => v && Object.keys(v).sort().join(",") === expected;

// Host-only authority: evidence must prove every unresolved executor has ended
// and conservatively bound time missing from the persisted cumulative counter.
export class ReadingTimeMaintenance {
  constructor(engine, authorize, verify) {
    if (typeof authorize !== "function" || typeof verify !== "function")
      throw Error("MAINTENANCE_EVIDENCE_AUTHORITY_REQUIRED");
    Object.assign(this, { engine, authorize, verify, ledger: engine.ledger });
    this.db = engine.ledger.db;
  }
  authorizeActor(id, actor) {
    if (
      !validId(actor) ||
      this.authorize({
        account: this.engine.account,
        taskId: id,
        actor,
        operation: "reconcile-root-time",
      }) !== true
    )
      throw Error("MAINTENANCE_FORBIDDEN");
  }
  snapshot(id) {
    const root = this.engine.roots.forTask(id);
    if (!root) throw Error("TASK_NOT_FOUND");
    return {
      root: { ...root },
      tasks: this.engine.db
        .prepare(
          `SELECT id,generation,state,reason,calls,active_ms
        FROM reading_tasks WHERE packet=? ORDER BY id`,
        )
        .all(root.packet)
        .map((r) => ({ ...r })),
    };
  }
  steps(root) {
    return this.db
      .prepare(
        `SELECT s.* FROM reading_safe_steps s
      LEFT JOIN reading_safe_drains d ON d.step=s.id
      WHERE s.account=? AND s.root=? AND d.step IS NULL ORDER BY s.id`,
      )
      .all(this.engine.account, root)
      .map((r) => ({ ...r }));
  }
  preview(id, actor) {
    this.authorizeActor(id, actor);
    const task = this.engine.get(id);
    if (!task) throw Error("TASK_NOT_FOUND");
    const root = this.engine.roots.stats(id),
      snapshot = this.snapshot(id);
    return {
      taskId: id,
      rootTaskId: root.id,
      generation: task.generation,
      watermark: this.engine.roots.safety.latest(root.id).seq,
      ledgerSequence: this.ledger.sequence(this.engine.account),
      snapshotHash: sha256(JSON.stringify(snapshot)),
      activeMs: root.activeMs,
      calls: root.calls,
      completed: root.completed,
      checkpointCalls: root.checkpointCalls,
      reason: root.reason,
      steps: this.steps(root.id),
      snapshot,
    };
  }
  quiescent() {
    if (
      this.engine.executions.size ||
      this.engine.controllers.size ||
      this.engine.db
        .prepare(
          "SELECT 1 FROM reading_tasks WHERE state IN ('queued','running','applying') LIMIT 1",
        )
        .get()
    )
      throw Error("TASK_STILL_DRAINING");
    this.ledger.audit(this.engine.account);
    const wallet = this.ledger.wallet(this.engine.account);
    if (wallet.pausedReason) throw Error(wallet.pausedReason);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM reading_calls WHERE account=? AND state IN ('sent','unknown') LIMIT 1",
        )
        .get(this.engine.account)
    )
      throw Error("UNKNOWN_COST");
  }
  reconcile(id, request, actor) {
    this.authorizeActor(id, actor);
    if (
      !keys(
        request,
        "evidenceHash,expectedGeneration,expectedLedgerSequence,expectedWatermark,operationId",
      ) ||
      !validId(request.operationId) ||
      !integer(request.expectedGeneration) ||
      !integer(request.expectedWatermark) ||
      !integer(request.expectedLedgerSequence) ||
      typeof request.evidenceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(request.evidenceHash)
    )
      throw Error("INVALID_MAINTENANCE_REQUEST");
    const requestHash = sha256(
      JSON.stringify([
        this.engine.account,
        id,
        actor,
        request.operationId,
        request.evidenceHash,
        request.expectedGeneration,
        request.expectedWatermark,
        request.expectedLedgerSequence,
      ]),
    );
    let receipt = this.db
      .prepare(
        "SELECT * FROM reading_time_audits WHERE account=? AND operation=?",
      )
      .get(this.engine.account, request.operationId);
    if (receipt) {
      if (receipt.request_hash !== requestHash)
        throw Error("IDEMPOTENCY_CONFLICT");
      if (
        this.db
          .prepare(
            "SELECT 1 FROM reading_time_finalizations WHERE account=? AND operation=?",
          )
          .get(this.engine.account, receipt.operation)
      )
        return receipt;
      this.quiescent();
      return this.project(receipt);
    }
    const review = this.preview(id, actor);
    if (
      review.generation !== request.expectedGeneration ||
      review.watermark !== request.expectedWatermark ||
      review.ledgerSequence !== request.expectedLedgerSequence
    )
      throw Error("STALE_MAINTENANCE_REVIEW");
    this.quiescent();
    if (
      this.db
        .prepare(
          `SELECT 1 FROM reading_time_audits a LEFT JOIN reading_time_finalizations f
      ON f.account=a.account AND f.operation=a.operation WHERE a.account=? AND f.operation IS NULL LIMIT 1`,
        )
        .get(this.engine.account)
    )
      throw Error("TIME_AUDIT_PENDING");
    if (
      review.reason !== "ACTIVE_TIME_RECONCILIATION" ||
      review.snapshot.root.id !== review.rootTaskId ||
      !["", "ACTIVE_TIME_RECONCILIATION"].includes(review.snapshot.root.reason)
    )
      throw Error("TIME_AUDIT_NOT_APPLICABLE");
    // ACTIVE_TIME has display priority over rollback: never let it hide a lower
    // tenant counter or another checkpoint/safety gate during this audit.
    const rawActive = review.snapshot.tasks.reduce(
      (n, t) => n + t.active_ms,
      0,
    );
    const completed = this.engine.db
      .prepare("SELECT COUNT(*) n FROM reading_root_progress WHERE root=?")
      .get(review.rootTaskId).n;
    const checkpoint = this.engine.db
      .prepare(
        "SELECT COALESCE(MAX(calls),0) n FROM reading_root_checkpoints WHERE root=?",
      )
      .get(review.rootTaskId).n;
    if (
      rawActive !== review.activeMs ||
      completed !== review.completed ||
      checkpoint !== review.checkpointCalls ||
      this.db
        .prepare(
          "SELECT 1 FROM reading_safe_events WHERE account=? AND root=? AND reason='SAFETY_RECONCILIATION' LIMIT 1",
        )
        .get(this.engine.account, review.rootTaskId) ||
      review.snapshot.tasks.some(
        (t) =>
          ![
            "",
            "RESTARTED",
            "SHUTDOWN_TIME_UNCERTAIN",
            "ACTIVE_TIME_RECONCILIATION",
          ].includes(t.reason),
      )
    )
      throw Error("SAFETY_RECONCILIATION");
    const proof = this.verify({
      account: this.engine.account,
      actor,
      evidenceHash: request.evidenceHash,
      review: structuredClone(review),
    });
    if (proof && typeof proof.then === "function") {
      Promise.resolve(proof).catch(() => {});
      throw Error("INVALID_TIME_EVIDENCE");
    }
    if (
      !keys(
        proof,
        "account,additionalActiveMs,evidenceHash,final,generation,reference,rootTaskId,snapshotHash,stepIds,watermark",
      ) ||
      proof.account !== this.engine.account ||
      proof.rootTaskId !== review.rootTaskId ||
      proof.generation !== review.generation ||
      proof.watermark !== review.watermark ||
      proof.snapshotHash !== review.snapshotHash ||
      proof.evidenceHash !== request.evidenceHash ||
      proof.final !== true ||
      !validId(proof.reference) ||
      !integer(proof.additionalActiveMs) ||
      !Number.isSafeInteger(rawActive + proof.additionalActiveMs) ||
      !Array.isArray(proof.stepIds) ||
      JSON.stringify(proof.stepIds) !==
        JSON.stringify(review.steps.map((s) => s.id))
    )
      throw Error("INVALID_TIME_EVIDENCE");
    const target = structuredClone(review.snapshot);
    target.root.reason = "";
    target.tasks.find((t) => t.id === id).active_ms += proof.additionalActiveMs;
    for (const task of target.tasks)
      if (
        ["SHUTDOWN_TIME_UNCERTAIN", "ACTIVE_TIME_RECONCILIATION", "RESTARTED"].includes(
          task.reason,
        )
      )
        task.reason = "";
    receipt = this.ledger.transaction(() => {
      if (
        JSON.stringify(this.snapshot(id)) !== JSON.stringify(review.snapshot) ||
        this.engine.roots.safety.latest(review.rootTaskId).seq !==
          review.watermark ||
        this.ledger.sequence(this.engine.account) !== review.ledgerSequence ||
        JSON.stringify(this.steps(review.rootTaskId)) !==
          JSON.stringify(review.steps)
      )
        throw Error("STALE_MAINTENANCE_REVIEW");
      this.quiescent();
      this.db
        .prepare(
          `INSERT INTO reading_time_audits(account,operation,root,task,actor,evidence_hash,
        reference,request_hash,proof_hash,watermark,ledger_sequence,generation,before_snapshot,target_snapshot,
        active_ms,calls,completed,checkpoint_calls,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          this.engine.account,
          request.operationId,
          review.rootTaskId,
          id,
          actor,
          request.evidenceHash,
          proof.reference,
          requestHash,
          sha256(JSON.stringify(proof)),
          review.watermark,
          review.ledgerSequence,
          review.generation,
          JSON.stringify(review.snapshot),
          JSON.stringify(target),
          rawActive + proof.additionalActiveMs,
          review.calls,
          review.completed,
          review.checkpointCalls,
          this.ledger.now(),
        );
      for (const step of review.steps)
        this.db
          .prepare("INSERT INTO reading_safe_drains VALUES(?,?)")
          .run(step.id, this.ledger.now());
      return this.db
        .prepare(
          "SELECT * FROM reading_time_audits WHERE account=? AND operation=?",
        )
        .get(this.engine.account, request.operationId);
    });
    return this.project(receipt);
  }
  project(receipt) {
    // Cross-database commit is deliberately staged: receipt/drains first,
    // tenant metadata second, and only then an independent gate release.
    const target = JSON.parse(receipt.target_snapshot);
    this.engine.transaction(() => {
      const current = JSON.stringify(this.snapshot(receipt.task));
      if (current === receipt.target_snapshot) return;
      if (current !== receipt.before_snapshot)
        throw Error("STALE_MAINTENANCE_REVIEW");
      for (const t of target.tasks)
        this.engine.db
          .prepare("UPDATE reading_tasks SET active_ms=?,reason=? WHERE id=?")
          .run(t.active_ms, t.reason, t.id);
      this.engine.db
        .prepare("UPDATE reading_roots SET reason='' WHERE id=?")
        .run(target.root.id);
    });
    return this.ledger.transaction(() => {
      this.quiescent();
      if (
        JSON.stringify(this.snapshot(receipt.task)) !==
          receipt.target_snapshot ||
        this.steps(receipt.root).length ||
        this.ledger.sequence(this.engine.account) !== receipt.ledger_sequence
      )
        throw Error("STALE_MAINTENANCE_REVIEW");
      const before = this.engine.roots.safety.latest(receipt.root);
      if (
        before.calls !== receipt.calls ||
        before.completed !== receipt.completed ||
        before.checkpoint_calls !== receipt.checkpoint_calls ||
        before.active_ms > receipt.active_ms ||
        !["ACTIVE_TIME_RECONCILIATION", ""].includes(before.reason)
      )
        throw Error("SAFETY_RECONCILIATION");
      this.db
        .prepare(
          `INSERT INTO reading_safe_events(account,root,calls,active_ms,completed,checkpoint_calls,reason,at)
        VALUES(?,?,?,?,?,?,'',?)`,
        )
        .run(
          this.engine.account,
          receipt.root,
          receipt.calls,
          receipt.active_ms,
          receipt.completed,
          receipt.checkpoint_calls,
          this.ledger.now(),
        );
      this.db
        .prepare("INSERT INTO reading_time_finalizations VALUES(?,?,?)")
        .run(this.engine.account, receipt.operation, this.ledger.now());
      return receipt;
    });
  }
}
