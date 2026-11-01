import { applyReadingMigrations, assertReadingSchema } from "./schema.mjs";
import { randomUUID } from "node:crypto";
import { sha256 } from "./material.mjs";
import { validateUsage } from "./ledger.mjs";

export const MERGE_VERSION = "paid-semantic-pairs/4";
const hash = (value) => sha256(JSON.stringify(value));
const fail = () => {
  throw Error("SAFETY_RECONCILIATION");
};
const unique = (values) => [
  ...new Map(values.map((v) => [JSON.stringify(v), v])).values(),
];
const dueKey = (due) =>
  due ? JSON.stringify([due.date, due.time, due.endDate, due.endTime]) : null;
const compatibleKinds = (items) => {
  const kinds = new Set(items.map((item) => item.kind));
  return (
    kinds.size === 1 ||
    (kinds.size === 2 &&
      kinds.has("notice") &&
      (kinds.has("task") || kinds.has("event")))
  );
};

// Models propose only equivalence/related edges. All actual content and evidence
// is assembled from certified paid items; no rewritten facts or citations enter.
export function validateMerge(value, items) {
  if (!value || Object.keys(value).sort().join(",") !== "related,same")
    throw Error("INVALID_MERGE_OUTPUT");
  const ids = new Map(items.map((row) => [row.id, row.item]));
  const seen = new Set();
  for (const kind of ["same", "related"]) {
    if (!Array.isArray(value[kind]) || value[kind].length > 160)
      throw Error("INVALID_MERGE_OUTPUT");
    for (const edge of value[kind]) {
      if (
        !Array.isArray(edge) ||
        edge.length !== 2 ||
        edge.some((id) => !ids.has(id)) ||
        edge[0] === edge[1]
      )
        throw Error("INVALID_MERGE_SOURCE");
      const key = [...edge].sort().join(":");
      if (seen.has(key)) throw Error("INVALID_MERGE_OUTPUT");
      seen.add(key);
      const [a, b] = edge.map((id) => ids.get(id));
      if (
        kind === "same" &&
        (!compatibleKinds([a, b]) ||
          (a.due && b.due && dueKey(a.due) !== dueKey(b.due)))
      )
        throw Error("INVALID_MERGE_CONFLICT");
    }
  }
  return structuredClone(value);
}

