import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { SyncError } from "../sync-store.mjs";
import { validateResult } from "../generated/ai-core.mjs";
import {
  coverageOnly,
  modelMaterial,
  modelBatches,
  sha256,
  READER_VERSION,
  NORMALIZATION_VERSION,
} from "./material.mjs";
import { validateUsage } from "./ledger.mjs";
import { ReadingRoots } from "./roots.mjs";
import { ReadingReuse } from "./reuse.mjs";
import { ReadingWindows } from "./windows.mjs";

const active = ["queued", "running", "applying"];
const occupies = [...active, "paused", "interrupted", "error", "conflict"];
const validId = (v) => typeof v === "string" && /^[\w-]{1,90}$/.test(v);
const error = (code) =>
  new SyncError(
    409,
    code,
    code === "ACTIVE_TIME_RECONCILIATION"
      ? "任务活跃时间待核对，请联系维护者；已完成进度保留"
      : code === "STALE_TASK"
        ? "任务状态已变化，请刷新后再操作"
      : code === "EXECUTION_LIMIT"
        ? "该投递累计活跃时间已用尽，请联系维护者核对"
      : code === "SAFETY_RECONCILIATION"
        ? "资料进度与安全记录不一致，请联系维护者核对；累计费用与时间保留"
        : code === "SERVICE_CLOSING"
          ? "服务正在关闭，请稍后重试"
          : code,
  );
const versions = {
  reader: READER_VERSION,
  normalization: NORMALIZATION_VERSION,
  prompt: "reading/2-original-windows",
  schema: "bucket/1",
};

function validatePaidResult(raw, sources, date) {
  if (
    !raw ||
    Buffer.byteLength(JSON.stringify(raw)) > 1024 * 1024 ||
    !Array.isArray(raw.items) ||
    raw.items.length > 40 ||
    typeof raw.summary !== "string" ||
    raw.summary.length > 1600 ||
    !Array.isArray(raw.warnings) ||
    raw.warnings.length > 8
  )
    throw Error("INVALID_MODEL_OUTPUT");
  for (const item of raw.items) {
    if (
      !item ||
      typeof item.title !== "string" ||
      item.title.length > 150 ||
      typeof item.summary !== "string" ||
      item.summary.length > 2000
    )
      throw Error("INVALID_MODEL_OUTPUT");
    for (const [field, cap] of Object.entries({
      facts: 12,
      nextSteps: 8,
      uncertainties: 8,
      evidence: 8,
    }))
      if (!Array.isArray(item[field]) || item[field].length > cap)
        throw Error("INVALID_MODEL_OUTPUT");
    for (const quote of item.evidence) {
      const source = sources.find((s) => s.id === quote.sourceId);
      if (
        !source ||
        typeof quote.quote !== "string" ||
        quote.quote.length > 500 ||
        !source.text.includes(quote.quote)
      )
        throw Error("INVALID_MODEL_SOURCE");
    }
    for (const field of ["facts", "nextSteps", "uncertainties"])
      if (item[field].some((s) => typeof s !== "string" || s.length > 500))
        throw Error("INVALID_MODEL_OUTPUT");
  }
  return validateResult(raw, sources, date);
}

export function inputRevision(store, packetId) {
  const r = store.record(packetId);
  if (!r || r.purged || r.deletedAt) throw error("INPUT_DELETED");
  const files = (r.data.attachments || [])
    .filter((f) => !f.deletedAt)
    .map((f) => {
      // Authoritative original bytes, including on continue; a descriptor is not
      // proof that an original still exists or retains its hash.
      let original;
      try {
        original = store.files.get(packetId, f.id, { forReading: true });
      } catch (cause) {
        if (cause.code === "NOT_FOUND") throw error("REUPLOAD_REQUIRED");
        throw cause;
      }
      return {
        id: original.id,
        name: original.name,
        hash: original.hash,
        size: original.size,
      };
    });
  return sha256(
    JSON.stringify({
      text: (r.data.text || "").replace(/\r\n?/g, "\n"),
      captureDate: r.data.captureDate,
      files,
      versions,
    }),
  );
}

