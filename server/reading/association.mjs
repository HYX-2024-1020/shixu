import { ReadingMerge } from "./merge.mjs";
import { sha256 } from "./material.mjs";
import { absoluteItem, buildGroups } from "../generated/ai-core.mjs";
export const ASSOCIATION_VERSION = "saved-history-association/1";
const hash = (v) => sha256(JSON.stringify(v));
const eligible = (i) => ["task", "idea", "habit"].includes(i.kind);
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === keys;
const dueKey = (d) =>
  d ? JSON.stringify([d.date, d.time, d.endDate, d.endTime]) : null;
const evidence = (proof, item) =>
  exact(proof, "quote,sourceId") &&
  typeof proof.quote === "string" &&
  proof.quote.trim().length >= 2 &&
  proof.quote.length <= 400 &&
  typeof proof.sourceId === "string" &&
  proof.sourceId.length <= 200 &&
  (item.evidence || []).some(
    (e) => e.sourceId === proof.sourceId && e.quote.includes(proof.quote),
  );
export function validateAssociation(value, items) {
  if (
    !exact(value, "links") ||
    !Array.isArray(value.links) ||
    value.links.length > items.filter((i) => i.role === "new").length
  )
    throw Error("INVALID_ASSOCIATION_OUTPUT");
  const byId = new Map(items.map((i) => [i.id, i])),
    seen = new Set(),
    links = [];
  for (const raw of value.links) {
    if (
      !exact(
        raw,
        "confidence,from,newEvidence,oldEvidence,relation,target,title",
      ) ||
      !Number.isFinite(raw.confidence) ||
      raw.confidence < 0 ||
      raw.confidence > 1
    )
      throw Error("INVALID_ASSOCIATION_OUTPUT");
    if (raw.confidence < 0.9) continue;
    const a = byId.get(raw.from),
      b = byId.get(raw.target);
    if (
      !a ||
      !b ||
      a.role !== "new" ||
      b.role !== "history" ||
      seen.has(a.id) ||
      a.item.kind !== b.item.kind ||
      !eligible(a.item) ||
      !["same", "related"].includes(raw.relation) ||
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      raw.title.length > 150 ||
      !evidence(raw.newEvidence, a.item) ||
      !evidence(raw.oldEvidence, b.item)
    )
      throw Error("INVALID_ASSOCIATION_SOURCE");
    if (
      raw.relation === "same" &&
      a.item.due &&
      b.unitDue &&
      dueKey(a.item.due) !== dueKey(b.unitDue)
    )
      throw Error("INVALID_ASSOCIATION_CONFLICT");
    seen.add(a.id);
    links.push({ ...structuredClone(raw), title: raw.title.trim() });
  }
  return { links };
}
const chunks = (rows) => {
  const chunks = [];
  let batch = [],
    bytes = 0;
  for (const row of rows) {
    const n = Buffer.byteLength(JSON.stringify(row));
    if (n > 56000) throw Error("ASSOCIATION_CONTEXT_LIMIT");
    if (batch.length && (batch.length === 16 || bytes + n > 56000)) {
      chunks.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += n;
  }
  if (batch.length) chunks.push(batch);
  return chunks;
};
// All saved open candidates are visited; no keyword-only filter or recency cut.
// Models can only add links to existing items, never rewrite old/new content.
export class ReadingAssociation extends ReadingMerge {
  constructor(engine) {
    super(engine, { namespace: "association", version: ASSOCIATION_VERSION });
  }
  validate(value, items) {
    return validateAssociation(value, items);
  }
  plan(task) {
    const upstream = this.e.merge.plan(task),
      semantic = this.e.merge.result(task),
      result = semantic?.items || upstream.items.map((r) => r.item),
      fresh = result
        .map((item, index) => ({
          id: "new:" + index,
          index,
          role: "new",
          item,
        }))
        .filter((r) => eligible(r.item));
    if (!fresh.length) {
      if (this.intent(task.id)) throw Error("ASSOCIATION_INPUT_CHANGED");
      return {
        items: [],
        fresh: [],
        history: [],
        freshChunks: [],
        historyChunks: [],
        dependencyHash: hash([ASSOCIATION_VERSION, upstream.dependencyHash]),
      };
    }
    const kinds = new Set(fresh.map((r) => r.item.kind));
    const packets = [];
    let metadataBytes = 0;
    for (const { id } of this.db
      .prepare(
        "SELECT id FROM sync_records WHERE deleted_at IS NULL AND purged=0 ORDER BY id",
      )
      .iterate()) {
      if (id === task.packet) continue;
      const p = this.e.store.record(id).data;
      if (p.status !== "ready" || !Array.isArray(p.result?.items)) continue;
      const value = {
        id,
        capturedAt: p.capturedAt || p.updatedAt || "",
        captureDate: p.captureDate,
        status: "ready",
        itemIds: p.itemIds,
        association: p.association,
        doneIds: p.doneIds || [],
        itemState: Object.fromEntries(
          Object.entries(p.itemState || {}).map(([id, m]) => [
            id,
            { status: m.status, deletedAt: m.deletedAt, purgedAt: m.purgedAt },
          ]),
        ),
        result: {
          ...p.result,
          items: p.result.items.map((item, index) => {
            const meta =
                p.itemState?.[p.itemIds?.[index] || id + ":" + index] || {},
              next = { ...item };
            for (const field of [
              "title",
              "summary",
              "facts",
              "nextSteps",
              "uncertainties",
              "kind",
              "group",
              "due",
            ])
              if (field in meta) next[field] = meta[field];
            return absoluteItem(next, p.captureDate, [], meta.chat);
          }),
        },
      };
      metadataBytes += Buffer.byteLength(JSON.stringify(value));
      if (metadataBytes > 16 * 1024 * 1024)
        throw Error("ASSOCIATION_CONTEXT_LIMIT");
      packets.push(value);
    }
    const groups = buildGroups(packets),
      history = [],
      groupByRef = new Map(),
      unitByRef = new Map();
    for (const group of groups) {
      for (const ref of group.refs) groupByRef.set(ref, group);
      for (const unit of group.units)
        for (const ref of unit.refs) unitByRef.set(ref, unit);
    }
    for (const p of packets)
      for (let index = 0; index < p.result.items.length; index++) {
        const item = p.result.items[index],
          itemId = p.itemIds?.[index] ?? String(index),
          meta = p.itemState?.[p.itemIds?.[index] || p.id + ":" + index] || {};
        if (
          meta.deletedAt ||
          meta.purgedAt ||
          meta.status === "done" ||
          p.doneIds.includes(index) ||
          !eligible(item) ||
          !kinds.has(item.kind)
        )
          continue;
        const id = p.id + "#" + itemId,
          group = groupByRef.get(id),
          unit = unitByRef.get(id);
        history.push({
          id,
          role: "history",
          item,
          unitDue: unit?.item.due || item.due,
          group: group
            ? {
                id: group.id,
                title: group.title,
                refs: group.refs,
                members: group.units.map((u) => ({
                  title: u.item.title,
                  done: u.done,
                })),
              }
            : null,
        });
      }
    const dependencyHash = hash([
        ASSOCIATION_VERSION,
        this.e.account,
        task.packet,
        this.e.modelVersion,
        upstream.dependencyHash,
        semantic?.items || null,
        fresh,
        history,
      ]),
      prior = this.intent(task.id);
    if (
      prior &&
      (prior.packet !== task.packet || prior.dependency_hash !== dependencyHash)
    )
      throw Error("ASSOCIATION_INPUT_CHANGED");
    return {
      items: [...fresh, ...history],
      fresh,
      history,
      freshChunks: history.length ? chunks(fresh) : [],
      historyChunks: history.length ? chunks(history) : [],
      dependencyHash,
    };
  }
  begin(task) {
    if (typeof this.e.provider.association !== "function") return false;
    const plan = this.plan(task);
    if (!plan.fresh.length || !plan.history.length) return false;
    this.ledger.db
      .prepare(
        "INSERT OR IGNORE INTO reading_association_intents VALUES(?,?,?,?)",
      )
      .run(this.e.account, task.id, task.packet, plan.dependencyHash);
    return true;
  }
  *pairs(plan) {
    for (let a = 0; a < plan.freshChunks.length; a++)
      for (let b = 0; b < plan.historyChunks.length; b++) {
        const items = [...plan.freshChunks[a], ...plan.historyChunks[b]];
        yield {
          items,
          fingerprint: hash([
            ASSOCIATION_VERSION,
            plan.dependencyHash,
            a,
            b,
            items,
          ]),
        };
      }
  }
  result(task, partial = false) {
    if (!this.active(task.id) || partial) return null;
    const plan = this.plan(task),
      choices = [];
    for (const pair of this.pairs(plan)) {
      const row = this.db
        .prepare(
          "SELECT * FROM reading_association_results WHERE task=? AND fingerprint=?",
        )
        .get(task.id, pair.fingerprint);
      if (!row) throw Error("SAFETY_RECONCILIATION");
      choices.push(...this.verify(task, pair, row).links);
    }
    const links = [],
      warnings = [],
      historyById = new Map(plan.history.map((r) => [r.id, r]));
    const root = (id) => {
      const r = historyById.get(id);
      return r?.group?.id || id;
    };
    for (const item of plan.fresh) {
      const ranked = choices
        .filter((c) => c.from === item.id)
        .sort(
          (a, b) =>
            b.confidence - a.confidence || a.target.localeCompare(b.target),
        );
      if (!ranked.length) continue;
      if (
        ranked[1] &&
        ranked[0].confidence - ranked[1].confidence < 0.03 &&
        root(ranked[0].target) !== root(ranked[1].target)
      ) {
        warnings.push("有多个相近历史事项，已保持独立，请核对");
        continue;
      }
      const raw = ranked[0],
        target = historyById.get(raw.target),
        from = task.packet + "#" + task.id + "_item_" + item.index;
      links.push({
        id:
          task.id +
          "_history_" +
          hash([from, raw.target, raw.relation]).slice(0, 20),
        from,
        target: raw.target,
        relation: raw.relation,
        title: raw.title,
        confidence: raw.confidence,

        contextRefs: [from, ...(target.group?.refs || [target.id])],
      });
    }
    return {
      links,
      warnings,
      version: ASSOCIATION_VERSION,
      complete: true,
      candidates: plan.history.length,
    };
  }
  complete(task) {
    return this.e.publish(task, JSON.parse(this.e.get(task.id).coverage));
  }
}