export function assembleMerge(items, decisions) {
  const parents = new Map(items.map((row) => [row.id, row.id]));
  const find = (id) => {
    let root = id;
    while (parents.get(root) !== root) root = parents.get(root);
    return root;
  };
  for (const decision of decisions)
    for (const [a, b] of decision.same) {
      const ra = find(a),
        rb = find(b);
      if (!ra || !rb) fail();
      parents.set(rb, ra);
    }
  const groups = new Map();
  for (const row of items) {
    const root = find(row.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(row);
  }
  const index = new Map();
  const merged = [...groups.values()].map((rows, i) => {
    const originals = rows.map((row) => row.item),
      item = structuredClone(
        originals.find((item) => ["task", "event"].includes(item.kind)) ||
          originals[0],
      );
    if (
      !compatibleKinds(originals) ||
      new Set(originals.map((i) => dueKey(i.due)).filter(Boolean)).size > 1
    )
      throw Error("INVALID_MERGE_CONFLICT");
    for (const row of rows) index.set(row.id, i);
    for (const field of [
      "facts",
      "nextSteps",
      "uncertainties",
      "evidence",
      "sourceIds",
    ])
      item[field] = unique(originals.flatMap((i) => i[field] || []));
    // Keep complementary summaries as facts rather than discarding information
    // when choosing the first source's short card heading and summary.
    item.facts = unique([
      ...item.facts,
      ...unique(originals.map((i) => i.summary))
        .filter((s) => s && s !== item.summary)
        .map((s) => "补充摘要：" + s),
    ]);
    item.due = originals.find((i) => i.due)?.due || null;
    item.importance = Math.max(...originals.map((i) => i.importance ?? 1));
    item.importanceReason =
      originals.find((i) => i.importance === item.importance)
        ?.importanceReason || item.importanceReason;
    return item;
  });
  const related = unique(
    decisions
      .flatMap((d) => d.related)
      .map(([a, b]) => [index.get(a), index.get(b)].sort((a, b) => a - b))
      .filter(([a, b]) => a !== b),
  );
  return {
    items: merged,
    related,
    originalItems: items.length,
    mergedItems: items.length - merged.length,
  };
}

export class ReadingMerge {
  constructor(engine, { namespace = "merge", version = MERGE_VERSION } = {}) {
    if (
      !["merge", "association"].includes(namespace) ||
      typeof version !== "string"
    )
      throw Error("INVALID_PAID_STAGE");
    this.namespace = namespace;
    this.version = version;
    this.e = engine;
    this.db = engine.db;
    this.ledger = engine.ledger;
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS reading_${this.namespace}_results(task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));`,
    );
    const schema = `CREATE TABLE IF NOT EXISTS reading_${this.namespace}_intents(account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,dependency_hash TEXT NOT NULL,PRIMARY KEY(account,task));
      CREATE TABLE IF NOT EXISTS reading_${this.namespace}_proofs(account TEXT NOT NULL,task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account,task,fingerprint));
      CREATE TRIGGER IF NOT EXISTS reading_${this.namespace}_intents_no_update BEFORE UPDATE ON reading_${this.namespace}_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_${this.namespace}_intents_no_delete BEFORE DELETE ON reading_${this.namespace}_intents BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_INTENT'); END;
      CREATE TRIGGER IF NOT EXISTS reading_${this.namespace}_proofs_no_update BEFORE UPDATE ON reading_${this.namespace}_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_PROOF'); END;
      CREATE TRIGGER IF NOT EXISTS reading_${this.namespace}_proofs_no_delete BEFORE DELETE ON reading_${this.namespace}_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MERGE_PROOF'); END;`;
    if (namespace === "association") {
      applyReadingMigrations(this.ledger, "history-association", [
        { version: 1, sql: schema },
      ]);
      assertReadingSchema(this.ledger, schema);
    } else this.ledger.db.exec(schema);
  }
  validate(value, items) {
    return validateMerge(value, items);
  }
  complete(task) {
    if (this.namespace === "merge" && this.e.association?.begin(task))
      return this.e.get(task.id);
    return this.e.publish(task, JSON.parse(this.e.get(task.id).coverage));
  }
  intent(task) {
    return this.ledger.db
      .prepare(
        `SELECT * FROM reading_${this.namespace}_intents WHERE account=? AND task=?`,
      )
      .get(this.e.account, task);
  }
  active(task) {
    return !!this.intent(task);
  }
  plan(task) {
    const linkedTasks = new Set(
      this.e.roots.safety.tasks(this.e.roots.stats(task.id).id),
    );
    const blocks = this.db
      .prepare("SELECT * FROM reading_blocks WHERE task=? ORDER BY rowid")
      .all(task.id);
    const projected = [];
    const dependencies = blocks.map((b) => {
      const copied = this.db
        .prepare(
          "SELECT * FROM reading_reused_blocks WHERE task=? AND fingerprint=?",
        )
        .get(task.id, b.fingerprint);
      const original = copied
        ? this.e.reuse.proof(copied.source_task, copied.source_fingerprint)
        : this.e.reuse.proof(task.id, b.fingerprint);
      const call = this.ledger.call(b.call_id);
      if (
        !call ||
        call.state !== "settled" ||
        call.account !== this.e.account ||
        !original ||
        !linkedTasks.has(call.task) ||
        original.call_id !== b.call_id ||
        call.task !== original.task ||
        call.block !== original.fingerprint ||
        original.result_hash !== sha256(b.result)
      )
        fail();
      const effective = this.e.visual.effective(task, b);
      projected.push(effective.result);
      return [original.reuse_key, sha256(b.result), effective.dependency];
    });
    const dependencyHash = hash([
      this.version,
      this.e.modelVersion,
      dependencies,
    ]);
    const prior = this.intent(task.id);
    if (
      prior &&
      (prior.packet !== task.packet || prior.dependency_hash !== dependencyHash)
    )
      fail();
    const items = blocks.flatMap((b, block) =>
      projected[block].items.map((item, index) => ({
        id: `b${block}i${index}`,
        item,
      })),
    );
    const chunks = [];
    let chunk = [],
      size = 0;
    for (const row of items) {
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (bytes > 56000) throw Error("MERGE_CONTEXT_LIMIT");
      if (chunk.length && (chunk.length === 16 || size + bytes > 56000)) {
        chunks.push(chunk);
        chunk = [];
        size = 0;
      }
      chunk.push(row);
      size += bytes;
    }
    if (chunk.length) chunks.push(chunk);
    return { items, chunks, dependencyHash };
  }
  begin(task) {
    if (typeof this.e.provider[this.namespace] !== "function") return false;
    const plan = this.plan(task);
    if (plan.items.length < 2) return false;
    this.ledger.db
      .prepare(
        `INSERT OR IGNORE INTO reading_${this.namespace}_intents VALUES(?,?,?,?)`,
      )
      .run(this.e.account, task.id, task.packet, plan.dependencyHash);
    return true;
  }
  *pairs(plan) {
    for (let a = 0; a < plan.chunks.length; a++)
      for (let b = a; b < plan.chunks.length; b++) {
        const items =
          a === b ? plan.chunks[a] : [...plan.chunks[a], ...plan.chunks[b]];
        if (items.length < 2) continue;
        const fingerprint = hash([
          this.version,
          plan.dependencyHash,
          a,
          b,
          items,
        ]);
        yield { items, fingerprint };
      }
  }
  proof(task, fingerprint) {
    const proof=this.ledger.db
      .prepare(
        `SELECT * FROM reading_${this.namespace}_proofs WHERE account=? AND task=? AND fingerprint=?`,
      )
      .get(this.e.account, task, fingerprint);
    if(proof)this.ledger.receipts.assertUsable(proof.call_id);return proof;
  }
  certify(task, fingerprint, callId, result) {
    this.ledger.receipts.assertUsable(callId);
    const value = sha256(JSON.stringify(result)),
      prior = this.proof(task.id, fingerprint),
      call = this.ledger.call(callId);
    if (
      !call ||
      call.state !== "settled" ||
      call.account !== this.e.account ||
      call.block !== fingerprint
    )
      fail();
    if (prior && (prior.result_hash !== value || prior.call_id !== callId))
      fail();
    this.ledger.db
      .prepare(
        `INSERT OR IGNORE INTO reading_${this.namespace}_proofs VALUES(?,?,?,?,?)`,
      )
      .run(this.e.account, task.id, fingerprint, callId, value);
  }
  verify(task, pair, row) {
    const proof = this.proof(task.id, pair.fingerprint),
      call = this.ledger.call(row.call_id);
    if (
      !proof ||
      proof.call_id !== row.call_id ||
      proof.result_hash !== sha256(row.result) ||
      !call ||
      call.state !== "settled" ||
      call.account !== this.e.account ||
      call.block !== pair.fingerprint
    )
      fail();
    return this.validate(JSON.parse(row.result), pair.items);
  }
  result(task, partial = false) {
    if (!this.active(task.id)) return null;
    const plan = this.plan(task),
      decisions = [];
    for (const pair of this.pairs(plan)) {
      const row = this.db
        .prepare(
          `SELECT * FROM reading_${this.namespace}_results WHERE task=? AND fingerprint=?`,
        )
        .get(task.id, pair.fingerprint);
      if (!row) {
        if (partial) continue;
        fail();
      }
      decisions.push(this.verify(task, pair, row));
    }
    try {
      return assembleMerge(plan.items, decisions);
    } catch (error) {
      if (partial && error.message === "INVALID_MERGE_CONFLICT")
        return assembleMerge(plan.items, []);
      throw error;
    }
  }
  async step(task, { signal, remainingMs, execution }) {
    const plan = this.plan(task);
    for (const pair of this.pairs(plan)) {
      const row = this.db
        .prepare(
          `SELECT * FROM reading_${this.namespace}_results WHERE task=? AND fingerprint=?`,
        )
        .get(task.id, pair.fingerprint);
      if (row) {
        this.verify(task, pair, row);
        continue;
      }
      let callId, result;
      const recovered = this.ledger.completedEnvelope(
        this.e.account,
        task.id,
        pair.fingerprint,
      );
      if (recovered) {
        callId = recovered.call_id;
        result = this.validate(JSON.parse(recovered.result), pair.items);
      } else {
        // A lost tenant decision cannot cause another payment or a guessed merge.
        if (this.proof(task.id, pair.fingerprint)) fail();
        // Exact dependency hash includes ALL current upstream result hashes,
        // model/prompt version and stable pair IDs; never semantic cache guesses.
        const old = this.db
          .prepare(
            `SELECT r.* FROM reading_${this.namespace}_results r JOIN reading_tasks t ON t.id=r.task
          WHERE r.fingerprint=? AND t.packet=? AND t.id!=? AND t.state!='purged' ORDER BY t.rowid DESC LIMIT 1`,
          )
          .get(pair.fingerprint, task.packet, task.id);
        if (old) {
          result = this.verify({ id: old.task }, pair, old);
          callId = old.call_id;
        } else {
          this.e.authorize(task.device);
          const remaining = remainingMs();
          if (remaining <= 0) throw Error("EXECUTION_LIMIT");
          const sources = [
            {
              id: this.namespace,
              name:this.namespace==="association"?"本次事项与已保存历史事项.json":"已校验付费事项.json",
              text: JSON.stringify({
                schema: this.version,
                items: pair.items,
              }),
            },
          ];
          const provider = this.e.provider[this.namespace];
          if (typeof provider !== "function") throw Error("MERGE_NOT_READY");
          const prepared = provider.prepare?.(sources, {
            maxOutputTokens: this.e.maxOutputTokens,
          });
          callId = randomUUID();
          this.ledger.reserve({
            callId,
            account: this.e.account,
            task: task.id,
            block: pair.fingerprint,
            generation: task.generation,
            priceId: prepared?.priceId || this.e.priceId,
            maxPromptTokens:
              prepared?.maxPromptTokens || this.e.maxPromptTokens,
            maxOutputTokens:
              prepared?.maxOutputTokens || this.e.maxOutputTokens,
          });
          this.ledger.sent(callId,prepared?.receiptIntent);
          this.db
            .prepare("UPDATE reading_tasks SET calls=calls+1 WHERE id=?")
            .run(task.id);
          execution.phase = "provider";
          let response;
          try {
            response = await provider(
              sources,
              AbortSignal.any([
                signal,
                AbortSignal.timeout(
                  Math.max(1, Math.min(240000, Math.floor(remaining))),
                ),
              ]),
              { prepared },
            );
          } catch (error) {
            if (this.e.finalSnapshots) return this.e.get(task.id);
            this.ledger.captureUnknownReceipt(callId,error?.receipt);
            this.ledger.unknown(callId);
            throw Error("UNKNOWN_COST");
          }
          if (this.e.finalSnapshots) return this.e.get(task.id);
          try {
            validateUsage(response.usage);
          } catch {
            this.ledger.captureUnknownReceipt(callId,response.receipt);
            this.ledger.unknown(callId);
            throw Error("UNKNOWN_COST");
          }
          if (!this.e.current(task)) {
            this.ledger.settle(callId, response.usage,response.receipt);
            return this.e.get(task.id);
          }
          try {
            result = this.validate(response.result, pair.items);
          } catch (error) {
            this.ledger.settle(callId, response.usage,response.receipt);
            throw error;
          }
          this.ledger.saveEnvelope(
            callId,
            pair.fingerprint,
            result,
            response.usage,
          );
          this.ledger.settle(callId, response.usage,response.receipt);
        }
      }
      this.certify(task, pair.fingerprint, callId, result);
      this.db
        .prepare(
          `INSERT INTO reading_${this.namespace}_results VALUES(?,?,?,?)`,
        )
        .run(task.id, pair.fingerprint, callId, JSON.stringify(result));
      this.ledger.clearEnvelope(callId);
      // Reused calls are not fresh checkpoint progress.
      if (this.ledger.call(callId).task === task.id)
        this.e.roots.progress(task.id, pair.fingerprint);
      return this.e.get(task.id);
    }
    return this.complete(task);
  }
  purge(task) {
    this.db
      .prepare(`DELETE FROM reading_${this.namespace}_results WHERE task=?`)
      .run(task);
  }
}