// Opt-in execution kernel. Existing v3 routes do NOT import or enable this
// module. A production v4 router/migration must supply authoritative account,
// device authorization and an independently reconciled ledger.
export class ReadingTasks {
  constructor({
    store,
    account,
    ledger,
    reader,
    provider,
    priceId,
    modelVersion,
    authorize,
    maxPromptTokens = 120000,
    maxOutputTokens = 4000,
    activeLimitMs = 1800000,
  }) {
    if (
      !account ||
      !reader ||
      !provider ||
      !modelVersion ||
      typeof authorize !== "function"
    )
      throw Error("READING_CONFIGURATION_REQUIRED");
    Object.assign(this, {
      store,
      account,
      ledger,
      reader,
      provider,
      priceId,
      modelVersion,
      authorize,
      maxPromptTokens,
      maxOutputTokens,
      activeLimitMs,
    });
    this.db = store.db;
    this.controllers = new Map();
    this.executions = new Map();
    this.finalSnapshots = null;
    this.materials = new Map();
    this.cacheTimers = new Map();
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS reading_tasks(id TEXT PRIMARY KEY,packet TEXT NOT NULL,device TEXT NOT NULL,
      input_revision TEXT NOT NULL,base_version INTEGER NOT NULL,generation INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',coverage TEXT NOT NULL DEFAULT '[]',calls INTEGER NOT NULL DEFAULT 0,active_ms INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_blocks(task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,
        result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_block_ranges(task TEXT NOT NULL,fingerprint TEXT NOT NULL,ranges TEXT NOT NULL,PRIMARY KEY(task,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_checkpoints(task TEXT NOT NULL,calls INTEGER NOT NULL,completed INTEGER NOT NULL,spent INTEGER NOT NULL,PRIMARY KEY(task,calls));
      CREATE TABLE IF NOT EXISTS reading_publications(task TEXT PRIMARY KEY,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_actions(operation TEXT PRIMARY KEY,task TEXT NOT NULL,action TEXT NOT NULL,generation INTEGER NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_action_audits(operation TEXT PRIMARY KEY,maintenance_operation TEXT);`);
    this.reuse = new ReadingReuse(this.db, ledger, account);
    this.windows = new ReadingWindows(this.db);
    this.roots = new ReadingRoots(store, ledger, account);
    this.db
      .prepare(
        "UPDATE reading_tasks SET state='interrupted',generation=generation+1,reason='RESTARTED' WHERE state IN ('running','applying')",
      )
      .run();
    const previous = store.validateOperation;
    store.validateOperation = (operation, internal) => {
      previous?.(operation, internal);
      const owner = this.db
        .prepare(
          "SELECT id,generation FROM reading_tasks WHERE packet=? AND state IN ('queued','running','applying')",
        )
        .get(operation.id);
      if (
        owner &&
        (internal.taskId !== owner.id ||
          internal.generation !== owner.generation)
      )
        throw error("INPUT_LOCKED");
    };
    const previousFileGuard = store.validateOriginalMutation;
    store.validateOriginalMutation = (packetId) => {
      previousFileGuard?.(packetId);
      if (
        this.db
          .prepare(
            "SELECT 1 FROM reading_tasks WHERE packet=? AND state IN ('queued','running','applying')",
          )
          .get(packetId)
      )
        throw error("INPUT_LOCKED");
    };
  }
  get(id) {
    if (this.finalSnapshots) return this.finalSnapshots.get(id);
    return this.db.prepare("SELECT * FROM reading_tasks WHERE id=?").get(id);
  }
  executionLimit(id) {
    const root = this.roots.forTask(id);
    return Math.max(
      this.activeLimitMs,
      this.roots.safety.lastLimit(root.id)?.new_limit || 0,
    );
  }
  auditedTimeAvailable(id) {
    const root=this.roots.stats(id);
    return !root.reason && !!this.roots.safety.lastLimit(root.id) && root.activeMs < this.executionLimit(id);
  }
  maintenanceOperation(id) {
    return this.roots.safety.lastLimit(this.roots.forTask(id).id)?.operation || null;
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  enqueue({ id, packetId, deviceId }) {
    if (this.finalSnapshots) throw error("SERVICE_CLOSING");
    this.authorize(deviceId);
    if (![id, packetId, deviceId].every(validId)) throw error("INVALID_TASK");
    return this.transaction(() => {
      const revision = inputRevision(this.store, packetId),
        prior = this.get(id);
      if (prior) {
        if (
          prior.packet !== packetId ||
          prior.device !== deviceId ||
          prior.input_revision !== revision
        )
          throw error("IDEMPOTENCY_CONFLICT");
        return prior;
      }
      if (this.store.files.unlinked(packetId))
        throw error("ATTACHMENT_UNLINKED");
      if (
        [...this.executions.keys()].some(
          (runningId) => this.get(runningId)?.packet === packetId,
        )
      )
        throw error("TASK_STILL_DRAINING");
      if (
        (this.store.record(packetId).data.attachments || [])
          .filter((f) => !f.deletedAt)
          .reduce((sum, f) => sum + f.size, 0) >
        20 * 1024 * 1024
      )
        throw error("UPLOAD_LIMIT");
      if (
        this.db
          .prepare(
            `SELECT 1 FROM reading_tasks WHERE state IN (${occupies.map(() => "?").join(",")})`,
          )
          .get(...occupies)
      )
        throw error("TASK_SLOT_FULL");
      this.db
        .prepare(
          "INSERT INTO reading_tasks(id,packet,device,input_revision,base_version,state) VALUES(?,?,?,?,?,'queued')",
        )
        .run(
          id,
          packetId,
          deviceId,
          revision,
          this.store.record(packetId).version,
        );
      this.roots.attach(this.get(id));
      return this.get(id);
    });
  }
  action(
    id,
    { operationId, expectedGeneration, expectedRevision, expectedMaintenanceOperation = null },
    action,
    deviceId,
  ) {
    if (this.finalSnapshots) throw error("SERVICE_CLOSING");
    const target = this.get(id);
    if (!target) throw error("TASK_NOT_FOUND");
    this.authorize(deviceId || target.device);
    if (
      !validId(operationId) ||
      !["stop", "continue", "purge", "accept-partial"].includes(action) ||
      (expectedMaintenanceOperation !== null && (typeof expectedMaintenanceOperation !== "string" || !/^[\w:-]{1,160}$/.test(expectedMaintenanceOperation)))
    )
      throw error("INVALID_ACTION");
    const value = this.transaction(() => {
      const previous = this.db
        .prepare("SELECT * FROM reading_actions WHERE operation=?")
        .get(operationId);
      if (previous) {
        if (
          previous.task !== id ||
          previous.action !== action ||
          previous.generation !== expectedGeneration ||
          JSON.parse(previous.response).input_revision !== expectedRevision ||
          (this.db.prepare("SELECT maintenance_operation FROM reading_action_audits WHERE operation=?").get(operationId)?.maintenance_operation || null) !== expectedMaintenanceOperation
        )
          throw error("IDEMPOTENCY_CONFLICT");
        return target.state === "purged"
          ? target
          : JSON.parse(previous.response);
      }
      const task = this.get(id);
      if (!task) throw error("TASK_NOT_FOUND");
      if (task.state === "purged") throw error("INVALID_TASK_TRANSITION");
      if (
        task.generation !== expectedGeneration ||
        task.input_revision !== expectedRevision
      )
        throw error("STALE_TASK");
      if (action === "continue" && expectedMaintenanceOperation !== this.maintenanceOperation(id))
        throw error("STALE_TASK");
      if (action === "accept-partial") {
        if (
          !["paused", "interrupted", "error", "conflict"].includes(task.state)
        )
          throw error("INVALID_TASK_TRANSITION");
        if (this.controllers.has(id)) throw error("TASK_STILL_DRAINING");
        if (inputRevision(this.store, task.packet) !== task.input_revision)
          throw error("INPUT_CHANGED");
        if (
          !this.db.prepare("SELECT 1 FROM reading_blocks WHERE task=?").get(id)
        )
          throw error("NO_COMPLETED_BLOCKS");
        // Publication must share the store transaction; defer it until below.
        return {
          ...task,
          acceptPartial: true,
          actingDevice: deviceId || task.device,
        };
      } else if (action === "purge") {
        this.reuse.purge(id);
        this.windows.purge(id);
        this.db.prepare("DELETE FROM reading_blocks WHERE task=?").run(id);
        this.db
          .prepare("DELETE FROM reading_block_ranges WHERE task=?")
          .run(id);
        this.ledger.db
          .prepare(
            "DELETE FROM reading_envelopes WHERE call IN (SELECT id FROM reading_calls WHERE account=? AND task=?)",
          )
          .run(this.account, id);
        this.db
          .prepare(
            "UPDATE reading_tasks SET generation=generation+1,state='purged',reason='',coverage='[]' WHERE id=?",
          )
          .run(id);
      } else if (action === "stop") {
        if (!["done", "partial", "cancelled"].includes(task.state))
          this.db
            .prepare(
              "UPDATE reading_tasks SET generation=generation+1,state='cancelled',reason=CASE WHEN reason='SHUTDOWN_TIME_UNCERTAIN' THEN reason ELSE '' END WHERE id=?",
            )
            .run(id);
      } else {
        const root = this.roots.stats(id);
        if (root.reason === "ACTIVE_TIME_RECONCILIATION")
          throw error("ACTIVE_TIME_RECONCILIATION");
        if (root.reason === "SAFETY_RECONCILIATION")
          throw error("SAFETY_RECONCILIATION");
        if (
          root.activeMs >= this.executionLimit(id) ||
          (task.reason === "EXECUTION_LIMIT" && !this.auditedTimeAvailable(id))
        )
          throw error("EXECUTION_LIMIT");
        if (
          !["cancelled", "paused", "interrupted", "error"].includes(task.state)
        )
          throw error("INVALID_TASK_TRANSITION");
        if (
          this.db
            .prepare(
              `SELECT 1 FROM reading_tasks WHERE id!=? AND state IN (${occupies.map(() => "?").join(",")})`,
            )
            .get(id, ...occupies)
        )
          throw error("TASK_SLOT_FULL");
        if (inputRevision(this.store, task.packet) !== task.input_revision)
          throw error("INPUT_CHANGED");
        this.ledger.audit(this.account);
        this.ledger.wallet(this.account);
        if (
          this.ledger.db
            .prepare(
              "SELECT 1 FROM reading_calls WHERE account=? AND state IN ('sent','unknown')",
            )
            .get(this.account)
        )
          throw error("UNKNOWN_COST");
        this.db
          .prepare(
            "UPDATE reading_tasks SET generation=generation+1,state='queued',reason='',base_version=?,device=? WHERE id=?",
          )
          .run(
            this.store.record(task.packet).version,
            deviceId || task.device,
            id,
          );
      }
      const response = this.get(id);
      this.db
        .prepare("INSERT INTO reading_actions VALUES(?,?,?,?,?)")
        .run(
          operationId,
          id,
          action,
          expectedGeneration,
          JSON.stringify(response),
        );
      this.db.prepare("INSERT INTO reading_action_audits VALUES(?,?)").run(operationId,expectedMaintenanceOperation);
      return response;
    });
    if (value.acceptPartial) {
      const task = { ...value, device: value.actingDevice };
      const response = this.publish(
        task,
        JSON.parse(task.coverage),
        true,
        () => {
          const response = this.get(id);
          this.db
            .prepare("INSERT INTO reading_actions VALUES(?,?,?,?,?)")
            .run(
              operationId,
              id,
              action,
              expectedGeneration,
              JSON.stringify(response),
            );
          this.db.prepare("INSERT INTO reading_action_audits VALUES(?,?)").run(operationId,expectedMaintenanceOperation);
        },
      );
      this.clearMaterial(id);
      return response;
    }
    if (action === "stop" || action === "purge") {
      this.controllers.get(id)?.abort();
      this.clearMaterial(id);
    }
    return value;
  }
  current(task) {
    const now = this.get(task.id);
    return now && now.state === "running" && now.generation === task.generation;
  }
  clearMaterial(id) {
    this.dropMaterial(id);
    if (this.get(id)?.state !== "queued")
      this.store.files.releaseWindow?.(this.get(id)?.packet);
  }
  dropMaterial(id) {
    clearTimeout(this.cacheTimers.get(id));
    this.cacheTimers.delete(id);
    this.materials.delete(id);
  }
  close() {
    if (this.finalSnapshots) return;
    this.db
      .prepare(
        "UPDATE reading_tasks SET state='interrupted',generation=generation+1,reason='SHUTDOWN' WHERE state='queued'",
      )
      .run();
    for (const [id, c] of this.controllers) {
      this.db
        .prepare(
          "UPDATE reading_tasks SET state='interrupted',generation=generation+1,reason='SHUTDOWN' WHERE id=? AND state IN ('running','applying')",
        )
        .run(id);
      c.abort();
    }
    for (const id of this.materials.keys()) this.clearMaterial(id);
  }
  finalizeShutdown() {
    if (this.finalSnapshots) return;
    this.close();
    for (const [id, execution] of this.executions) {
      const reason =
        execution.phase === "provider"
          ? "SHUTDOWN_TIMEOUT"
          : "SHUTDOWN_TIME_UNCERTAIN";
      if (reason === "SHUTDOWN_TIME_UNCERTAIN")
        this.roots.block(id, "ACTIVE_TIME_RECONCILIATION");
      this.db
        .prepare(
          "UPDATE reading_tasks SET reason=?,active_ms=active_ms+? WHERE id=?",
        )
        .run(
          reason,
          execution.phase === "provider"
            ? Math.max(
                0,
                Math.ceil(
                  performance.now() - execution.started - execution.excludedMs,
                ),
              )
            : 0,
          id,
        );
      this.roots.stats(id);
    }
    for (const call of this.ledger.db
      .prepare(
        "SELECT id,task,state FROM reading_calls WHERE account=? AND state IN ('sent','reserved')",
      )
      .all(this.account)) {
      if (!this.executions.has(call.task)) continue;
      if (call.state === "sent") this.ledger.unknown(call.id);
      else this.ledger.releaseUnsent(call.id);
    }
    // Only in-flight promises need a terminal snapshot. Do not load historical
    // tasks/coverage into memory just to close the service.
    this.finalSnapshots = new Map(
      [...this.executions.keys()].map((id) => [id, this.get(id)]),
    );
    this.controllers.clear();
  }
  async run(id) {
    await this.step(id);
    return this.get(id);
  }
  publish(task, coverage, partial = false, afterPublication) {
    const id = task.id;
    const blocks = this.db
      .prepare(
        "SELECT b.result FROM reading_blocks b WHERE task=? ORDER BY rowid",
      )
      .all(id)
      .map((b) => JSON.parse(b.result));
    const result = {
      summary: blocks.map((b) => b.summary).join("\n"),
      warnings: blocks.flatMap((b) => b.warnings),
      items: blocks.flatMap((b) => b.items),
    };
    const processed = this.db
      .prepare(
        "SELECT ranges FROM reading_block_ranges WHERE task=? ORDER BY rowid",
      )
      .all(id)
      .flatMap((r) => JSON.parse(r.ranges));
    const processedKeys = new Set(processed.map((r) => JSON.stringify(r)));
    const processingCoverage = {
      partial,
      processed,
      unread: coverage.flatMap(c => (c.uncovered || []).filter(r => r.code === "PDF_WINDOW_PENDING")
        .map(r => ({...r,name:c.name}))),
      pending: coverage
        .flatMap((c) => c.covered || [])
        .filter((r) => !processedKeys.has(JSON.stringify(r))),
    };
    // The store's beforeCommit hook performs every task/publication mutation
    // atomically, including an accept-partial operation receipt.
    this.store.apply(
      task.device,
      {
        opId: "reading_" + id,
        id: task.packet,
        type: "put",
        baseVersion: task.base_version,
        data: {
          result,
          status: "ready",
          readingCoverage: coverage,
          processingCoverage,
          itemIds: result.items.map((_, i) => `${id}_item_${i}`),
          sources: [],
          updatedAt: new Date().toISOString(),
        },
      },
      this.store.epoch,
      {
        taskId: id,
        generation: task.generation,
        beforeCommit: (response) => {
          const current = this.get(id);
          if (
            current.generation !== task.generation ||
            !["running", "paused", "interrupted", "error", "conflict"].includes(
              current.state,
            )
          )
            throw error("STALE_TASK");
          if (inputRevision(this.store, task.packet) !== task.input_revision)
            throw error("INPUT_CHANGED");
          this.db
            .prepare("INSERT INTO reading_publications VALUES(?,?)")
            .run(id, response.acceptedVersion);
          this.db
            .prepare(
              "UPDATE reading_tasks SET state=? WHERE id=? AND generation=?",
            )
            .run(partial ? "partial" : "done", id, task.generation);
          afterPublication?.();
        },
      },
    );
    return this.get(id);
  }
  async step(id) {
    const task = this.get(id);
    if (!task || task.state !== "queued")
      throw error("INVALID_TASK_TRANSITION");
    if (this.controllers.has(id)) throw error("TASK_STILL_DRAINING");
    this.authorize(task.device);
    if (inputRevision(this.store, task.packet) !== task.input_revision)
      throw error("INPUT_CHANGED");
    const root = this.roots.checkpoint(id);
    const activeLimitMs = this.executionLimit(id);
    this.db
      .prepare("UPDATE reading_tasks SET state='running' WHERE id=?")
      .run(id);
    task.state = "running";
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const started = performance.now();
    const execution = { started, excludedMs: 0, phase: "reader" };
    this.executions.set(id, execution);
    let excludedMs = 0;
    let safetyStep;
    const read = async (file, pdfWindow) => {
      const readAt = performance.now(),
        before = excludedMs;
      const deadline = new AbortController();
      const signal = AbortSignal.any([controller.signal, deadline.signal]);
      let queuedAt,
        timer,
        drainTimer,
        finished = false,
        reportedWait = 0;
      const waiting = (timing) => {
        const ms = timing?.waitingMs;
        if (
          !Number.isFinite(ms) ||
          ms < 0 ||
          ms > performance.now() - readAt + 5
        ) {
          if (!this.finalSnapshots)
            this.roots.block(id, "ACTIVE_TIME_RECONCILIATION");
          throw Object.assign(Error("ACTIVE_TIME_RECONCILIATION"), {
            timingUncertain: true,
          });
        }
        reportedWait = ms;
        excludedMs = before + ms;
        execution.excludedMs = excludedMs;
      };
      const arm = () => {
        clearTimeout(timer);
        if (queuedAt !== undefined) return;
        const remaining =
          activeLimitMs -
          root.activeMs -
          (performance.now() - started - excludedMs);
        const perRead =
          (this.readerLimitMs || 30000) -
          (performance.now() - readAt - reportedWait);
        timer = setTimeout(
          () =>
            deadline.abort(
              Error(
                remaining <= perRead ? "EXECUTION_LIMIT" : "READING_TIMEOUT",
              ),
            ),
          Math.max(1, Math.min(remaining, perRead)),
        );
      };
      const activeBudgetMs = Math.max(
        1,
        Math.min(
          1800000,
          Math.floor(
            activeLimitMs -
              root.activeMs -
              (performance.now() - started - excludedMs),
          ),
        ),
      );
      arm();
      try {
        const value = await new Promise((resolve, reject) => {
          const aborted = () => {
            drainTimer = setTimeout(
              () =>
                reject(
                  Object.assign(signal.reason || Error("READING_ABORTED"), {
                    timingUncertain: queuedAt !== undefined,
                  }),
                ),
              this.readerDrainMs ?? 2100,
            );
          };
          signal.addEventListener("abort", aborted, { once: true });
          Promise.resolve()
            .then(() =>
              this.reader(file, {
                signal,
                pdfWindow,
                activeBudgetMs,
                onPhase: (phase) => {
                  if (signal.aborted || finished || this.finalSnapshots) return;
                  if (phase.phase === "queued" && queuedAt === undefined) {
                    queuedAt = performance.now();
                    clearTimeout(timer);
                  } else if (phase.phase === "active") {
                    waiting(phase);
                    queuedAt = undefined;
                    arm();
                  } else
                    throw Object.assign(Error("ACTIVE_TIME_RECONCILIATION"), {
                      timingUncertain: true,
                    });
                },
              }),
            )
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", aborted));
        });
        if (value.timing) waiting(value.timing);
        if (signal.aborted) throw signal.reason || Error("READING_ABORTED");
        const { timing, ...material } = value;
        return material;
      } catch (e) {
        if (this.finalSnapshots) throw Error("READING_ABORTED");
        if (e.timing) waiting(e.timing);
        if (e.timingUncertain) {
          this.roots.block(id, "ACTIVE_TIME_RECONCILIATION");
          throw Error("ACTIVE_TIME_RECONCILIATION");
        }
        if (deadline.signal.aborted) throw deadline.signal.reason;
        if (e.message === "READING_ACTIVE_LIMIT")
          throw Error("EXECUTION_LIMIT");
        throw e;
      } finally {
        finished = true;
        clearTimeout(timer);
        clearTimeout(drainTimer);
      }
    };
    const readSafe = async (file, pdfWindow) => {
      for (let retries = 0; ; retries++) {
        if (!this.current(task)) throw Error("READING_ABORTED");
        if (
          root.activeMs + performance.now() - started - excludedMs >=
          activeLimitMs
        )
          throw Error("EXECUTION_LIMIT");
        try {
          return { ...(await read(file, pdfWindow)), readRetries: retries };
        } catch (e) {
          e.readRetries = retries;
          // Only a fixed broker admission rejection proves no worker started.
          // Transport loss, unknown timing, parser errors and timeouts are not
          // evidence of non-execution and never enter this retry path.
          if (
            retries >= 2 ||
            e.message !== "READING_QUEUE_FULL" ||
            e.notExecuted !== true ||
            e.timing?.waitingMs !== 0 ||
            e.timingUncertain ||
            !this.current(task)
          )
            throw e;
          const remaining =
            activeLimitMs -
            root.activeMs -
            (performance.now() - started - excludedMs);
          const backoff = retries ? 300 : 100;
          await delay(Math.max(1, Math.min(backoff, remaining)), undefined, {
            signal: controller.signal,
          });
          // Node rounds timer delays down. A sub-millisecond early wake must
          // not admit another read when the budget cannot cover the backoff.
          if (remaining <= backoff) throw Error("EXECUTION_LIMIT");
        }
      }
    };
    try {
      if (root.reason) throw Error(root.reason);
      if (root.activeMs >= activeLimitMs) throw Error("EXECUTION_LIMIT");
      const wallet = this.ledger.wallet(this.account);
      if (wallet.pausedReason) throw Error(wallet.pausedReason);
      safetyStep = this.roots.safety.begin(root.id,id,task.generation);
      const paged = this.reader.pdfWindows === true;
      if (!paged && this.windows.rows(id).length) throw Error("READER_WINDOW_REQUIRED");
      const packet = this.store.record(task.packet).data,
        cached = this.materials.get(id),
        materials = cached || [];
      const inputBytes = packet.text?.trim() ? Buffer.from(packet.text) : null;
      const input = inputBytes ? {id:"input",name:"输入.txt",body:inputBytes,size:inputBytes.length,hash:sha256(inputBytes)} : null;
      const pendingInputs = [...(input ? [input] : []), ...(packet.attachments || []).filter(f => !f.deletedAt)];
      const readInput = async file => {
        const selection = paged ? this.windows.select(id,file) : {};
        if (selection.skip) return;
        const material = await readSafe(file,selection.pdfWindow);
        if (paged) this.windows.verify(material,selection.pdfWindow);
        materials.push(material);
      };
      // 60k codepoints fit the legacy validator's 120k UTF-16 bound. This is a
      // per-step adaptation, never a total material cap.
      if (!this.materials.has(id) && input) await readInput(input);
      for (const f of this.materials.has(id)
        ? []
        : (packet.attachments || []).filter((f) => !f.deletedAt)) {
        if (!this.current(task)) return this.get(id);
        if (paged && materials.length) break;
        try {
          await readInput(this.store.files.get(task.packet,f.id,{forReading:true}));
        } catch (e) {
          if (
            [
              "EXECUTION_LIMIT",
              "ACTIVE_TIME_RECONCILIATION",
              "SAFETY_RECONCILIATION",
              "REUPLOAD_REQUIRED",
              "INVALID_READER_WINDOW",
            ].includes(e.code || e.message) ||
            !this.current(task)
          )
            throw e;
          const code = ["READING_TIMEOUT", "READING_QUEUE_FULL"].includes(
            e.message,
          )
            ? e.message
            : "ISOLATED_READING_FAILED";
          materials.push({
            attachmentId: f.id,
            name: f.name,
            contentHash: f.hash,
            state: "failed",
            readRetries: e.readRetries || 0,
            readerVersion: READER_VERSION,
            covered: [],
            uncovered: [{ kind: "file", code }],
            reasons: [code],
            segments: [],
          });
        }
      }
      if (!this.current(task)) return this.get(id);
      const readable = cached || materials.map(modelMaterial);
      this.materials.set(id, readable);
      const coverage = paged ? this.windows.coverage(id,readable) : readable.map(coverageOnly);
      this.db
        .prepare("UPDATE reading_tasks SET coverage=? WHERE id=?")
        .run(JSON.stringify(coverage), id);
      if (!readable.some((m) => m.segments.some((s) => s.text.trim())) &&
          !this.db.prepare("SELECT 1 FROM reading_blocks WHERE task=?").get(id)) {
        if (paged) {
          this.transaction(() => this.windows.advance(id,readable));
          this.dropMaterial(id);
          if (this.windows.pending(id,pendingInputs)) return this.get(id);
        }
        throw Error("NO_READABLE_MATERIAL");
      }
      const batches = [...modelBatches(readable)];
      for (const batch of batches) {
        if (!this.current(task)) return this.get(id);
        if (
          root.activeMs + performance.now() - started - excludedMs >=
          activeLimitMs
        )
          throw Error("EXECUTION_LIMIT");
        this.authorize(task.device);
        const fingerprint = sha256(
          JSON.stringify([
            task.input_revision,
            versions,
            this.modelVersion,
            batch.map((s) => s.range),
          ]),
        );
        const existing = this.db
          .prepare(
            "SELECT * FROM reading_blocks WHERE task=? AND fingerprint=?",
          )
          .get(id, fingerprint);
        if (
          existing &&
          this.ledger.call(existing.call_id)?.state === "settled"
        ) {
          if (!this.reuse.copied(id, fingerprint))
            this.roots.progress(id, fingerprint);
          continue;
        }
        const sources = batch.map((s) => ({
          id: s.sourceId,
          name:
            typeof s.range.archivePath === "string"
              ? "包内 " +
                [...s.range.archivePath].slice(0, 90).join("") +
                ([...s.range.archivePath].length > 90 ? "…" : "")
              : s.range.name,
          text: s.text,
        }));
        const reuseKey = this.reuse.key(batch, readable, {
          versions,
          model: this.modelVersion,
          captureDate: packet.captureDate,
          maxOutputTokens: this.maxOutputTokens,
        });
        const reused = this.reuse.find(task, reuseKey, (raw) =>
          validatePaidResult(raw, sources, packet.captureDate),
        );
        if (reused) {
          const result = this.boundQuotes(
            id,
            reused.validated,
            readable,
            batch,
          );
          this.transaction(() => {
            if (!this.current(task)) throw error("STALE_TASK");
            this.db
              .prepare("INSERT INTO reading_blocks VALUES(?,?,?,?)")
              .run(id, fingerprint, reused.call_id, JSON.stringify(result));
            this.db
              .prepare("INSERT INTO reading_block_ranges VALUES(?,?,?)")
              .run(id, fingerprint, JSON.stringify(batch.map((s) => s.range)));
            this.db
              .prepare("INSERT INTO reading_reused_blocks VALUES(?,?,?,?,?)")
              .run(
                id,
                fingerprint,
                reused.task,
                reused.fingerprint,
                reused.call_id,
              );
          });
          // Yield fairly, without a new call, settlement or root progress.
          return this.get(id);
        }
        const recovered = this.ledger.completedEnvelope(
          this.account,
          id,
          fingerprint,
        );
        if (recovered) {
          this.db
            .prepare("INSERT OR REPLACE INTO reading_blocks VALUES(?,?,?,?)")
            .run(id, fingerprint, recovered.call_id, recovered.result);
          this.db
            .prepare(
              "INSERT OR REPLACE INTO reading_block_ranges VALUES(?,?,?)",
            )
            .run(id, fingerprint, JSON.stringify(batch.map((s) => s.range)));
          this.ledger.clearEnvelope(recovered.call_id);
          this.reuse.certify(
            id,
            fingerprint,
            reuseKey,
            JSON.parse(recovered.result),
          );
          this.roots.progress(id, fingerprint);
          continue;
        }
        const prepared = this.provider.prepare?.(sources, {
          captureDate: packet.captureDate,
          maxOutputTokens: this.maxOutputTokens,
        });
        const callId = randomUUID();
        this.ledger.reserve({
          callId,
          account: this.account,
          task: id,
          block: fingerprint,
          generation: task.generation,
          priceId: prepared?.priceId || this.priceId,
          maxPromptTokens: prepared?.maxPromptTokens || this.maxPromptTokens,
          maxOutputTokens: prepared?.maxOutputTokens || this.maxOutputTokens,
        });
        this.ledger.sent(callId);
        this.db
          .prepare("UPDATE reading_tasks SET calls=calls+1 WHERE id=?")
          .run(id);
        let response;
        execution.phase = "provider";
        try {
          response = await this.provider(
            sources,
            AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(
                Math.max(
                  1,
                  Math.min(
                    240000,
                    Math.floor(
                      activeLimitMs -
                        root.activeMs -
                        (performance.now() - started - excludedMs),
                    ),
                  ),
                ),
              ),
            ]),
            {
              prepared,
              captureDate: packet.captureDate,
              maxOutputTokens: this.maxOutputTokens,
            },
          );
        } catch {
          if (this.finalSnapshots) return this.get(id);
          this.ledger.unknown(callId);
          throw Error("UNKNOWN_COST");
        }
        if (this.finalSnapshots) return this.get(id);
        try {
          validateUsage(response.usage);
        } catch {
          this.ledger.unknown(callId);
          throw Error("UNKNOWN_COST");
        }
        // Billing remains valid for stale or invalid output. Persist only a
        // validated, bounded result envelope before committing its settlement.
        if (!this.current(task)) {
          this.ledger.settle(callId, response.usage);
          return this.get(id);
        }
        let result;
        try {
          result = validatePaidResult(
            response.result,
            sources,
            packet.captureDate,
          );
        } catch (e) {
          this.ledger.settle(callId, response.usage);
          throw e;
        }
        this.boundQuotes(id, result, readable, batch);
        this.ledger.saveEnvelope(callId, fingerprint, result, response.usage);
        this.ledger.settle(callId, response.usage);
        this.db
          .prepare("INSERT OR REPLACE INTO reading_blocks VALUES(?,?,?,?)")
          .run(id, fingerprint, callId, JSON.stringify(result));
        this.db
          .prepare("INSERT OR REPLACE INTO reading_block_ranges VALUES(?,?,?)")
          .run(id, fingerprint, JSON.stringify(batch.map((s) => s.range)));
        this.reuse.certify(id, fingerprint, reuseKey, result);
        this.ledger.clearEnvelope(callId);
        this.roots.progress(id, fingerprint);
        return this.get(id);
      }
      if (!this.current(task)) return this.get(id);
      if (paged) {
        this.transaction(() => this.windows.advance(id,readable));
        this.dropMaterial(id);
        if (this.windows.pending(id,pendingInputs)) return this.get(id);
      }
      return this.publish(task, coverage);
    } catch (e) {
      const reason = e.code || e.message;
      if (
        this.current(task) ||
        (this.get(id)?.state === "applying" &&
          this.get(id)?.generation === task.generation)
      )
        this.db
          .prepare(
            "UPDATE reading_tasks SET state='paused',reason=? WHERE id=?",
          )
          .run(
            [
              "PERSONAL_BUDGET",
              "SITE_BUDGET",
              "UNKNOWN_COST",
              "EXECUTION_LIMIT",
              "NO_READABLE_MATERIAL",
              "TASK_INFLIGHT_BUDGET",
              "CHECKPOINT_NO_PROGRESS",
              "CHECKPOINT_RECONCILIATION",
              "ACTIVE_TIME_RECONCILIATION",
              "REUPLOAD_REQUIRED",
              "READING_TIMEOUT",
              "LEDGER_PAUSED",
              "SAFETY_RECONCILIATION",
            ].includes(reason)
              ? reason
              : "READING_TASK_FAILED",
            id,
          );
      return this.get(id);
    } finally {
      this.executions.delete(id);
      try {
        if (this.finalSnapshots) {
          this.controllers.delete(id);
          this.clearMaterial(id);
        } else {
          this.db
            .prepare("UPDATE reading_tasks SET active_ms=active_ms+? WHERE id=?")
            .run(
              Math.max(0, Math.ceil(performance.now() - started - excludedMs)),
              id,
            );
          // Return queued only after the previous invocation fully drains. Stop and
          // resume generations never share one in-flight controller.
          // Check failed/invalid paid calls too, at call 24 itself.
          const checkpoint = this.roots.checkpoint(id);
          if (safetyStep) this.roots.safety.finish(safetyStep);
          if (checkpoint.reason && this.current(task))
            this.db
              .prepare(
                "UPDATE reading_tasks SET state='paused',reason=? WHERE id=?",
              )
              .run(checkpoint.reason, id);
          if (this.current(task))
            this.db
              .prepare("UPDATE reading_tasks SET state='queued' WHERE id=?")
              .run(id);
          this.controllers.delete(id);
          if (this.get(id)?.state !== "queued") this.clearMaterial(id);
          else {
            clearTimeout(this.cacheTimers.get(id));
            const timer = setTimeout(() => this.clearMaterial(id), 30000);
            timer.unref();
            this.cacheTimers.set(id, timer);
          }
        }
      } finally {
        if (safetyStep) this.roots.safety.abandon(safetyStep);
      }
    }
  }
  boundQuotes(id, result, readable, batch) {
    const quoteTotals = new Map();
    const attachments = new Map(JSON.parse(this.get(id).coverage).flatMap(m =>
      (m.covered || []).map(r => [r.sourceId,m.attachmentId])));
    for (const row of this.db
      .prepare("SELECT result FROM reading_blocks WHERE task=?")
      .all(id))
      for (const item of JSON.parse(row.result).items)
        for (const evidence of item.evidence) {
          const attachment = attachments.get(evidence.sourceId);
          if (attachment)
            quoteTotals.set(
              attachment,
              (quoteTotals.get(attachment) || 0) + evidence.quote.length,
            );
        }
    for (const item of result.items)
      for (const evidence of item.evidence) {
        const segment = batch.find((s) => s.sourceId === evidence.sourceId);
        if (
          !segment ||
          evidence.quote.length > 500 ||
          !segment.text.includes(evidence.quote)
        )
          throw Error("INVALID_MODEL_SOURCE");
        const attachment = readable.find((m) =>
          m.segments.some((s) => s.sourceId === evidence.sourceId),
        ).attachmentId;
        const available = Math.max(
          0,
          2000 - (quoteTotals.get(attachment) || 0),
        );
        if (evidence.quote.length > available) {
          evidence.quote = evidence.quote.slice(0, available);
          if (/[\ud800-\udbff]$/.test(evidence.quote))
            evidence.quote = evidence.quote.slice(0, -1);
        }
        quoteTotals.set(
          attachment,
          (quoteTotals.get(attachment) || 0) + evidence.quote.length,
        );
      }
    return result;
  }
}
