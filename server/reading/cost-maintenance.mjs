import { sha256 } from "./material.mjs";
import { validateUsage, estimatedCost } from "./ledger.mjs";

const validId = (v) => typeof v === "string" && /^[\w:-]{1,160}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

// Host-only integration. The verifier resolves protected billing evidence;
// neither a user's JSON usage nor an operator-supplied hash proves nonbilling.
export class ReadingCostMaintenance {
  constructor(engine, authorize, verify) {
    if (typeof authorize !== "function" || typeof verify !== "function")
      throw Error("MAINTENANCE_EVIDENCE_AUTHORITY_REQUIRED");
    this.engine = engine;
    this.ledger = engine.ledger;
    this.db = engine.ledger.db;
    this.authorize = authorize;
    this.verify = verify;
  }
  authorizeActor(id, actor) {
    if (
      !validId(actor) ||
      this.authorize({
        account: this.engine.account,
        taskId: id,
        actor,
        operation: "reconcile-call-cost",
      }) !== true
    )
      throw Error("MAINTENANCE_FORBIDDEN");
  }
  preview(id, actor) {
    this.authorizeActor(id, actor);
    const task = this.engine.get(id);
    if (!task) throw Error("TASK_NOT_FOUND");
    const root = this.engine.roots.stats(id);
    const calls = this.db
      .prepare(
        `SELECT id,task,fingerprint,price,reserved,day,generation
      FROM reading_calls WHERE account=? AND state='unknown' ORDER BY rowid LIMIT 101`,
      )
      .all(this.engine.account);
    const linked = new Set(this.engine.roots.safety.tasks(root.id));
    return {
      taskId: id,
      rootTaskId: root.id,
      state: task.state,
      generation: task.generation,
      watermark: this.engine.roots.safety.latest(root.id).seq,
      ledgerSequence: this.ledger.sequence(this.engine.account),
      calls: root.calls,
      activeMs: root.activeMs,
      reason: root.reason || task.reason,
      spentMicros: this.ledger.wallet(this.engine.account).spent,
      unknownRiskMicros: this.ledger.wallet(this.engine.account).unknownRisk,
      unknownCalls: calls.slice(0, 100).filter((c) => linked.has(c.task)),
      hasMore: calls.length > 100,
    };
  }
  reconcile(id, request, actor) {
    this.authorizeActor(id, actor);
    if (
      !request ||
      Object.keys(request).sort().join(",") !==
        "callId,evidenceHash,expectedGeneration,expectedLedgerSequence,expectedWatermark,operationId" ||
      !validId(request.operationId) ||
      !validId(request.callId) ||
      !hash(request.evidenceHash) ||
      !integer(request.expectedGeneration) ||
      !integer(request.expectedLedgerSequence) ||
      !integer(request.expectedWatermark)
    )
      throw Error("INVALID_MAINTENANCE_REQUEST");
    const requestHash = sha256(
      JSON.stringify([
        this.engine.account,
        id,
        actor,
        request.callId,
        request.evidenceHash,
        request.operationId,
        request.expectedGeneration,
        request.expectedLedgerSequence,
        request.expectedWatermark,
      ]),
    );
    const prior = this.db
      .prepare(
        "SELECT * FROM reading_cost_audits WHERE account=? AND operation=?",
      )
      .get(this.engine.account, request.operationId);
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw Error("IDEMPOTENCY_CONFLICT");
      return prior;
    }
    const review = this.preview(id, actor);
    if (
      review.generation !== request.expectedGeneration ||
      review.watermark !== request.expectedWatermark ||
      review.ledgerSequence !== request.expectedLedgerSequence
    )
      throw Error("STALE_MAINTENANCE_REVIEW");
    if (
      this.engine.executions.size ||
      this.engine.controllers.size ||
      ["queued", "running", "applying"].includes(review.state) ||
      this.engine.db
        .prepare(
          "SELECT 1 FROM reading_tasks WHERE state IN ('queued','running','applying') LIMIT 1",
        )
        .get()
    )
      throw Error("TASK_STILL_DRAINING");
    const call = this.ledger.call(request.callId);
    if (
      !call ||
      call.account !== this.engine.account ||
      !this.engine.roots.safety.tasks(review.rootTaskId).includes(call.task)
    )
      throw Error("COST_CALL_NOT_OWNED");
    if (call.state !== "unknown") throw Error("COST_CALL_NOT_UNKNOWN");
    this.ledger.audit(this.engine.account);
    const proof = this.verify({
      account: this.engine.account,
      taskId: id,
      rootTaskId: review.rootTaskId,
      actor,
      evidenceHash: request.evidenceHash,
      call: { ...call },
    });
    if (proof && typeof proof.then === "function") {
      Promise.resolve(proof).catch(() => {});
      throw Error("INVALID_COST_EVIDENCE");
    }
    if (
      !proof ||
      Object.keys(proof).sort().join(",") !==
        "account,callId,disposition,evidenceHash,final,fingerprint,priceId,reference,usage" ||
      proof.account !== call.account ||
      proof.callId !== call.id ||
      proof.fingerprint !== call.fingerprint ||
      proof.priceId !== call.price ||
      proof.evidenceHash !== request.evidenceHash ||
      proof.final !== true ||
      !validId(proof.reference) ||
      !["usage", "not-billed"].includes(proof.disposition)
    )
      throw Error("INVALID_COST_EVIDENCE");
    let usage = null;
    if (proof.disposition === "usage") usage = validateUsage(proof.usage);
    else if (proof.usage !== null) throw Error("INVALID_COST_EVIDENCE");
    const proofHash = sha256(
      JSON.stringify([
        proof.account,
        proof.callId,
        proof.fingerprint,
        proof.priceId,
        proof.evidenceHash,
        proof.reference,
        proof.disposition,
        usage,
        proof.final,
      ]),
    );
    const underReserved =
      usage &&
      estimatedCost(this.ledger.price(call.price), usage) > call.reserved;
    try {
      return this.ledger.transaction(() => {
        if (
          this.engine.get(id)?.generation !== review.generation ||
          this.engine.get(id)?.state !== review.state ||
          this.engine.roots.safety.latest(review.rootTaskId).seq !==
            review.watermark ||
          this.ledger.sequence(this.engine.account) !== review.ledgerSequence
        )
          throw Error("STALE_MAINTENANCE_REVIEW");
        if (
          this.engine.db
            .prepare(
              "SELECT 1 FROM reading_tasks WHERE state IN ('queued','running','applying') LIMIT 1",
            )
            .get()
        )
          throw Error("TASK_STILL_DRAINING");
        const current = this.ledger.call(call.id);
        if (
          current.state !== "unknown" ||
          current.fingerprint !== call.fingerprint
        )
          throw Error("COST_CALL_NOT_UNKNOWN");
        if (
          this.db
            .prepare(
              "SELECT 1 FROM reading_calls WHERE account=? AND state='sent' LIMIT 1",
            )
            .get(this.engine.account)
        )
          throw Error("TASK_STILL_DRAINING");
        const before = this.ledger.wallet(this.engine.account).spent;
        if (usage) this.ledger.settleLocked(call.id, usage);
        else {
          this.db
            .prepare("UPDATE reading_calls SET state='released' WHERE id=?")
            .run(call.id);
          this.ledger.event(
            "cost-release:" + call.id,
            "reconcile-release",
            this.engine.account,
            call.id,
            call.reserved,
          );
        }
        const after = this.ledger.call(call.id);
        this.db
          .prepare(
            `INSERT INTO reading_cost_audits(account,operation,root,task,call_id,actor,evidence_hash,
        reference,disposition,request_hash,proof_hash,ledger_sequence,watermark,generation,spent_before,spent_after,actual,usage,at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            this.engine.account,
            request.operationId,
            review.rootTaskId,
            id,
            call.id,
            actor,
            request.evidenceHash,
            proof.reference,
            proof.disposition,
            requestHash,
            proofHash,
            review.ledgerSequence,
            review.watermark,
            review.generation,
            before,
            this.ledger.wallet(this.engine.account).spent,
            after.actual,
            after.usage,
            this.ledger.now(),
          );
        return this.db
          .prepare(
            "SELECT * FROM reading_cost_audits WHERE account=? AND operation=?",
          )
          .get(this.engine.account, request.operationId);
      });
    } catch (error) {
      // A verified cost above the envelope is a global pricing fault even if
      // writing its audit fails; do not let rollback reopen other accounts.
      if (underReserved)
        this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
      throw error;
    }
  }
}
