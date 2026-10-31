import { randomUUID } from "node:crypto";
import { sha256 } from "./material.mjs";
import { validateUsage } from "./ledger.mjs";

export const VISUAL_REVIEW_VERSION = "visual-grounding/1";
const hash = (value) => sha256(JSON.stringify(value));
const fail = () => {
  throw Error("SAFETY_RECONCILIATION");
};

// Review only existing bounded paid claims. A reviewer cannot rewrite content,
// invent a new fact/source/date, omit a claim or turn a suggestion into a fact.
export function visualClaims(result, imageIds) {
  const claims = [];
  const add = (id, item, field, index, text) => {
    if (typeof text !== "string" || !text.trim()) return;
    claims.push({ id, item, field, index, text });
  };
  add("summary", null, "summary", null, result.summary);
  result.items.forEach((item, i) => {
    if (!item.evidence.some((e) => imageIds.has(e.sourceId))) return;
    add(`i${i}_title`, i, "title", null, item.title);
    add(`i${i}_summary`, i, "summary", null, item.summary);
    for (const field of ["facts", "nextSteps"])
      item[field].forEach((text, n) =>
        add(`i${i}_${field}_${n}`, i, field, n, text),
      );
    if (item.due) add(`i${i}_due`, i, "due", null, JSON.stringify(item.due));
    item.evidence.forEach((e, n) => {
      if (imageIds.has(e.sourceId))
        add(`i${i}_quote_${n}`, i, "evidence", n, e.quote);
    });
  });
  return claims;
}
export function validateVisualReview(value, claims) {
  if (
    !value ||
    Object.keys(value).join() !== "claims" ||
    !Array.isArray(value.claims) ||
    value.claims.length !== claims.length
  )
    throw Error("INVALID_VISUAL_REVIEW");
  const seen = new Map();
  for (const row of value.claims) {
    const claim = claims.find((c) => c.id === row?.id);
    if (
      !claim ||
      seen.has(row.id) ||
      Object.keys(row).sort().join() !== "id,reason,status" ||
      !["supported", "unsupported", "uncertain", "suggestion"].includes(
        row.status,
      ) ||
      typeof row.reason !== "string" ||
      row.reason.length > 150 ||
      (["unsupported", "uncertain"].includes(row.status) &&
        !row.reason.trim()) ||
      (row.status === "suggestion" && claim.field !== "nextSteps")
    )
      throw Error("INVALID_VISUAL_REVIEW");
    seen.set(row.id, {
      id: row.id,
      status: row.status,
      reason: row.reason.trim(),
    });
  }
  return { claims: claims.map((c) => seen.get(c.id)) };
}
export function projectVisualReview(result, claims, decisions) {
  const review = validateVisualReview({ claims: decisions }, claims),
    output = structuredClone(result);
  const remove = new Map();
  let uncertain = 0;
  const preserve = (claim, reason) => {
    const target =
      claim.item === null
        ? output.warnings
        : output.items[claim.item].uncertainties;
    const prefix =
      claim.item === null
        ? "图像摘要待核对："
        : "图像依据待核对（不作为原文要求）：";
    const chars = [...claim.text];
    for (let n = 0; n < chars.length; n += 320)
      target.push(
        prefix +
          chars.slice(n, n + 320).join("") +
          (reason ? `（${[...reason].slice(0, 80).join("")}）` : ""),
      );
  };
  for (let n = 0; n < claims.length; n++) {
    const claim = claims[n],
      decision = review.claims[n];
    if (["supported", "suggestion"].includes(decision.status)) continue;
    uncertain++;
    preserve(claim, decision.reason);
    if (claim.item === null) {
      output.summary = "图像事项中有内容尚待核对";
      continue;
    }
    const item = output.items[claim.item];
    if (["facts", "nextSteps"].includes(claim.field)) {
      const key = claim.item + ":" + claim.field;
      if (!remove.has(key)) remove.set(key, new Set());
      remove.get(key).add(claim.index);
    } else if (claim.field === "evidence")
      item.evidence[claim.index].quote = "";
    else if (claim.field === "due") item.due = null;
    else item[claim.field] = claim.field === "title" ? "待核对的图像事项" : "";
  }
  for (const [key, indices] of remove) {
    const [i, field] = key.split(":");
    output.items[i][field] = output.items[i][field].filter(
      (_, n) => !indices.has(n),
    );
  }
  if (uncertain)
    output.warnings.push(
      `图像依据核对：${uncertain}处内容缺少明确依据，已转为待确认`,
    );
  if (
    output.warnings.length > 9 ||
    output.items.some(
      (i) =>
        i.uncertainties.length > 8 ||
        i.uncertainties.some((t) => t.length > 500),
    )
  )
    throw Error("VISUAL_REVIEW_CONTEXT_LIMIT");
  return { result: output, checked: claims.length, uncertain };
}

