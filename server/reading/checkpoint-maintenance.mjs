import { sha256 } from "./material.mjs";
import { ReadingTimeMaintenance } from "./time-maintenance.mjs";

const gates = ["CHECKPOINT_NO_PROGRESS", "CHECKPOINT_RECONCILIATION"];
const validId = (v) => typeof v === "string" && /^[\w:-]{1,160}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const keys = (v, expected) => v && Object.keys(v).sort().join(",") === expected;

// Host-only review of a stopped checkpoint. An independent verifier must
// explicitly authorize another interval; this never invents successful blocks.
export class ReadingCheckpointMaintenance extends ReadingTimeMaintenance {
  authorizeActor(id, actor) {
    if (
      !validId(actor) ||
      this.authorize({
        account: this.engine.account,
        taskId: id,
        actor,
        operation: "reconcile-root-checkpoint",
      }) !== true
    )
      throw Error("MAINTENANCE_FORBIDDEN");
  }
  snapshot(id) {
    const snapshot = super.snapshot(id);
    const root = snapshot.root.id;
    return {
      ...snapshot,
      checkpoints: this.engine.db
        .prepare(
          "SELECT * FROM reading_root_checkpoints WHERE root=? ORDER BY calls",
        )
        .all(root)
        .map((r) => ({ ...r })),
      progress: this.engine.db
        .prepare(
          "SELECT fingerprint FROM reading_root_progress WHERE root=? ORDER BY fingerprint",
        )
        .all(root)
        .map((r) => r.fingerprint),
    };
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
        "SELECT * FROM reading_checkpoint_audits WHERE account=? AND operation=?",
      )
      .get(this.engine.account, request.operationId);
    if (receipt) {
      if (receipt.request_hash !== requestHash)
        throw Error("IDEMPOTENCY_CONFLICT");
      if (
        this.db
          .prepare(
            "SELECT 1 FROM reading_checkpoint_finalizations WHERE account=? AND operation=?",
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
          `SELECT 1 FROM reading_checkpoint_audits a LEFT JOIN reading_checkpoint_finalizations f
      ON f.account=a.account AND f.operation=a.operation WHERE a.account=? AND f.operation IS NULL LIMIT 1`,
        )
        .get(this.engine.account)
    )
      throw Error("CHECKPOINT_AUDIT_PENDING");
    if (
      !gates.includes(review.reason) ||
      !gates.includes(review.snapshot.root.reason) ||
      review.snapshot.root.id !== review.rootTaskId ||
      review.calls < 24 ||
      review.steps.length ||
      !review.snapshot.tasks.every(
        (t) =>
          [
            "paused",
            "interrupted",
            "cancelled",
            "error",
            "done",
            "partial",
            "purged",
            "conflict",
          ].includes(t.state) && ["", ...gates, "RESTARTED"].includes(t.reason),
      )
    )
      throw Error("CHECKPOINT_AUDIT_NOT_APPLICABLE");
    // Preserve independent watermarks; this operation cannot fix a rollback,
    // missing paid result, unknown time or unknown bill under a checkpoint label.
    if (
      review.snapshot.tasks.reduce((n, t) => n + t.active_ms, 0) !==
        review.activeMs ||
      review.snapshot.progress.length !== review.completed ||
      Math.max(
        0,
        ...review.snapshot.checkpoints.map((c) => c.calls),
        this.engine.roots.safety.lastCheckpointAudit(review.rootTaskId)
          ?.calls || 0,
      ) !== review.checkpointCalls ||
      this.db
        .prepare(
          "SELECT 1 FROM reading_safe_events WHERE account=? AND root=? AND reason='SAFETY_RECONCILIATION' LIMIT 1",
        )
        .get(this.engine.account, review.rootTaskId)
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
      throw Error("INVALID_CHECKPOINT_EVIDENCE");
    }
    if (
      !keys(
        proof,
        "account,disposition,evidenceHash,final,generation,reason,reference,rootTaskId,snapshotHash,watermark",
      ) ||
      proof.account !== this.engine.account ||
      proof.rootTaskId !== review.rootTaskId ||
      proof.generation !== review.generation ||
      proof.watermark !== review.watermark ||
      proof.snapshotHash !== review.snapshotHash ||
      proof.evidenceHash !== request.evidenceHash ||
      proof.reason !== review.reason ||
      proof.disposition !== "resume-next-checkpoint" ||
      proof.final !== true ||
      !validId(proof.reference)
    )
      throw Error("INVALID_CHECKPOINT_EVIDENCE");
    const target = structuredClone(review.snapshot);
    target.root.reason = "";
    for (const task of target.tasks)
      if (gates.includes(task.reason) || task.reason === "RESTARTED")
        task.reason = "";
    receipt = this.ledger.transaction(() => {
      if (
        JSON.stringify(this.snapshot(id)) !== JSON.stringify(review.snapshot) ||
        this.engine.roots.safety.latest(review.rootTaskId).seq !==
          review.watermark ||
        this.ledger.sequence(this.engine.account) !== review.ledgerSequence ||
        this.steps(review.rootTaskId).length
      )
        throw Error("STALE_MAINTENANCE_REVIEW");
      this.quiescent();
      this.db
        .prepare(
          "INSERT INTO reading_checkpoint_audits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
          review.calls,
          review.activeMs,
          review.completed,
          review.checkpointCalls,
          review.reason,
          this.ledger.now(),
        );
      return this.db
        .prepare(
          "SELECT * FROM reading_checkpoint_audits WHERE account=? AND operation=?",
        )
        .get(this.engine.account, request.operationId);
    });
    return this.project(receipt);
  }
  project(receipt) {
    const target = JSON.parse(receipt.target_snapshot);
    this.engine.transaction(() => {
      const current = JSON.stringify(this.snapshot(receipt.task));
      if (current === receipt.target_snapshot) return;
      if (current !== receipt.before_snapshot)
        throw Error("STALE_MAINTENANCE_REVIEW");
      for (const t of target.tasks)
        this.engine.db
          .prepare("UPDATE reading_tasks SET reason=? WHERE id=?")
          .run(t.reason, t.id);
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
        before.active_ms !== receipt.active_ms ||
        before.completed !== receipt.completed ||
        before.checkpoint_calls !== receipt.checkpoint_calls ||
        ![receipt.reason, ""].includes(before.reason)
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
          receipt.calls,
          this.ledger.now(),
        );
      this.db
        .prepare("INSERT INTO reading_checkpoint_finalizations VALUES(?,?,?)")
        .run(this.engine.account, receipt.operation, this.ledger.now());
      return receipt;
    });
  }
}
