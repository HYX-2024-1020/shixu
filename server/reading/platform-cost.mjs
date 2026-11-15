import { ensureDatabaseSchema } from "../database-schema.mjs";
import { sha256 } from "./material.mjs";

const schema = [{ version: 1, sql: `
CREATE TABLE reading_platform_cost_operations(
 operation TEXT PRIMARY KEY,account TEXT NOT NULL,actor TEXT NOT NULL,
 review_hash TEXT NOT NULL,request_hash TEXT NOT NULL,calls TEXT NOT NULL,
 ledger_sequence INTEGER NOT NULL,total INTEGER NOT NULL,at INTEGER NOT NULL);
CREATE TABLE reading_platform_cost_calls(
 call_id TEXT PRIMARY KEY REFERENCES reading_calls(id),operation TEXT NOT NULL REFERENCES reading_platform_cost_operations(operation),
 account TEXT NOT NULL,root TEXT NOT NULL,fingerprint TEXT NOT NULL,reserved INTEGER NOT NULL);
CREATE INDEX reading_platform_cost_account ON reading_platform_cost_calls(account,root);
${["reading_platform_cost_operations", "reading_platform_cost_calls"].flatMap(table => ["UPDATE", "DELETE"].map(action =>
 `CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`)).join("\n")}
` }];

