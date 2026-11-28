import { ensureDatabaseSchema } from "../database-schema.mjs";
import { LEGACY_LEDGER_SCHEMA } from "../database-schemas.mjs";
import { sha256 } from "./material.mjs";

const id = (v) => typeof v === "string" && /^[\w:-]{1,160}$/.test(v);
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const day = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const sum = (values) => {
  const n = values.reduce((a, b) => a + BigInt(b), 0n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("LEGACY_COST_OVERFLOW");
  return Number(n);
};

// Metadata only. Old UTC day keys and reservations are not usage or a price.
// The source registry must be a stopped, owned migration copy. No startup or
// HTTP route calls intake; BEGIN IMMEDIATE holds its snapshot through commit.
export function reviewLegacyRegistry(registry) {
  const accounts = registry.db
    .prepare("SELECT id FROM accounts ORDER BY id")
    .all()
    .map((r) => r.id);
  if (accounts.some((a) => !id(a))) throw Error("INVALID_LEGACY_ACCOUNT");
  const known = new Set(accounts),
    rows = [];
  for (const row of registry.db
    .prepare(
      "SELECT user_id,job_id,fingerprint,day,reserved_micros,state FROM ai_usage ORDER BY user_id,job_id",
    )
    .iterate()) {
    if (
      !known.has(row.user_id) ||
      !id(row.job_id) ||
      !hash(row.fingerprint) ||
      !day(row.day) ||
      !integer(row.reserved_micros) ||
      !["pending", "done", "error", "conflict", "interrupted"].includes(
        row.state,
      )
    )
      throw Error("INVALID_LEGACY_USAGE");
    rows.push({ ...row });
  }
  sum(rows.map((r) => r.reserved_micros));
  const sourceHash = sha256(JSON.stringify({ version: 1, accounts, rows }));
  return { sourceHash, accounts, rows };
}

export class ReadingLegacyLedger {
  constructor(ledger) {
    this.ledger = ledger;
    this.db = ledger.db;
    ensureDatabaseSchema(this.db, "ledger-legacy", LEGACY_LEDGER_SCHEMA, {
      now: ledger.now,
    });
  }
  account(account) {
    return this.db
      .prepare("SELECT * FROM reading_legacy_accounts WHERE account=?")
      .get(account);
  }
  settlement(account) {
    return this.db
      .prepare("SELECT * FROM reading_legacy_settlements WHERE account=?")
      .get(account);
  }
  token(account) {
    const imported = this.account(account);
    return imported
      ? "legacy:" +
          sha256(
            JSON.stringify([
              imported.source_hash,
              this.settlement(account)?.operation ?? null,
            ]),
          )
      : null;
  }
  approved(account, task, generation) {
    if (!this.account(account)) return true;
    const proof = this.settlement(account);
    return (
      !!proof &&
      this.db
        .prepare(
          "SELECT operation FROM reading_legacy_work WHERE account=? AND task=? AND generation=?",
        )
        .get(account, task, generation)?.operation === proof.operation
    );
  }
  approve(account, task, generation) {
    if (!this.account(account)) return;
    if (!id(task) || !integer(generation) || generation < 1)
      throw Error("INVALID_LEGACY_WORK");
    return this.ledger.transaction(() => {
      const proof = this.settlement(account);
      if (!proof) throw Error("RECONCILIATION_REQUIRED");
      const previous = this.db
        .prepare(
          "SELECT operation FROM reading_legacy_work WHERE account=? AND task=? AND generation=?",
        )
        .get(account, task, generation);
      if (previous) {
        if (previous.operation !== proof.operation)
          throw Error("LEGACY_WORK_CONFLICT");
        return;
      }
      this.db
        .prepare("INSERT INTO reading_legacy_work VALUES(?,?,?,?,?)")
        .run(account, task, generation, proof.operation, this.ledger.now());
    });
  }
  pending(account) {
    return !!this.account(account) && !this.settlement(account);
  }
  risk(account) {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(u.reserved),0) n FROM reading_legacy_usage u
      WHERE (? IS NULL OR u.account=?) AND NOT EXISTS(SELECT 1 FROM reading_legacy_settlements s WHERE s.account=u.account)`,
      )
      .get(account ?? null, account ?? null).n;
  }
  spent(account) {
    return this.settlement(account)?.spent ?? 0;
  }
  site(day) {
    return sum(
      this.db
        .prepare("SELECT days FROM reading_legacy_settlements")
        .all()
        .flatMap((r) =>
          JSON.parse(r.days)
            .filter((d) => d.day === day)
            .map((d) => d.micros),
        ),
    );
  }
  audit(account) {
    const imported = this.account(account);
    if (!imported) return true;
    const usages = this.db
      .prepare(
        "SELECT job,fingerprint,legacy_day,reserved,legacy_state FROM reading_legacy_usage WHERE account=? ORDER BY job",
      )
      .all(account);
    if (sha256(JSON.stringify(usages)) !== imported.usage_hash) return false;
    const intake = this.db
      .prepare(
        "SELECT amount FROM reading_events WHERE operation=? AND account=? AND kind='legacy-intake'",
      )
      .get("legacy-intake:" + account, account);
    if (intake?.amount !== sum(usages.map((u) => u.reserved))) return false;
    const settlement = this.settlement(account),
      wallet = this.db
        .prepare("SELECT * FROM reading_wallets WHERE account=?")
        .get(account);
    if (!settlement)
      return (
        !!wallet &&
        wallet.granted === 0 &&
        wallet.spent === 0 &&
        !this.db
          .prepare("SELECT 1 FROM reading_calls WHERE account=?")
          .get(account)
      );
    const event = this.db
      .prepare(
        "SELECT amount FROM reading_events WHERE operation=? AND account=? AND kind='legacy-settle'",
      )
      .get("legacy-settle:" + account, account);
    return (
      settlement.source_hash === imported.source_hash &&
      event?.amount === settlement.spent &&
      sum(JSON.parse(settlement.days).map((d) => d.micros)) === settlement.spent
    );
  }
}

// Host-only authority, deliberately separate from user/account authorization.
export class ReadingLegacyMaintenance {
  constructor(ledger, authorize, verify) {
    if (typeof authorize !== "function")
      throw Error("MAINTENANCE_AUTHORITY_REQUIRED");
    Object.assign(this, {
      ledger,
      legacy: ledger.legacy,
      db: ledger.db,
      authorize,
      verify,
    });
  }
  actor(actor, operation, account) {
    if (!id(actor) || this.authorize({ actor, operation, account }) !== true)
      throw Error("MAINTENANCE_FORBIDDEN");
  }
  preview(registry, actor) {
    this.actor(actor, "intake-legacy-ledger");
    const r = reviewLegacyRegistry(registry);
    return {
      sourceHash: r.sourceHash,
      accounts: r.accounts.length,
      usageRows: r.rows.length,
      unknownRisk: sum(r.rows.map((r) => r.reserved_micros)),
    };
  }
  intake(registry, request, actor) {
    this.actor(actor, "intake-legacy-ledger");
    if (
      !request ||
      Object.keys(request).sort().join(",") !==
        "expectedSourceHash,operationId" ||
      !id(request.operationId) ||
      !hash(request.expectedSourceHash)
    )
      throw Error("INVALID_MAINTENANCE_REQUEST");
    if (registry.db.isTransaction)
      throw Error("LEGACY_SOURCE_TRANSACTION_ACTIVE");
    registry.db.exec("BEGIN IMMEDIATE");
    try {
      const source = reviewLegacyRegistry(registry);
      if (source.sourceHash !== request.expectedSourceHash)
        throw Error("STALE_LEGACY_SOURCE");
      const requestHash = sha256(
        JSON.stringify([actor, request.operationId, source.sourceHash]),
      );
      const result = this.ledger.transaction(() => {
        const prior = this.db
          .prepare("SELECT * FROM reading_legacy_intakes WHERE operation=?")
          .get(request.operationId);
        if (prior) {
          if (prior.request_hash !== requestHash)
            throw Error("IDEMPOTENCY_CONFLICT");
          this.ledger.audit();
          return prior;
        }
        for (const account of source.accounts) {
          const rows = source.rows
            .filter((r) => r.user_id === account)
            .map((r) => ({
              job: r.job_id,
              fingerprint: r.fingerprint,
              legacy_day: r.day,
              reserved: r.reserved_micros,
              legacy_state: r.state,
            }));
          const usageHash = sha256(JSON.stringify(rows)),
            old = this.legacy.account(account);
          if (old) {
            if (
              old.source_hash !== source.sourceHash ||
              old.usage_hash !== usageHash
            )
              throw Error("LEGACY_SOURCE_CONFLICT");
            continue;
          }
          if (
            this.db
              .prepare("SELECT 1 FROM reading_wallets WHERE account=?")
              .get(account) ||
            this.db
              .prepare("SELECT 1 FROM reading_events WHERE account=?")
              .get(account)
          )
            throw Error("LEGACY_WALLET_COLLISION");
          this.db
            .prepare("INSERT INTO reading_wallets(account,granted) VALUES(?,0)")
            .run(account);
          this.db
            .prepare("INSERT INTO reading_legacy_accounts VALUES(?,?,?,?)")
            .run(account, source.sourceHash, usageHash, this.ledger.now());
          for (const row of rows)
            this.db
              .prepare("INSERT INTO reading_legacy_usage VALUES(?,?,?,?,?,?)")
              .run(
                account,
                row.job,
                row.fingerprint,
                row.legacy_day,
                row.reserved,
                row.legacy_state,
              );
          this.ledger.event(
            "legacy-intake:" + account,
            "legacy-intake",
            account,
            null,
            sum(rows.map((r) => r.reserved)),
          );
        }
        this.db
          .prepare("INSERT INTO reading_legacy_intakes VALUES(?,?,?,?,?,?,?)")
          .run(
            request.operationId,
            source.sourceHash,
            requestHash,
            actor,
            source.accounts.length,
            source.rows.length,
            this.ledger.now(),
          );
        this.ledger.audit();
        return this.db
          .prepare("SELECT * FROM reading_legacy_intakes WHERE operation=?")
          .get(request.operationId);
      });
      registry.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (registry.db.isTransaction) registry.db.exec("ROLLBACK");
      throw error;
    }
  }
  review(account, actor) {
    this.actor(actor, "reconcile-legacy-ledger", account);
    const imported = this.legacy.account(account);
    if (!imported) throw Error("LEGACY_ACCOUNT_NOT_FOUND");
    return {
      account,
      sourceHash: imported.source_hash,
      usageHash: imported.usage_hash,
      ledgerSequence: this.ledger.sequence(account),
      wallet: this.ledger.wallet(account),
      settlement: this.legacy.settlement(account) ?? null,
    };
  }
  reconcile(account, request, actor) {
    this.actor(actor, "reconcile-legacy-ledger", account);
    if (typeof this.verify !== "function")
      throw Error("MAINTENANCE_EVIDENCE_AUTHORITY_REQUIRED");
    if (
      !request ||
      Object.keys(request).sort().join(",") !==
        "evidenceHash,expectedLedgerSequence,operationId" ||
      !id(request.operationId) ||
      !hash(request.evidenceHash) ||
      !integer(request.expectedLedgerSequence)
    )
      throw Error("INVALID_MAINTENANCE_REQUEST");
    const requestHash = sha256(
      JSON.stringify([
        account,
        actor,
        request.operationId,
        request.evidenceHash,
        request.expectedLedgerSequence,
      ]),
    );
    const prior = this.legacy.settlement(account);
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw Error("LEGACY_ALREADY_RECONCILED");
      this.ledger.audit(account);
      return prior;
    }
    const review = this.review(account, actor);
    if (review.ledgerSequence !== request.expectedLedgerSequence)
      throw Error("STALE_MAINTENANCE_REVIEW");
    this.ledger.audit(account);
    const proof = this.verify({
      account,
      sourceHash: review.sourceHash,
      usageHash: review.usageHash,
      evidenceHash: request.evidenceHash,
    });
    if (
      !proof ||
      proof.final !== true ||
      proof.evidenceHash !== request.evidenceHash ||
      proof.account !== account ||
      proof.sourceHash !== review.sourceHash ||
      proof.usageHash !== review.usageHash ||
      proof.currency !== "CNY" ||
      proof.allHistoricalActivityCovered !== true ||
      !hash(proof.proofIdHash) ||
      !integer(proof.spentMicros) ||
      !Array.isArray(proof.beijingDays) ||
      proof.beijingDays.some(
        (d) =>
          !d ||
          !day(d.day) ||
          !integer(d.micros) ||
          d.day >
            new Date(this.legacy.account(account).at + 8 * 3600000)
              .toISOString()
              .slice(0, 10),
      ) ||
      new Set(proof.beijingDays.map((d) => d.day)).size !==
        proof.beijingDays.length ||
      sum(proof.beijingDays.map((d) => d.micros)) !== proof.spentMicros
    )
      throw Error("INVALID_LEGACY_FINAL_PROOF");
    const days = JSON.stringify(
      [...proof.beijingDays]
        .map((d) => ({ day: d.day, micros: d.micros }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    );
    return this.ledger.transaction(() => {
      if (
        this.legacy.settlement(account) ||
        this.ledger.sequence(account) !== request.expectedLedgerSequence
      )
        throw Error("STALE_MAINTENANCE_REVIEW");
      this.ledger.audit(account);
      this.db
        .prepare(
          "INSERT INTO reading_legacy_settlements VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          account,
          review.sourceHash,
          request.evidenceHash,
          proof.proofIdHash,
          proof.spentMicros,
          days,
          actor,
          request.operationId,
          requestHash,
          sha256(JSON.stringify(proof)),
          this.ledger.now(),
        );
      this.db
        .prepare(
          "UPDATE reading_wallets SET granted=20000000,spent=? WHERE account=?",
        )
        .run(proof.spentMicros, account);
      this.ledger.event("initial:" + account, "grant", account, null, 20000000);
      this.ledger.event(
        "legacy-settle:" + account,
        "legacy-settle",
        account,
        null,
        proof.spentMicros,
      );
      if (proof.spentMicros > 20000000)
        this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
      this.ledger.audit(account);
      return this.legacy.settlement(account);
    });
  }
}
