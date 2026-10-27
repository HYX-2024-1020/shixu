import { randomUUID } from "node:crypto";
import { SyncError } from "../sync-store.mjs";
import { validateResult } from "../../shared/bucket-engine.mjs";
import {
  coverageOnly,
  modelMaterial,
  modelBatches,
  sha256,
  READER_VERSION,
  NORMALIZATION_VERSION,
} from "./material.mjs";
import { validateUsage } from "./ledger.mjs";

const active = ["queued", "running", "applying"];
const occupies = [...active, "paused", "interrupted", "error", "conflict"];
const validId = (v) => typeof v === "string" && /^[\w-]{1,90}$/.test(v);
const error = (code) => new SyncError(409, code, code);
const versions = {
  reader: READER_VERSION,
  normalization: NORMALIZATION_VERSION,
  prompt: "reading/1",
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
      const original = store.files.get(packetId, f.id);
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
    });
    this.db = store.db;
    this.controllers = new Map();
    this.materials = new Map();
    this.cacheTimers = new Map();
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS reading_tasks(id TEXT PRIMARY KEY,packet TEXT NOT NULL,device TEXT NOT NULL,
      input_revision TEXT NOT NULL,base_version INTEGER NOT NULL,generation INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',coverage TEXT NOT NULL DEFAULT '[]',calls INTEGER NOT NULL DEFAULT 0,active_ms INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_blocks(task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,
        result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));
      CREATE TABLE IF NOT EXISTS reading_publications(task TEXT PRIMARY KEY,version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_actions(operation TEXT PRIMARY KEY,task TEXT NOT NULL,action TEXT NOT NULL,generation INTEGER NOT NULL,response TEXT NOT NULL);`);
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
    return this.db.prepare("SELECT * FROM reading_tasks WHERE id=?").get(id);
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
      return this.get(id);
    });
  }
  action(id, { operationId, expectedGeneration, expectedRevision }, action) {
    if (!validId(operationId) || !["stop", "continue"].includes(action))
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
          JSON.parse(previous.response).input_revision !== expectedRevision
        )
          throw error("IDEMPOTENCY_CONFLICT");
        return JSON.parse(previous.response);
      }
      const task = this.get(id);
      if (!task) throw error("TASK_NOT_FOUND");
      this.authorize(task.device);
      if (
        task.generation !== expectedGeneration ||
        task.input_revision !== expectedRevision
      )
        throw error("STALE_TASK");
      if (action === "stop") {
        if (["done", "partial", "purged"].includes(task.state)) return task;
        this.db
          .prepare(
            "UPDATE reading_tasks SET generation=generation+1,state='cancelled',reason='' WHERE id=?",
          )
          .run(id);
      } else {
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
            "UPDATE reading_tasks SET generation=generation+1,state='queued',reason='',base_version=? WHERE id=?",
          )
          .run(this.store.record(task.packet).version, id);
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
      return response;
    });
    if (action === "stop") {
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
    clearTimeout(this.cacheTimers.get(id));
    this.cacheTimers.delete(id);
    this.materials.delete(id);
  }
  close() {
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
  async run(id) {
    await this.step(id);
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
    this.db
      .prepare("UPDATE reading_tasks SET state='running' WHERE id=?")
      .run(id);
    task.state = "running";
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const started = performance.now();
    try {
      const packet = this.store.record(task.packet).data,
        cached = this.materials.get(id),
        materials = cached || [];
      // 60k codepoints fit the legacy validator's 120k UTF-16 bound. This is a
      // per-step adaptation, never a total material cap.
      if (!this.materials.has(id) && packet.text?.trim()) {
        const body = Buffer.from(packet.text);
        materials.push(
          await this.reader(
            {
              id: "input",
              name: "输入.txt",
              body,
              size: body.length,
              hash: sha256(body),
            },
            { signal: controller.signal },
          ),
        );
      }
      for (const f of this.materials.has(id)
        ? []
        : (packet.attachments || []).filter((f) => !f.deletedAt)) {
        if (!this.current(task)) return this.get(id);
        try {
          materials.push(
            await this.reader(this.store.files.get(task.packet, f.id), {
              signal: controller.signal,
            }),
          );
        } catch {
          materials.push({
            attachmentId: f.id,
            name: f.name,
            contentHash: f.hash,
            state: "failed",
            readerVersion: READER_VERSION,
            covered: [],
            uncovered: [{ kind: "file", code: "ISOLATED_READING_FAILED" }],
            reasons: ["ISOLATED_READING_FAILED"],
            segments: [],
          });
        }
      }
      if (!this.current(task)) return this.get(id);
      const readable = cached || materials.map(modelMaterial);
      this.materials.set(id, readable);
      this.db
        .prepare("UPDATE reading_tasks SET coverage=? WHERE id=?")
        .run(JSON.stringify(readable.map(coverageOnly)), id);
      if (!readable.some((m) => m.segments.some((s) => s.text.trim())))
        throw Error("NO_READABLE_MATERIAL");
      const batches = [...modelBatches(readable)];
      for (const batch of batches) {
        if (!this.current(task)) return this.get(id);
        if (task.active_ms + performance.now() - started >= 1800000)
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
        if (existing && this.ledger.call(existing.call_id)?.state === "settled")
          continue;
        const recovered = this.ledger.completedEnvelope(
          this.account,
          id,
          fingerprint,
          this.priceId,
        );
        if (recovered) {
          this.db
            .prepare("INSERT OR REPLACE INTO reading_blocks VALUES(?,?,?,?)")
            .run(id, fingerprint, recovered.call_id, recovered.result);
          this.ledger.clearEnvelope(recovered.call_id);
          continue;
        }
        const callId = randomUUID();
        this.ledger.reserve({
          callId,
          account: this.account,
          task: id,
          block: fingerprint,
          generation: task.generation,
          priceId: this.priceId,
          maxPromptTokens: this.maxPromptTokens,
          maxOutputTokens: this.maxOutputTokens,
        });
        this.ledger.sent(callId);
        this.db
          .prepare("UPDATE reading_tasks SET calls=calls+1 WHERE id=?")
          .run(id);
        const sources = batch.map((s) => ({
          id: s.sourceId,
          name: s.range.name,
          text: s.text,
        }));
        let response;
        try {
          response = await this.provider(
            sources,
            AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]),
          );
        } catch {
          this.ledger.unknown(callId);
          throw Error("UNKNOWN_COST");
        }
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
        const quoteTotals = new Map();
        for (const row of this.db
          .prepare("SELECT result FROM reading_blocks WHERE task=?")
          .all(id))
          for (const item of JSON.parse(row.result).items)
            for (const evidence of item.evidence) {
              const attachment = readable.find((m) =>
                m.segments.some((s) => s.sourceId === evidence.sourceId),
              )?.attachmentId;
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
        this.ledger.saveEnvelope(callId, fingerprint, result, response.usage);
        this.ledger.settle(callId, response.usage);
        this.db
          .prepare("INSERT OR REPLACE INTO reading_blocks VALUES(?,?,?,?)")
          .run(id, fingerprint, callId, JSON.stringify(result));
        this.ledger.clearEnvelope(callId);
        // One bounded call returns control to the caller scheduler. It may run a
        // different account next; checkpoints never reset cumulative counters.
        return this.get(id);
      }
      if (!this.current(task)) return this.get(id);
      const blocks = this.db
        .prepare(
          "SELECT result FROM reading_blocks WHERE task=? ORDER BY rowid",
        )
        .all(id)
        .map((b) => JSON.parse(b.result));
      const result = {
        summary: blocks.map((b) => b.summary).join("\n"),
        warnings: blocks.flatMap((b) => b.warnings),
        items: blocks.flatMap((b) => b.items),
      };
      this.db
        .prepare(
          "UPDATE reading_tasks SET state='applying' WHERE id=? AND generation=?",
        )
        .run(id, task.generation);
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
            readingCoverage: readable.map(coverageOnly),
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
            this.db
              .prepare("INSERT INTO reading_publications VALUES(?,?)")
              .run(id, response.acceptedVersion);
            this.db
              .prepare(
                "UPDATE reading_tasks SET state='done' WHERE id=? AND generation=?",
              )
              .run(id, task.generation);
          },
        },
      );
      return this.get(id);
    } catch (e) {
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
            ].includes(e.message)
              ? e.message
              : "READING_TASK_FAILED",
            id,
          );
      return this.get(id);
    } finally {
      this.db
        .prepare("UPDATE reading_tasks SET active_ms=active_ms+? WHERE id=?")
        .run(Math.ceil(performance.now() - started), id);
      // Return queued only after the previous invocation fully drains. Stop and
      // resume generations never share one in-flight controller.
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
  }
}
