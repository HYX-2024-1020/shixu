import { sha256 } from "./material.mjs";
import { windowCoverageHash, windowRowHash } from "./window-safety.mjs";
import { ReadingTimeMaintenance } from "./time-maintenance.mjs";
const validId = (v) => typeof v === "string" && /^[\w:-]{1,160}$/.test(v);
const keys = (v, s) => v && Object.keys(v).sort().join() === s;
const reason = "WINDOW_STATE_RECONCILIATION";
export class ReadingWindowMaintenance extends ReadingTimeMaintenance {
  authorizeActor(id, actor) {
    if (
      !validId(actor) ||
      this.authorize({
        account: this.engine.account,
        taskId: id,
        actor,
        operation: "reconcile-window-state",
      }) !== true
    )
      throw Error("MAINTENANCE_FORBIDDEN");
  }
  snapshot(id) {
    const value = super.snapshot(id),
      s = this.engine.windows.safety;
    return {
      ...value,
      coverageViews: value.tasks.map((t) => {
        const v = s.view(t.id);
        return {
          task: t.id,
          view: v?.seq || 0,
          committed: !!v?.committed,
          expectedHash: v?.next_hash || null,
          currentHash: windowCoverageHash(this.engine.get(t.id).coverage),
        };
      }),
      windows: value.tasks.flatMap((t) =>
        s.anchors(t.id).map((a) => {
          const receipt = s.latest(t.id, a.attachment),
            row = this.engine.db
              .prepare(
                "SELECT * FROM reading_windows WHERE task=? AND attachment=?",
              )
              .get(t.id, a.attachment);
          return {
            task: t.id,
            attachment: a.attachment,
            revision: a.revision,
            contentHash: a.content_hash,
            receipt: receipt?.seq || 0,
            committed: !!receipt?.committed,
            currentHash: windowRowHash(row),
            expectedHash: receipt?.next_hash || "empty",
            purged: !!s.purged(t.id),
          };
        }),
      ),
    };
  }
  restoreCoverage(id, coverage, actor) {
    this.authorizeActor(id, actor);
    this.quiescent();
    const s = this.engine.windows.safety,
      view = s.view(id),
      task = this.engine.get(id);
    if (
      !task ||
      task.state === "purged" ||
      s.purged(id) ||
      !view ||
      view.revision !== task.input_revision ||
      windowCoverageHash(coverage) !== view.next_hash
    )
      throw Error("UNTRUSTED_WINDOW_RESTORE");
    this.engine.db
      .prepare("UPDATE reading_tasks SET coverage=? WHERE id=?")
      .run(JSON.stringify(coverage), id);
    s.confirmCoverage(id);
    return { restored: 1, queued: false };
  }
  resetInitial(id, attachment, actor) {
    this.authorizeActor(id, actor);
    this.quiescent();
    const s = this.engine.windows.safety,
      task = this.engine.get(id),
      anchor = s.anchors(id).find((a) => a.attachment === attachment);
    if (
      !anchor ||
      !task ||
      task.state === "purged" ||
      s.purged(id) ||
      anchor.revision !== task.input_revision ||
      s.latest(id, attachment)
    )
      throw Error("UNTRUSTED_WINDOW_RESTORE");
    this.engine.db
      .prepare("DELETE FROM reading_windows WHERE task=? AND attachment=?")
      .run(id, attachment);
    return { restored: 1, queued: false };
  }
  restoreRows(id, rows, actor) {
    this.authorizeActor(id, actor);
    this.quiescent();
    if (!Array.isArray(rows) || !rows.length || rows.length > 20)
      throw Error("INVALID_WINDOW_RESTORE");
    const s = this.engine.windows.safety,
      root = this.engine.roots.forTask(id).id,
      seen = new Set();
    this.engine.transaction(() => {
      for (const row of rows) {
        if (
          !keys(
            row,
            "attachment,content_hash,coverage,next_offset,next_page,task",
          ) ||
          !validId(row.task) ||
          !validId(row.attachment) ||
          seen.has(row.task + ":" + row.attachment)
        )
          throw Error("INVALID_WINDOW_RESTORE");
        seen.add(row.task + ":" + row.attachment);
        const task = this.engine.get(row.task),
          anchor = s
            .anchors(row.task)
            .find((a) => a.attachment === row.attachment),
          receipt = s.latest(row.task, row.attachment);
        if (
          !task ||
          task.state === "purged" ||
          s.purged(row.task) ||
          !anchor ||
          anchor.root !== root ||
          anchor.revision !== task.input_revision ||
          !receipt ||
          windowRowHash(row) !== receipt.next_hash
        )
          throw Error("UNTRUSTED_WINDOW_RESTORE");
        this.engine.db
          .prepare("INSERT OR REPLACE INTO reading_windows VALUES(?,?,?,?,?,?)")
          .run(
            row.task,
            row.attachment,
            row.content_hash,
            row.next_page,
            row.next_offset,
            row.coverage,
          );
      }
    });
    for (const row of rows) s.confirm(row.task);
    return { restored: rows.length, queued: false };
  }
  reconcile(id, request, actor) {
    this.authorizeActor(id, actor);
    if (
      !keys(
        request,
        "evidenceHash,expectedGeneration,expectedLedgerSequence,expectedWatermark,operationId",
      ) ||
      !validId(request.operationId) ||
      ![
        "expectedGeneration",
        "expectedLedgerSequence",
        "expectedWatermark",
      ].every((k) => Number.isSafeInteger(request[k]) && request[k] >= 0) ||
      !/^[a-f0-9]{64}$/.test(request.evidenceHash || "")
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
      ),
      s = this.engine.windows.safety;
    let receipt = this.db
      .prepare(
        "SELECT * FROM reading_window_audits WHERE account=? AND operation=?",
      )
      .get(this.engine.account, request.operationId);
    if (receipt) {
      if (receipt.request_hash !== requestHash)
        throw Error("IDEMPOTENCY_CONFLICT");
      if (
        this.db
          .prepare(
            "SELECT 1 FROM reading_window_finalizations WHERE account=? AND operation=?",
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
    s.assertRoot(id, { latch: false });
    if (
      review.reason !== reason ||
      !["", reason].includes(review.snapshot.root.reason) ||
      review.steps.length ||
      review.snapshot.tasks.some(
        (t) => !["", reason, "RESTARTED"].includes(t.reason),
      ) ||
      review.snapshot.tasks.reduce((n, t) => n + t.active_ms, 0) !==
        review.activeMs
    )
      throw Error("WINDOW_AUDIT_NOT_APPLICABLE");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM reading_window_audits a LEFT JOIN reading_window_finalizations f ON f.account=a.account AND f.operation=a.operation WHERE a.account=? AND f.operation IS NULL LIMIT 1",
        )
        .get(this.engine.account)
    )
      throw Error("WINDOW_AUDIT_PENDING");
    const proof = this.verify({
      account: this.engine.account,
      actor,
      evidenceHash: request.evidenceHash,
      review: structuredClone(review),
    });
    if (proof && typeof proof.then === "function") {
      Promise.resolve(proof).catch(() => {});
      throw Error("INVALID_WINDOW_EVIDENCE");
    }
    if (
      !keys(
        proof,
        "account,evidenceHash,final,generation,reference,rootTaskId,snapshotHash,watermark",
      ) ||
      proof.account !== this.engine.account ||
      proof.evidenceHash !== request.evidenceHash ||
      proof.final !== true ||
      proof.generation !== review.generation ||
      proof.rootTaskId !== review.rootTaskId ||
      proof.snapshotHash !== review.snapshotHash ||
      proof.watermark !== review.watermark ||
      !validId(proof.reference)
    )
      throw Error("INVALID_WINDOW_EVIDENCE");
    const target = structuredClone(review.snapshot);
    target.root.reason = "";
    for (const t of target.tasks)
      if ([reason, "RESTARTED"].includes(t.reason)) t.reason = "";
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
      s.assertRoot(id, { latch: false });
      this.db
        .prepare(
          "INSERT INTO reading_window_audits VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
          JSON.stringify(review.snapshot),
          JSON.stringify(target),
          this.ledger.now(),
        );
      return this.db
        .prepare(
          "SELECT * FROM reading_window_audits WHERE account=? AND operation=?",
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
      this.engine.windows.safety.assertRoot(receipt.task, { latch: false });
      if (
        JSON.stringify(this.snapshot(receipt.task)) !==
          receipt.target_snapshot ||
        this.ledger.sequence(this.engine.account) !== receipt.ledger_sequence ||
        this.steps(receipt.root).length
      )
        throw Error("STALE_MAINTENANCE_REVIEW");
      const before = this.engine.roots.safety.latest(receipt.root),
        tasks = target.tasks;
      if (
        ![reason, ""].includes(before.reason) ||
        before.calls < 0 ||
        tasks.reduce((n, t) => n + t.active_ms, 0) !== before.active_ms ||
        this.engine.db
          .prepare("SELECT COUNT(*) n FROM reading_root_progress WHERE root=?")
          .get(receipt.root).n !== before.completed
      )
        throw Error("SAFETY_RECONCILIATION");
      this.db
        .prepare(
          "INSERT INTO reading_safe_events(account,root,calls,active_ms,completed,checkpoint_calls,reason,at) VALUES(?,?,?,?,?,?,'',?)",
        )
        .run(
          this.engine.account,
          receipt.root,
          before.calls,
          before.active_ms,
          before.completed,
          before.checkpoint_calls,
          this.ledger.now(),
        );
      this.db
        .prepare("INSERT INTO reading_window_finalizations VALUES(?,?,?)")
        .run(this.engine.account, receipt.operation, this.ledger.now());
      return receipt;
    });
  }
}