// A separate commercial decision. Never manufactures supplier usage/nonbilling.
export class ReadingPlatformCost {
  constructor(ledger) {
    this.ledger = ledger;
    this.db = ledger.db;
    ensureDatabaseSchema(this.db, "ledger-platform-cost", schema, { now: ledger.now });
  }
  covered(call) {
    return this.db.prepare("SELECT * FROM reading_platform_cost_calls WHERE call_id=?").get(call);
  }
  last(account, root) {
    const row = this.db.prepare(`SELECT o.operation,o.ledger_sequence,o.at,c.root FROM reading_platform_cost_operations o
      JOIN reading_platform_cost_calls c ON c.operation=o.operation WHERE o.account=? ${root === undefined ? "" : "AND c.root=?"}
      ORDER BY o.ledger_sequence DESC LIMIT 1`).get(account, ...(root === undefined ? [] : [root]));
    return row && { ...row, operation: "platform:" + row.operation };
  }
  preview(account) {
    this.audit(account);
    const hasRoots = this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='reading_safe_links'").get();
    const calls = this.db.prepare(`SELECT c.id,c.task,c.fingerprint,c.price,c.reserved,c.day,c.generation,
      ${hasRoots ? "COALESCE((SELECT root FROM reading_safe_links WHERE account=c.account AND task=c.task),c.task)" : "c.task"} root
      FROM reading_calls c WHERE c.account=? AND c.state='unknown'
      AND NOT EXISTS(SELECT 1 FROM reading_platform_cost_calls p WHERE p.call_id=c.id) ORDER BY c.id LIMIT 101`).all(account);
    const draining = !!this.db.prepare("SELECT 1 FROM reading_calls WHERE account=? AND state IN ('reserved','sent') LIMIT 1").get(account);
    const sequence = this.ledger.sequence(account);
    return { account, calls, sequence, draining, totalMicro: calls.reduce((n,c) => n+c.reserved,0),
      fingerprint: sha256(JSON.stringify([account, sequence, draining, calls])) };
  }
  cover(account, fingerprint, operation, actor) {
    if (!/^[\w-]{8,90}$/.test(operation || "") || typeof actor !== "string" || !actor || actor.length > 64 || !/^[a-f0-9]{64}$/.test(fingerprint || ""))
      throw Error("INVALID_PLATFORM_COST_REQUEST");
    const requestHash = sha256(JSON.stringify([account, actor, fingerprint, operation]));
    return this.ledger.transaction(() => {
      const prior = this.db.prepare("SELECT * FROM reading_platform_cost_operations WHERE operation=?").get(operation);
      if (prior) {
        if (prior.request_hash !== requestHash) throw Error("IDEMPOTENCY_CONFLICT");
        this.audit(account);
        return { accepted: true, coveredCalls: JSON.parse(prior.calls).length, releasedMicro: prior.total };
      }
      this.ledger.audit(account);
      const review = this.preview(account);
      if (review.fingerprint !== fingerprint) throw Error("STALE_PLATFORM_COST_REVIEW");
      if (review.draining) throw Error("TASK_STILL_DRAINING");
      if (!review.calls.length || review.calls.length > 100) throw Error("INVALID_PLATFORM_COST_REVIEW");
      this.db.prepare("INSERT INTO reading_platform_cost_operations VALUES(?,?,?,?,?,?,?,?,?)")
        .run(operation,account,actor,fingerprint,requestHash,JSON.stringify(review.calls),review.sequence,review.totalMicro,this.ledger.now());
      for (const call of review.calls) this.db.prepare("INSERT INTO reading_platform_cost_calls VALUES(?,?,?,?,?,?)")
        .run(call.id,operation,account,call.root,call.fingerprint,call.reserved);
      this.ledger.event(`platform-cover:${operation}:${requestHash}`, "platform-cover", account, null, review.totalMicro);
      this.audit(account);
      return { accepted: true, coveredCalls: review.calls.length, releasedMicro: review.totalMicro };
    });
  }
  audit(account) {
    for (const op of this.db.prepare("SELECT * FROM reading_platform_cost_operations WHERE account=?").all(account)) {
      const calls = JSON.parse(op.calls);
      const hash = sha256(JSON.stringify([account,op.actor,op.review_hash,op.operation]));
      const rows = this.db.prepare("SELECT * FROM reading_platform_cost_calls WHERE operation=? ORDER BY call_id").all(op.operation);
      const event = this.db.prepare("SELECT * FROM reading_events WHERE operation=?").get(`platform-cover:${op.operation}:${hash}`);
      if (hash !== op.request_hash || sha256(JSON.stringify([account,op.ledger_sequence,false,calls])) !== op.review_hash || event?.account !== account || event?.seq <= op.ledger_sequence || event?.kind !== "platform-cover" || event?.amount !== op.total ||
          rows.length !== calls.length || !calls.length || calls.reduce((n,c) => n+c.reserved,0) !== op.total)
        throw Error("PLATFORM_COST_RECONCILIATION");
      for (const [i,c] of calls.entries()) {
        const r=rows[i], call=this.ledger.call(c.id);
        const provenUnbilled = call?.state === "released" && this.db.prepare("SELECT 1 FROM reading_cost_audits WHERE account=? AND call_id=? AND disposition='not-billed'").get(account,c.id);
        if (r.call_id !== c.id || r.account !== account || r.root !== c.root || r.fingerprint !== c.fingerprint || r.reserved !== c.reserved ||
            call?.account !== account || call.task !== c.task || call.price !== c.price || call.day !== c.day || call.generation !== c.generation || call.fingerprint !== c.fingerprint || call.reserved !== c.reserved || (!provenUnbilled && !["unknown","settled"].includes(call.state)))
          throw Error("PLATFORM_COST_RECONCILIATION");
      }
    }
    // Losing the decision table while retaining the independent authority log is a rollback, not a refund.
    for (const e of this.db.prepare("SELECT operation FROM reading_events WHERE account=? AND kind='platform-cover'").all(account)) {
      if (!this.db.prepare("SELECT 1 FROM reading_platform_cost_operations WHERE account=? AND 'platform-cover:'||operation||':'||request_hash=?").get(account,e.operation))
        throw Error("PLATFORM_COST_RECONCILIATION");
    }
    if (this.db.prepare(`SELECT 1 FROM reading_platform_cost_calls c LEFT JOIN reading_platform_cost_operations o ON o.operation=c.operation
      WHERE c.account=? AND (o.operation IS NULL OR o.account!=c.account) LIMIT 1`).get(account)) throw Error("PLATFORM_COST_RECONCILIATION");
    return true;
  }
}
