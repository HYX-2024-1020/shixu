import { ensureDatabaseSchema } from "../database-schema.mjs";
import { READING_REMAINDERS_SCHEMA, LEDGER_REMAINDERS_SCHEMA } from "../database-schemas.mjs";
import { SyncError } from "../sync-store.mjs";
import { sha256 } from "./material.mjs";

const fail = code => { throw new SyncError(409, code, code === "REMAINDER_EXISTS"
  ? "剩余材料已有接续任务，请在任务列表中继续"
  : "接续依据已变化，请先同步并核对；已收下事项保留"); };

// A partial publication is terminal. Its explicit successor shares the same
// root counters but only publishes work not previously accepted by the user.
export class ReadingRemainders {
  constructor(engine) {
    this.e = engine;
    this.db = engine.db;
    this.ledger = engine.ledger;
    ensureDatabaseSchema(this.db, "tenant-remainders", READING_REMAINDERS_SCHEMA);
    ensureDatabaseSchema(this.ledger.db, "ledger-remainders", LEDGER_REMAINDERS_SCHEMA);
  }
  info(task) {
    const id = typeof task === "string" ? task : task.id;
    const row = this.db.prepare("SELECT * FROM reading_remainders WHERE task=?").get(id);
    const intent = this.ledger.db.prepare("SELECT * FROM reading_remaining_intents WHERE account=? AND task=?").get(this.e.account, id);
    if (!row && !intent) return null;
    if (!row || !intent || row.parent !== intent.parent || sha256(row.context) !== intent.context_hash) fail("SAFETY_RECONCILIATION");
    const context = JSON.parse(row.context);
    const current = this.e.get(id);
    if (!current || context.packet !== current.packet || context.revision !== current.input_revision ||
        context.modelVersion !== this.e.modelVersion) fail("SAFETY_RECONCILIATION");
    return { parent: row.parent, ...context };
  }
  child(parent) {
    return this.db.prepare("SELECT task FROM reading_remainders WHERE parent=?").get(parent)?.task;
  }
  prepare(parentId, packet, revision, review) {
    const parent = this.e.get(parentId);
    if (!parent || parent.packet !== packet || parent.state !== "partial" || this.e.chat.isChat(parentId) ||
        parent.input_revision !== revision) fail("INVALID_REMAINDER");
    if (!review || Object.keys(review).sort().join(",") !== "expectedGeneration,expectedMaintenanceOperation,expectedRevision" ||
        review.expectedGeneration !== parent.generation || review.expectedRevision !== parent.input_revision ||
        review.expectedMaintenanceOperation !== this.e.maintenanceOperation(parentId)) fail("STALE_TASK");
    if (this.child(parentId)) fail("REMAINDER_EXISTS");
    this.e.windows.safety.assertRoot(parentId);
    if (!this.db.prepare("SELECT 1 FROM reading_publications WHERE task=?").get(parentId)) fail("SAFETY_RECONCILIATION");
    const previous = this.info(parent);
    const excluded = new Set(previous?.excluded || []);
    const ranges = [...(previous?.ranges || [])];
    const processed = new Set((this.e.store.record(packet).data.processingCoverage?.processed || []).map(range => JSON.stringify(range)));
    for (const block of this.db.prepare("SELECT * FROM reading_blocks WHERE task=? ORDER BY rowid").all(parentId)) {
      const row = this.db.prepare("SELECT ranges FROM reading_block_ranges WHERE task=? AND fingerprint=?").get(parentId, block.fingerprint);
      if (!row) fail("SAFETY_RECONCILIATION");
      const covered = JSON.parse(row.ranges);
      // Only blocks actually included in the partial publication are excluded.
      if (!covered.every(range => processed.has(JSON.stringify(range)))) continue;
      if (this.e.readingFingerprint(parent, covered) !== block.fingerprint) fail("REMAINDER_CONTEXT_CHANGED");
      if (!this.e.visual.effective(parent, block, true)) fail("SAFETY_RECONCILIATION");
      excluded.add(block.fingerprint);
      ranges.push(...covered);
    }
    if (!excluded.size) fail("INVALID_REMAINDER");
    return JSON.stringify({ packet, revision, modelVersion: this.e.modelVersion, review, excluded: [...excluded].sort(),
      ranges: [...new Map(ranges.map(range => [JSON.stringify(range), range])).values()] });
  }
  register(task, parent, context) {
    const hash = sha256(context);
    const intent = this.ledger.db.prepare("SELECT * FROM reading_remaining_intents WHERE account=? AND (task=? OR parent=?)")
      .get(this.e.account, task.id, parent);
    if (intent && (intent.task !== task.id || intent.parent !== parent || intent.context_hash !== hash)) fail("SAFETY_RECONCILIATION");
    this.ledger.db.prepare("INSERT OR IGNORE INTO reading_remaining_intents VALUES(?,?,?,?)").run(this.e.account, task.id, parent, hash);
    this.db.prepare("INSERT INTO reading_remainders VALUES(?,?,?)").run(task.id, parent, context);
  }
  append(task, publication) {
    const info = this.info(task);
    if (!info) return publication;
    const current = this.e.store.record(task.packet).data;
    if (!current.result || !Array.isArray(current.result.items) || !Array.isArray(current.itemIds) ||
        current.result.items.length !== current.itemIds.length) fail("ACCEPTED_RESULTS_CHANGED");
    const processed = [...new Map([...info.ranges, ...publication.processingCoverage.processed]
      .map(range => [JSON.stringify(range), range])).values()];
    const keys = new Set(processed.map(range => JSON.stringify(range)));
    // Apply the cumulative citation cap at publication, never mutate a paid
    // block or its immutable reuse certificate to fit a presentation budget.
    const attachments = new Map([...(current.readingCoverage || []), ...(publication.readingCoverage || [])]
      .flatMap(m => (m.covered || []).map(range => [range.sourceId, m.attachmentId])));
    const totals = new Map();
    for (const item of current.result.items) for (const evidence of item.evidence || []) {
      const attachment = attachments.get(evidence.sourceId);
      if (attachment) totals.set(attachment, (totals.get(attachment) || 0) + (evidence.quote?.length || 0));
    }
    const items = publication.result.items.map(item => ({ ...item, evidence: (item.evidence || []).map(evidence => {
      const attachment = attachments.get(evidence.sourceId);
      if (!attachment) return evidence;
      let quote = evidence.quote.slice(0, Math.max(0, 2000 - (totals.get(attachment) || 0)));
      if (/[\ud800-\udbff]$/.test(quote)) quote = quote.slice(0, -1);
      totals.set(attachment, (totals.get(attachment) || 0) + quote.length);
      return { ...evidence, quote };
    }) }));
    return { ...publication,
      result: { ...publication.result, summary: [current.result.summary, publication.result.summary].filter(Boolean).join("\n"),
        warnings: [...new Set([...(current.result.warnings || []), ...publication.result.warnings])],
        items: [...current.result.items, ...items] },
      itemIds: [...current.itemIds, ...publication.itemIds],
      association: { links: [...(current.association?.links || []), ...(publication.association?.links || [])] },
      processingCoverage: { ...publication.processingCoverage, processed,
        pending: publication.processingCoverage.pending.filter(range => !keys.has(JSON.stringify(range))) },
    };
  }
}