export class ReadingVisualReview {
  constructor(engine) {
    this.e = engine;
    this.db = engine.db;
    this.ledger = engine.ledger;
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS reading_visual_results(task TEXT NOT NULL,fingerprint TEXT NOT NULL,
      upstream TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(task,fingerprint));`);
    this.ledger.db
      .exec(`CREATE TABLE IF NOT EXISTS reading_visual_inputs(account TEXT NOT NULL,task TEXT NOT NULL,
      upstream TEXT NOT NULL,packet TEXT NOT NULL,ranges_hash TEXT NOT NULL,images_hash TEXT NOT NULL,PRIMARY KEY(account,task,upstream));
      CREATE TABLE IF NOT EXISTS reading_visual_intents(account TEXT NOT NULL,task TEXT NOT NULL,packet TEXT NOT NULL,
      upstream TEXT NOT NULL,dependency_hash TEXT NOT NULL,claims_hash TEXT NOT NULL,chunks TEXT NOT NULL,
      PRIMARY KEY(account,task,upstream));
      CREATE TABLE IF NOT EXISTS reading_visual_proofs(account TEXT NOT NULL,task TEXT NOT NULL,fingerprint TEXT NOT NULL,
      upstream TEXT NOT NULL,call_id TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account,task,fingerprint));`);
    for (const table of [
      "reading_visual_inputs",
      "reading_visual_intents",
      "reading_visual_proofs",
    ])
      for (const action of ["UPDATE", "DELETE"])
        this.ledger.db
          .exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${action.toLowerCase()}
        BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISUAL_PROOF'); END;`);
  }
  enabled() {
    return typeof this.e.provider.reviewVisual === "function";
  }
  input(task, upstream) {
    return this.ledger.db
      .prepare(
        "SELECT * FROM reading_visual_inputs WHERE account=? AND task=? AND upstream=?",
      )
      .get(this.e.account, task, upstream);
  }
  bind(task, batch, fingerprint) {
    const previous = this.input(task.id, fingerprint),
      images = batch.filter((s) => s.image);
    const rangesHash = hash(batch.map((s) => s.range)),
      imagesHash = hash(images.map((s) => [s.sourceId, s.image.hash]));
    if (
      previous &&
      (previous.packet !== task.packet ||
        previous.ranges_hash !== rangesHash ||
        previous.images_hash !== imagesHash)
    )
      fail();
    if (!previous && images.length && this.enabled())
      this.ledger.db
        .prepare("INSERT INTO reading_visual_inputs VALUES(?,?,?,?,?,?)")
        .run(
          this.e.account,
          task.id,
          fingerprint,
          task.packet,
          rangesHash,
          imagesHash,
        );
    return !!previous || (images.length > 0 && this.enabled());
  }
  intent(task, upstream) {
    return this.ledger.db
      .prepare(
        "SELECT * FROM reading_visual_intents WHERE account=? AND task=? AND upstream=?",
      )
      .get(this.e.account, task, upstream);
  }
  proof(task, fingerprint) {
    return this.ledger.db
      .prepare(
        "SELECT * FROM reading_visual_proofs WHERE account=? AND task=? AND fingerprint=?",
      )
      .get(this.e.account, task, fingerprint);
  }
  publishable(task) {
    return this.db
      .prepare("SELECT * FROM reading_blocks WHERE task=?")
      .all(task.id)
      .some((b) => {
        try {
          return !!this.effective(task, b, true);
        } catch {
          return false;
        }
      });
  }
  active(task) {
    if (this.e.get(task)?.state === "purged") return false;
    const raw = this.db
      .prepare("SELECT fingerprint FROM reading_blocks WHERE task=?")
      .all(task);
    if (
      raw.some(
        (b) =>
          this.input(task, b.fingerprint) && !this.intent(task, b.fingerprint),
      )
    )
      return true;
    const intents = this.ledger.db
      .prepare(
        "SELECT chunks FROM reading_visual_intents WHERE account=? AND task=?",
      )
      .all(this.e.account, task);
    return intents.some((r) =>
      JSON.parse(r.chunks).some(
        (f) =>
          !this.db
            .prepare(
              "SELECT 1 FROM reading_visual_results WHERE task=? AND fingerprint=?",
            )
            .get(task, f),
      ),
    );
  }
  upstream(task, block) {
    const copied = this.db
      .prepare(
        "SELECT * FROM reading_reused_blocks WHERE task=? AND fingerprint=?",
      )
      .get(task.id, block.fingerprint);
    const proof = copied
      ? this.e.reuse.proof(copied.source_task, copied.source_fingerprint)
      : this.e.reuse.proof(task.id, block.fingerprint);
    const call = this.ledger.call(block.call_id),
      root = this.e.roots.stats(task.id);
    if (
      !proof ||
      !call ||
      call.state !== "settled" ||
      call.account !== this.e.account ||
      proof.call_id !== call.id ||
      proof.result_hash !== sha256(block.result) ||
      call.task !== proof.task ||
      call.block !== proof.fingerprint ||
      !this.e.roots.safety.tasks(root.id).includes(call.task)
    )
      fail();
    return proof;
  }
  plan(task, batch, block) {
    const proof = this.upstream(task, block),
      raw = JSON.parse(block.result),
      images = batch.filter((s) => s.image);
    const claims = visualClaims(raw, new Set(images.map((s) => s.sourceId)));
    const dependencyHash = hash([
      VISUAL_REVIEW_VERSION,
      this.e.modelVersion,
      proof.reuse_key,
      proof.result_hash,
      batch.map((s) => [
        s.sourceId,
        s.range,
        sha256(s.text),
        s.image?.hash || null,
      ]),
    ]);
    const chunks = [];
    let chunk = [],
      size = 0;
    for (const claim of claims) {
      const bytes = Buffer.byteLength(JSON.stringify(claim));
      if (chunk.length && (chunk.length >= 16 || size + bytes > 56000)) {
        chunks.push(chunk);
        chunk = [];
        size = 0;
      }
      chunk.push(claim);
      size += bytes;
    }
    if (chunk.length) chunks.push(chunk);
    const jobs = chunks.map((claims, n) => ({
      claims,
      fingerprint: hash([VISUAL_REVIEW_VERSION, dependencyHash, n, claims]),
    }));
    const prior = this.intent(task.id, block.fingerprint),
      claimsHash = hash(claims),
      fingerprints = JSON.stringify(jobs.map((j) => j.fingerprint));
    if (
      prior &&
      (prior.packet !== task.packet ||
        prior.dependency_hash !== dependencyHash ||
        prior.claims_hash !== claimsHash ||
        prior.chunks !== fingerprints)
    )
      fail();
    this.ledger.db
      .prepare(
        "INSERT OR IGNORE INTO reading_visual_intents VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        this.e.account,
        task.id,
        task.packet,
        block.fingerprint,
        dependencyHash,
        claimsHash,
        fingerprints,
      );
    return { raw, claims, jobs, images, dependencyHash };
  }
  verify(task, job, row) {
    const proof = this.proof(task.id, job.fingerprint),
      call = this.ledger.call(row.call_id);
    if (
      !proof ||
      !call ||
      call.account !== this.e.account ||
      call.state !== "settled" ||
      call.block !== job.fingerprint ||
      proof.call_id !== call.id ||
      proof.result_hash !== sha256(row.result) ||
      proof.upstream !== row.upstream ||
      !this.e.roots.safety
        .tasks(this.e.roots.stats(task.id).id)
        .includes(call.task)
    )
      fail();
    return validateVisualReview(JSON.parse(row.result), job.claims);
  }
  certify(task, upstream, fingerprint, callId, result) {
    const call = this.ledger.call(callId),
      prior = this.proof(task.id, fingerprint),
      resultHash = hash(result);
    if (
      !call ||
      call.state !== "settled" ||
      call.account !== this.e.account ||
      call.block !== fingerprint ||
      (prior &&
        (prior.call_id !== callId ||
          prior.result_hash !== resultHash ||
          prior.upstream !== upstream))
    )
      fail();
    this.ledger.db
      .prepare(
        "INSERT OR IGNORE INTO reading_visual_proofs VALUES(?,?,?,?,?,?)",
      )
      .run(this.e.account, task.id, fingerprint, upstream, callId, resultHash);
  }
  complete(task, plan) {
    return plan.jobs.every((job) => {
      const row = this.db
        .prepare(
          "SELECT * FROM reading_visual_results WHERE task=? AND fingerprint=?",
        )
        .get(task.id, job.fingerprint);
      if (!row) return false;
      this.verify(task, job, row);
      return true;
    });
  }
  effective(task, block, partial = false) {
    const ranges = JSON.parse(
      this.db
        .prepare(
          "SELECT ranges FROM reading_block_ranges WHERE task=? AND fingerprint=?",
        )
        .get(task.id, block.fingerprint)?.ranges || "[]",
    );
    const input = this.input(task.id, block.fingerprint);
    if (!input) {
      if (this.enabled() && ranges.some((r) => r.kind === "image")) {
        if (partial) return null;
        throw Error("VISUAL_REVIEW_REQUIRED");
      }
      return { result: JSON.parse(block.result), dependency: null };
    }
    if (input.ranges_hash !== hash(ranges) || input.packet !== task.packet)
      fail();
    this.upstream(task, block);
    const intent = this.intent(task.id, block.fingerprint);
    if (!intent) {
      if (partial) return null;
      throw Error("VISUAL_REVIEW_REQUIRED");
    }
    const raw = JSON.parse(block.result),
      claims = visualClaims(
        raw,
        new Set(
          ranges.filter((r) => r.kind === "image").map((r) => r.sourceId),
        ),
      );
    if (hash(claims) !== intent.claims_hash) fail();
    const decisions = [],
      proofs = [];
    for (const fingerprint of JSON.parse(intent.chunks)) {
      const row = this.db
        .prepare(
          "SELECT * FROM reading_visual_results WHERE task=? AND fingerprint=?",
        )
        .get(task.id, fingerprint);
      if (!row) {
        if (partial) return null;
        throw Error("VISUAL_REVIEW_REQUIRED");
      }
      const value = JSON.parse(row.result),
        job = {
          fingerprint,
          claims: claims.filter((c) => value.claims.some((v) => v.id === c.id)),
        };
      decisions.push(...this.verify(task, job, row).claims);
      proofs.push([fingerprint, sha256(row.result)]);
    }
    return {
      ...projectVisualReview(raw, claims, decisions),
      dependency: hash([VISUAL_REVIEW_VERSION, intent.dependency_hash, proofs]),
    };
  }
  async step(task, batch, block, plan, { signal, remainingMs, execution }) {
    for (const job of plan.jobs) {
      const present = this.db
        .prepare(
          "SELECT * FROM reading_visual_results WHERE task=? AND fingerprint=?",
        )
        .get(task.id, job.fingerprint);
      if (present) {
        this.verify(task, job, present);
        continue;
      }
      let callId, result;
      const recovered = this.ledger.completedEnvelope(
        this.e.account,
        task.id,
        job.fingerprint,
      );
      if (recovered) {
        callId = recovered.call_id;
        result = validateVisualReview(JSON.parse(recovered.result), job.claims);
      } else {
        if (this.proof(task.id, job.fingerprint)) fail();
        const old = this.db
          .prepare(
            `SELECT r.* FROM reading_visual_results r JOIN reading_tasks t ON t.id=r.task
          WHERE r.fingerprint=? AND t.packet=? AND t.id!=? AND t.state!='purged' ORDER BY t.rowid DESC LIMIT 1`,
          )
          .get(job.fingerprint, task.packet, task.id);
        if (old) {
          result = this.verify({ id: old.task }, job, old);
          callId = old.call_id;
        } else {
          this.e.authorize(task.device);
          const remaining = remainingMs();
          if (remaining <= 0) throw Error("EXECUTION_LIMIT");
          const context = {
            schema: VISUAL_REVIEW_VERSION,
            captureDate: this.e.store.record(task.packet).data.captureDate,
            claims: job.claims,
            evidence: batch.map((s) => ({
              sourceId: s.sourceId,
              text: s.text,
            })),
          };
          const text = JSON.stringify(context);
          if (text.length > 110000) throw Error("VISUAL_REVIEW_CONTEXT_LIMIT");
          const sources = [
            { id: "review", name: "已付费图像事项依据核对.json", text },
            ...plan.images.map((s) => ({
              id: s.sourceId,
              name: s.range.name || "图像区域",
              text: s.text,
              image: s.image,
            })),
          ];
          const provider = this.e.provider.reviewVisual;
          if (typeof provider !== "function")
            throw Error("VISUAL_REVIEW_NOT_READY");
          const prepared = provider.prepare?.(sources, {
            captureDate: context.captureDate,
            maxOutputTokens: this.e.maxOutputTokens,
          });
          const callRemaining = remainingMs();
          if (callRemaining <= 0) throw Error("EXECUTION_LIMIT");
          callId = randomUUID();
          this.ledger.reserve({
            callId,
            account: this.e.account,
            task: task.id,
            block: job.fingerprint,
            generation: task.generation,
            priceId: prepared?.priceId || this.e.priceId,
            maxPromptTokens:
              prepared?.maxPromptTokens || this.e.maxPromptTokens,
            maxOutputTokens:
              prepared?.maxOutputTokens || this.e.maxOutputTokens,
          });
          this.ledger.sent(callId);
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
                  Math.max(1, Math.min(240000, Math.floor(callRemaining))),
                ),
              ]),
              { prepared },
            );
          } catch {
            if (this.e.finalSnapshots) return this.e.get(task.id);
            this.ledger.unknown(callId);
            throw Error("UNKNOWN_COST");
          }
          if (this.e.finalSnapshots) return this.e.get(task.id);
          try {
            validateUsage(response.usage);
          } catch {
            this.ledger.unknown(callId);
            throw Error("UNKNOWN_COST");
          }
          if (!this.e.current(task)) {
            this.ledger.settle(callId, response.usage);
            return this.e.get(task.id);
          }
          try {
            result = validateVisualReview(response.result, job.claims);
          } catch (error) {
            this.ledger.settle(callId, response.usage);
            throw error;
          }
          this.ledger.saveEnvelope(
            callId,
            job.fingerprint,
            result,
            response.usage,
          );
          this.ledger.settle(callId, response.usage);
        }
      }
      this.certify(task, block.fingerprint, job.fingerprint, callId, result);
      this.db
        .prepare("INSERT INTO reading_visual_results VALUES(?,?,?,?,?)")
        .run(
          task.id,
          job.fingerprint,
          block.fingerprint,
          callId,
          JSON.stringify(result),
        );
      this.ledger.clearEnvelope(callId);
      if (this.ledger.call(callId).task === task.id)
        this.e.roots.progress(task.id, job.fingerprint);
      return this.e.get(task.id);
    }
    return this.e.get(task.id);
  }
  purge(task) {
    this.db
      .prepare("DELETE FROM reading_visual_results WHERE task=?")
      .run(task);
  }
}
