import { sha256 } from "./material.mjs";

const validId = (value) =>
  typeof value === "string" && /^[\w:-]{1,160}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

// Trusted host integration only. No public HTTP dispatcher accepts an operator
// or a permission callback. The E administration adapter must supply authority.
export class ReadingMaintenance {
  constructor(engine, authorize) {
    if (typeof authorize !== "function")
      throw Error("MAINTENANCE_AUTHORITY_REQUIRED");
    this.engine = engine;
    this.ledger = engine.ledger;
    this.db = this.ledger.db;
    this.authorize = authorize;
  }
  authorizeActor(id, actor) {
    if (
      !validId(actor) ||
      this.authorize({
        account: this.engine.account,
        taskId: id,
        actor,
        operation: "extend-root-time",
      }) !== true
    )
      throw Error("MAINTENANCE_FORBIDDEN");
  }
  preview(id, actor) {
    this.authorizeActor(id, actor);
    const task = this.engine.get(id);
    if (!task) throw Error("TASK_NOT_FOUND");
    const root = this.engine.roots.stats(id);
    return {
      state: task.state,
      taskId: id,
      rootTaskId: root.id,
      generation: task.generation,
      watermark: this.engine.roots.safety.latest(root.id).seq,
      activeMs: root.activeMs,
      calls: root.calls,
      reason: root.reason || task.reason,
      limitMs: this.engine.executionLimit(id),
      spentMicros: root.spent,
      unknownRiskMicros: root.unknownRisk,
    };
  }
  extend(id, request, actor) {
    this.authorizeActor(id, actor);
    if (
      !request ||
      Object.keys(request).sort().join(",") !==
        "evidenceHash,expectedGeneration,expectedWatermark,newLimitMs,operationId" ||
      !validId(request.operationId) ||
      !integer(request.expectedGeneration) ||
      !integer(request.expectedWatermark) ||
      !integer(request.newLimitMs) ||
      typeof request.evidenceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(request.evidenceHash)
    )
      throw Error("INVALID_MAINTENANCE_REQUEST");
    const hash = sha256(
      JSON.stringify([
        id,
        actor,
        request.operationId,
        request.expectedGeneration,
        request.expectedWatermark,
        request.newLimitMs,
        request.evidenceHash,
      ]),
    );
    const prior = this.db
      .prepare(
        "SELECT * FROM reading_safe_limit_audits WHERE account=? AND operation=?",
      )
      .get(this.engine.account, request.operationId);
    if (prior) {
      if (prior.request_hash !== hash) throw Error("IDEMPOTENCY_CONFLICT");
      return prior;
    }
    const preview = this.preview(id, actor);
    if (
      preview.generation !== request.expectedGeneration ||
      preview.watermark !== request.expectedWatermark
    )
      throw Error("STALE_MAINTENANCE_REVIEW");
    if (this.engine.executions.size || this.engine.controllers.size)
      throw Error("TASK_STILL_DRAINING");
    if (!["paused","interrupted","cancelled","error"].includes(preview.state)) throw Error("INVALID_MAINTENANCE_TASK_STATE");
    if (this.engine.roots.stats(id).reason)
      throw Error("RECONCILIATION_REQUIRED");
    if (preview.activeMs < preview.limitMs)
      throw Error("EXECUTION_LIMIT_NOT_REACHED");
    if (
      request.newLimitMs <= preview.limitMs ||
      request.newLimitMs <= preview.activeMs
    )
      throw Error("INVALID_MAINTENANCE_LIMIT");
    this.ledger.audit(this.engine.account);
    return this.ledger.transaction(() => {
      const committed = this.db
        .prepare(
          "SELECT * FROM reading_safe_limit_audits WHERE account=? AND operation=?",
        )
        .get(this.engine.account, request.operationId);
      if (committed) {
        if (committed.request_hash !== hash)
          throw Error("IDEMPOTENCY_CONFLICT");
        return committed;
      }
      if (
        this.engine.roots.safety.latest(preview.rootTaskId).seq !==
          request.expectedWatermark ||
        this.engine.get(id).generation !== request.expectedGeneration ||
        this.engine.get(id).state !== preview.state ||
        this.engine.executionLimit(id) !== preview.limitMs
      )
        throw Error("STALE_MAINTENANCE_REVIEW");
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
      if (
        this.db
          .prepare(
            `SELECT 1 FROM reading_safe_steps s LEFT JOIN reading_safe_drains d ON d.step=s.id
        WHERE s.account=? AND s.root=? AND d.step IS NULL LIMIT 1`,
          )
          .get(this.engine.account, preview.rootTaskId)
      )
        throw Error("ACTIVE_TIME_RECONCILIATION");
      this.db
        .prepare(
          `INSERT INTO reading_safe_limit_audits
        (account,operation,root,task,actor,evidence_hash,watermark,generation,previous_limit,new_limit,active_ms,calls,request_hash,at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          this.engine.account,
          request.operationId,
          preview.rootTaskId,
          id,
          actor,
          request.evidenceHash,
          request.expectedWatermark,
          request.expectedGeneration,
          preview.limitMs,
          request.newLimitMs,
          preview.activeMs,
          preview.calls,
          hash,
          this.ledger.now(),
        );
      return this.db
        .prepare(
          "SELECT * FROM reading_safe_limit_audits WHERE account=? AND operation=?",
        )
        .get(this.engine.account, request.operationId);
    });
  }
}
