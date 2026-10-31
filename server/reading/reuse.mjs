import { sha256 } from "./material.mjs";

// Certificates are hashes and bounded result references, never extracted text.
// Only original paid blocks get certificates; copied blocks cannot form chains.
export class ReadingReuse {
  constructor(db, ledger, account) {
    Object.assign(this, { db, ledger, account });
    ledger.db.exec(`CREATE TABLE IF NOT EXISTS reading_paid_proofs(account TEXT NOT NULL,task TEXT NOT NULL,fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,reuse_key TEXT NOT NULL,result_hash TEXT NOT NULL,PRIMARY KEY(account,task,fingerprint));
      CREATE TRIGGER IF NOT EXISTS reading_paid_proofs_no_update BEFORE UPDATE ON reading_paid_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAID_PROOF'); END;
      CREATE TRIGGER IF NOT EXISTS reading_paid_proofs_no_delete BEFORE DELETE ON reading_paid_proofs BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAID_PROOF'); END;`);
    db.exec(`CREATE TABLE IF NOT EXISTS reading_reuse_keys(
      task TEXT NOT NULL,fingerprint TEXT NOT NULL,reuse_key TEXT NOT NULL,result_hash TEXT NOT NULL,
      PRIMARY KEY(task,fingerprint));
      CREATE INDEX IF NOT EXISTS reading_reuse_key ON reading_reuse_keys(reuse_key);
      CREATE TABLE IF NOT EXISTS reading_reused_blocks(
      task TEXT NOT NULL,fingerprint TEXT NOT NULL,source_task TEXT NOT NULL,source_fingerprint TEXT NOT NULL,call_id TEXT NOT NULL,
      PRIMARY KEY(task,fingerprint));`);
  }
  key(batch, materials, context) {
    const ids = new Set(batch.map((s) => s.sourceId));
    const originals = materials
      .filter((m) => m.segments.some((s) => ids.has(s.sourceId)))
      .map((m) => [
        m.attachmentId,
        m.contentHash,
        m.readerVersion,
        m.normalizationVersion,
      ]);
    return sha256(
      JSON.stringify([
        "exact-paid-block/1",
        context,
        originals,
        batch.map((s) => [
          s.sourceId,
          s.range,
          sha256(s.text),
          s.structure || null,
          ...(s.image ? [s.image.hash] : []),
        ]),
      ]),
    );
  }
  certify(task, fingerprint, key, result) {
    const row = this.db.prepare("SELECT * FROM reading_blocks WHERE task=? AND fingerprint=?").get(task,fingerprint);
    const call = row && this.ledger.call(row.call_id), value = sha256(JSON.stringify(result));
    if(!call || call.state!=="settled" || call.account!==this.account || call.task!==task || call.block!==fingerprint || row.result!==JSON.stringify(result))throw Error("SAFETY_RECONCILIATION");
    const prior=this.proof(task,fingerprint);
    if(prior && (prior.call_id!==call.id || prior.reuse_key!==key || prior.result_hash!==value))throw Error("SAFETY_RECONCILIATION");
    this.ledger.db.prepare("INSERT OR IGNORE INTO reading_paid_proofs VALUES(?,?,?,?,?,?)").run(this.account,task,fingerprint,call.id,key,value);
    this.db
      .prepare("INSERT OR REPLACE INTO reading_reuse_keys VALUES(?,?,?,?)")
      .run(task, fingerprint, key, sha256(JSON.stringify(result)));
  }
  proof(task, fingerprint) {
    return this.ledger.db.prepare("SELECT * FROM reading_paid_proofs WHERE account=? AND task=? AND fingerprint=?").get(this.account,task,fingerprint);
  }
  find(task, key, validate) {
    const candidates = this.db
      .prepare(
        `SELECT k.*,b.call_id,b.result FROM reading_reuse_keys k
      JOIN reading_blocks b ON b.task=k.task AND b.fingerprint=k.fingerprint
      JOIN reading_tasks t ON t.id=k.task
      WHERE k.reuse_key=? AND t.packet=? AND t.id!=? AND t.state!='purged'
      ORDER BY t.rowid DESC LIMIT 100`,
      )
      .all(key, task.packet, task.id);
    if (!candidates.length) return null;
    this.ledger.audit(this.account);
    for (const candidate of candidates) {
      const call = this.ledger.call(candidate.call_id);
      if (
        !call ||
        call.state !== "settled" ||
        call.account !== this.account ||
        call.task !== candidate.task ||
        call.block !== candidate.fingerprint ||
        candidate.result_hash !== sha256(candidate.result)
      )
        continue;
      try {
        return {
          ...candidate,
          validated: validate(JSON.parse(candidate.result)),
        };
      } catch {
        /* Invalid or outdated sources never become a reused result. */
      }
    }
    return null;
  }
  copied(task, fingerprint) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM reading_reused_blocks WHERE task=? AND fingerprint=?",
      )
      .get(task, fingerprint);
  }
  count(task) {
    return this.db
      .prepare("SELECT COUNT(*) n FROM reading_reused_blocks WHERE task=?")
      .get(task).n;
  }
  purge(task) {
    this.db.prepare("DELETE FROM reading_reuse_keys WHERE task=?").run(task);
    this.db.prepare("DELETE FROM reading_reused_blocks WHERE task=?").run(task);
  }
}
