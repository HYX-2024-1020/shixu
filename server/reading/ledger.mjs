import { ReadingLegacyLedger } from "./legacy-ledger.mjs";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import {
  LEDGER_CORE_SCHEMA,
  LEDGER_COST_SCHEMA,
  LEDGER_TIME_SCHEMA,
  LEDGER_CHECKPOINT_SCHEMA,
} from "../database-schemas.mjs";
import { ReadingProviderReceipts } from "./provider-receipts.mjs";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "./material.mjs";

const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const id = (v) => typeof v === "string" && /^[\w:-]{1,160}$/.test(v);
export const beijingDay = (ms) =>
  new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const ceilPrice = (tokens, rate) =>
  Number((BigInt(tokens) * BigInt(rate) + 999999n) / 1000000n);
export function validateUsage(usage) {
  if (
    !usage ||
    !integer(usage.prompt_tokens) ||
    !integer(usage.completion_tokens) ||
    ("prompt_cache_hit_tokens" in usage &&
      (!integer(usage.prompt_cache_hit_tokens) ||
        usage.prompt_cache_hit_tokens > usage.prompt_tokens)) ||
    ("prompt_cache_miss_tokens" in usage &&
      (!integer(usage.prompt_cache_miss_tokens) ||
        usage.prompt_cache_miss_tokens +
          (usage.prompt_cache_hit_tokens ?? 0) !==
          usage.prompt_tokens))
  )
    throw Error("INVALID_USAGE");
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens ?? 0,
  };
}
export function estimatedCost(price, usage) {
  const u = validateUsage(usage);
  const value =
    ceilPrice(
      u.prompt_tokens - u.prompt_cache_hit_tokens,
      price.inputMicrosPerMillion,
    ) +
    ceilPrice(u.prompt_cache_hit_tokens, price.cachedMicrosPerMillion) +
    ceilPrice(u.completion_tokens, price.outputMicrosPerMillion);
  if (!integer(value)) throw Error("COST_OVERFLOW");
  return value;
}

// Independent from tenant data: restoring a packet database cannot refund calls.
// Caller must own the supplied account identity (no HTTP input may pick tenants).
export class ReadingLedger {
  constructor(
    path,
    {
      now = Date.now,
      siteDailyMicros = 50000000,
      taskInflightMicros = 2000000,
    } = {},
  ) {
    if (!integer(siteDailyMicros) || !integer(taskInflightMicros))
      throw Error("INVALID_LIMIT");
    this.now = now;
    this.limits = { siteDailyMicros, taskInflightMicros };
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;",
    );
    if (
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
        )
        .get() &&
      !this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='reading_wallets'")
        .get()
    ) {
      this.db.close();
      throw Error("DATABASE_STATE_RECONCILIATION");
    }
    try {
      for (const [component, migrations] of [
        ["ledger-core", LEDGER_CORE_SCHEMA],
        ["ledger-cost", LEDGER_COST_SCHEMA],
        ["ledger-time", LEDGER_TIME_SCHEMA],
        ["ledger-checkpoint", LEDGER_CHECKPOINT_SCHEMA],
      ])
        ensureDatabaseSchema(this.db, component, migrations, {
          now: this.now,
          ...(component === "ledger-core"
            ? {
                compatibleObjects: [
                  "CREATE INDEX reading_calls_account_task ON reading_calls(account,task)",
                ],
              }
            : {}),
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
    if (!this.db.prepare("SELECT 1 FROM reading_controls WHERE id=1").get()) {
      this.db.close();
      throw Error("DATABASE_STATE_RECONCILIATION");
    }
    try {
      this.receipts = new ReadingProviderReceipts(this);
      this.legacy = new ReadingLegacyLedger(this);
    } catch(error) { this.db.close(); throw error; }
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  event(operation, kind, account, call, amount) {
    this.db
      .prepare(
        "INSERT INTO reading_events(operation,kind,account,call,amount,at) VALUES(?,?,?,?,?,?)",
      )
      .run(operation, kind, account, call, amount, this.now());
  }
  // No constructor auto-grant. Legacy accounts must be reconciled before this
  // explicit initial grant; the production migration is intentionally separate.
  grantInitial(account) {
    if (!id(account)) throw Error("INVALID_ACCOUNT");
    return this.transaction(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM reading_events WHERE operation=?")
          .get("initial:" + account)
      )
        return this.wallet(account);
      if (
        this.db
          .prepare("SELECT 1 FROM reading_wallets WHERE account=?")
          .get(account)
      )
        throw Error("RECONCILIATION_REQUIRED");
      this.db
        .prepare(
          "INSERT INTO reading_wallets(account,granted) VALUES(?,20000000)",
        )
        .run(account);
      this.event("initial:" + account, "grant", account, null, 20000000);
      return this.wallet(account);
    });
  }
  // Administrative additions never reset spent, reservations or safety gates.
  // The grant and immutable event commit together; retry after a crash is safe.
  grantAdditional(account, amount, operation) {
    if (
      !id(account) ||
      !id(operation) ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 1000000000
    )
      throw Error("INVALID_GRANT");
    return this.transaction(() => {
      const key = "admin-grant:" + operation;
      const prior = this.db
        .prepare("SELECT * FROM reading_events WHERE operation=?")
        .get(key);
      if (prior) {
        if (
          prior.kind !== "grant" ||
          prior.account !== account ||
          prior.amount !== amount
        )
          throw Error("IDEMPOTENCY_CONFLICT");
        return this.wallet(account);
      }
      const wallet = this.wallet(account);
      if (!Number.isSafeInteger(wallet.granted + amount))
        throw Error("COST_OVERFLOW");
      this.db
        .prepare("UPDATE reading_wallets SET granted=granted+? WHERE account=?")
        .run(amount, account);
      this.event(key, "grant", account, null, amount);
      return this.wallet(account);
    });
  }
  freezePrice(price) {
    if (
      !id(price.id) ||
      typeof price.model !== "string" ||
      !price.model ||
      price.currency !== "CNY" ||
      typeof price.source !== "string" ||
      !price.source ||
      !integer(price.verifiedAt) ||
      ![
        "inputMicrosPerMillion",
        "cachedMicrosPerMillion",
        "outputMicrosPerMillion",
      ].every((k) => integer(price[k])) ||
      price.cachedMicrosPerMillion > price.inputMicrosPerMillion
    )
      throw Error("INVALID_PRICE");
    const body = JSON.stringify({
      id: price.id,
      model: price.model,
      currency: "CNY",
      source: price.source,
      verifiedAt: price.verifiedAt,
      inputMicrosPerMillion: price.inputMicrosPerMillion,
      cachedMicrosPerMillion: price.cachedMicrosPerMillion,
      outputMicrosPerMillion: price.outputMicrosPerMillion,
    });
    const previous = this.db
      .prepare("SELECT body FROM reading_prices WHERE id=?")
      .get(price.id);
    if (previous && previous.body !== body) throw Error("PRICE_ID_REUSED");
    this.db
      .prepare("INSERT OR IGNORE INTO reading_prices VALUES(?,?)")
      .run(price.id, body);
    if (
      this.db
        .prepare("SELECT body FROM reading_prices WHERE id=?")
        .get(price.id).body !== body
    )
      throw Error("PRICE_ID_REUSED");
  }
  budget() {
    const row = this.db
      .prepare("SELECT * FROM reading_budget_changes ORDER BY seq DESC LIMIT 1")
      .get();
    const day = beijingDay(this.now()),
      month = day.slice(0, 7);
    const sum = (prefix) =>
      this.db
        .prepare(
          "SELECT COALESCE(SUM(actual),0) n FROM reading_calls WHERE state='settled' AND day LIKE ?",
        )
        .get(prefix + "%").n;
    const risk =
      this.db
        .prepare(
          "SELECT COALESCE(SUM(reserved),0) n FROM reading_calls WHERE state IN ('reserved','sent','unknown')",
        )
        .get().n + this.legacy.risk();
    const legacyMonth = this.db
      .prepare("SELECT days FROM reading_legacy_settlements")
      .all()
      .flatMap((r) => JSON.parse(r.days))
      .filter((d) => d.day.startsWith(month))
      .reduce((n, d) => n + d.micros, 0);
    return {
      dailyMicro: row?.daily ?? this.limits.siteDailyMicros,
      monthlyMicro: row?.monthly ?? null,
      daySpentMicro: sum(day) + this.legacy.site(day),
      monthSpentMicro: sum(month) + legacyMonth,
      riskMicro: risk,
      timezone: "Asia/Shanghai",
      updatedAt: row ? new Date(row.at).toISOString() : null,
    };
  }
  usageSummary(account) {
    const wallet = this.wallet(account), budget = this.budget(), day = beijingDay(this.now());
    const legacy = this.legacy.settlement(account);
    const legacyDay = legacy ? JSON.parse(legacy.days).filter(d => d.day === day).reduce((n, d) => n + d.micros, 0) : 0;
    const daySpentMicro = this.db.prepare("SELECT COALESCE(SUM(actual),0) n FROM reading_calls WHERE account=? AND day=? AND state='settled'").get(account, day).n + legacyDay;
    const daily = Math.max(0, budget.dailyMicro - budget.daySpentMicro - budget.riskMicro);
    const monthly = budget.monthlyMicro === null ? null : Math.max(0, budget.monthlyMicro - budget.monthSpentMicro - budget.riskMicro);
    return { day, timezone: "Asia/Shanghai", sampledAt: this.now(), daySpentMicro,
      personalRemainingMicro: wallet.available,
      siteRemainingMicro: monthly === null ? daily : Math.min(daily, monthly),
      siteDailyRemainingMicro: daily, siteMonthlyRemainingMicro: monthly,
      riskIncluded: true, source: "platform-ledger" };
  }
  changeBudget(daily, monthly, reason, operation, actor) {
    if (
      !id(operation) ||
      typeof actor !== "string" ||
      !actor ||
      actor.length > 64 ||
      !Number.isSafeInteger(daily) ||
      daily < 1 ||
      daily > 1000000000 ||
      (monthly !== null &&
        (!Number.isSafeInteger(monthly) ||
          monthly < 1 ||
          monthly > 10000000000)) ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 200
    )
      throw Error("INVALID_BUDGET");
    const fingerprint = sha256(JSON.stringify([daily, monthly, reason, actor]));
    return this.transaction(() => {
      const prior = this.db
        .prepare(
          "SELECT fingerprint FROM reading_budget_changes WHERE operation=?",
        )
        .get(operation);
      if (prior && prior.fingerprint !== fingerprint)
        throw Error("IDEMPOTENCY_CONFLICT");
      if (!prior)
        this.db
          .prepare(
            "INSERT INTO reading_budget_changes(operation,actor,daily,monthly,reason,fingerprint,at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            operation,
            actor,
            daily,
            monthly,
            reason,
            fingerprint,
            this.now(),
          );
      return this.budget();
    });
  }
  call(callId) {
    return this.db
      .prepare("SELECT * FROM reading_calls WHERE id=?")
      .get(callId);
  }
  sequence(account) {
    return this.db
      .prepare(
        "SELECT COALESCE(MAX(seq),0) n FROM reading_events WHERE account=?",
      )
      .get(account).n;
  }
  lastCostAudit(account, root) {
    return root === undefined
      ? this.db
          .prepare(
            "SELECT * FROM reading_cost_audits WHERE account=? ORDER BY seq DESC LIMIT 1",
          )
          .get(account)
      : this.db
          .prepare(
            "SELECT * FROM reading_cost_audits WHERE account=? AND root=? ORDER BY seq DESC LIMIT 1",
          )
          .get(account, root);
  }
  recoveryOperation(account) {
    const cost = this.lastCostAudit(account)?.operation || null;
    const time = this.db
      .prepare(
        "SELECT operation FROM reading_time_audits WHERE account=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(account)?.operation;
    const checkpoint = this.db
      .prepare(
        "SELECT operation FROM reading_checkpoint_audits WHERE account=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(account)?.operation;
    const window = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='reading_window_audits'",
      )
      .get()
      ? this.db
          .prepare(
            "SELECT operation FROM reading_window_audits WHERE account=? ORDER BY rowid DESC LIMIT 1",
          )
          .get(account)?.operation
      : null;
    const legacy = this.legacy.token(account);
    if (legacy)
      return (
        "recovery:" +
        sha256(
          JSON.stringify([
            cost,
            time || null,
            checkpoint || null,
            window || null,
            legacy,
          ]),
        )
      );
    if (window)
      return (
        "recovery:" +
        sha256(JSON.stringify([cost, time || null, checkpoint || null, window]))
      );
    if (checkpoint)
      return (
        "recovery:" + sha256(JSON.stringify([cost, time || null, checkpoint]))
      );
    return time ? "recovery:" + sha256(JSON.stringify([cost, time])) : cost;
  }
  price(priceId) {
    const row = this.db
      .prepare("SELECT body FROM reading_prices WHERE id=?")
      .get(priceId);
    if (!row) throw Error("PRICE_REQUIRED");
    return JSON.parse(row.body);
  }
  wallet(account) {
    const w = this.db
      .prepare("SELECT * FROM reading_wallets WHERE account=?")
      .get(account);
    if (!w) throw Error("RECONCILIATION_REQUIRED");
    const reserved = this.db
      .prepare(
        "SELECT COALESCE(SUM(reserved),0) n FROM reading_calls WHERE account=? AND state IN ('reserved','sent')",
      )
      .get(account).n;
    const unknownRisk = this.legacy.risk(account) + this.db
      .prepare(
        "SELECT COALESCE(SUM(reserved),0) n FROM reading_calls WHERE account=? AND state='unknown'",
      )
      .get(account).n;
    const paused = this.db
      .prepare("SELECT paused FROM reading_controls WHERE id=1")
      .get().paused;
    return {
      ...w,
      costAuditOperation: this.recoveryOperation(account),
      reserved,
      unknownRisk,
      available: Math.max(0, w.granted - w.spent - reserved - unknownRisk),
      pausedReason: this.legacy.pending(account) ? "RECONCILIATION_REQUIRED" : paused
          ? "LEDGER_PAUSED"
          : "",
      lowBalance: w.granted - w.spent < 3000000,
    };
  }
  taskHasUnresolvedCost(account, task, includeSent = false) {
    const hasRoots = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='reading_safe_links'",
    ).get();
    const scope = hasRoots ? `(task=? OR task IN (
      SELECT related.task FROM reading_safe_links requested
      JOIN reading_safe_links related ON related.account=requested.account AND related.root=requested.root
      WHERE requested.account=? AND requested.task=?
    ))` : "task=?";
    return !!this.db.prepare(
      `SELECT 1 FROM reading_calls WHERE account=? AND
       (state='unknown' OR (? AND state='sent')) AND ${scope} LIMIT 1`,
      )
      .get(
        account,
        Number(includeSent),
        task,
        ...(hasRoots ? [account, task] : []),
      );
  }
  reserve({
    callId,
    account,
    task,
    block,
    generation,
    priceId,
    maxPromptTokens,
    maxOutputTokens,
  }) {
    // All paid paths (reading/chat/visual/merge/association) pass this synchronous
    // boundary immediately before sent/provider. Administrative resume never
    // modifies the independent billing or reconciliation controls below.
    this.dispatchGuard?.(account);
    if (
      ![callId, account, task, block, priceId].every(id) ||
      !integer(generation) ||
      generation < 1 ||
      !integer(maxPromptTokens) ||
      !integer(maxOutputTokens)
    )
      throw Error("INVALID_CALL");
    const fingerprint = sha256(
      JSON.stringify([
        account,
        task,
        block,
        generation,
        priceId,
        maxPromptTokens,
        maxOutputTokens,
      ]),
    );
    return this.transaction(() => {
      const previous = this.call(callId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw Error("CALL_ID_REUSED");
        return previous;
      }
      if(this.legacy.pending(account))throw Error("RECONCILIATION_REQUIRED");
      if(!this.legacy.approved(account,task,generation))throw Error("STALE_COST_REVIEW");
      if (
        this.db.prepare("SELECT paused FROM reading_controls WHERE id=1").get()
          .paused
      )
        throw Error("LEDGER_PAUSED");
      if (this.taskHasUnresolvedCost(account, task)) throw Error("UNKNOWN_COST");
      const reserve = estimatedCost(this.price(priceId), {
        prompt_tokens: maxPromptTokens,
        completion_tokens: maxOutputTokens,
      });
      if (reserve < 1) throw Error("INVALID_RESERVATION");
      const wallet = this.wallet(account),
        day = beijingDay(this.now());
      if (wallet.available < reserve) throw Error("PERSONAL_BUDGET");
      const inflight = this.db
        .prepare(
          "SELECT COALESCE(SUM(reserved),0) n FROM reading_calls WHERE task=? AND state IN ('reserved','sent')",
        )
        .get(task).n;
      if (inflight + reserve > this.limits.taskInflightMicros)
        throw Error("TASK_INFLIGHT_BUDGET");
      // All unknown and in-flight requests survive Beijing midnight as risk.
      const site = this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN state='settled' AND day=? THEN actual WHEN state IN ('reserved','sent','unknown') THEN reserved ELSE 0 END),0) n FROM reading_calls",
        )
        .get(day).n;
      const budget = this.budget();
      if (
        site + this.legacy.risk() + this.legacy.site(day) + reserve >
        budget.dailyMicro
      )
        throw Error("SITE_BUDGET");
      if (
        budget.monthlyMicro !== null &&
        budget.monthSpentMicro + budget.riskMicro + reserve >
          budget.monthlyMicro
      )
        throw Error("SITE_MONTH_BUDGET");
      this.db
        .prepare(
          "INSERT INTO reading_calls VALUES(?,?,?,?,?,?,?,'reserved',?,NULL,NULL,?)",
        )
        .run(
          callId,
          account,
          task,
          block,
          generation,
          priceId,
          day,
          reserve,
          fingerprint,
        );
      this.event("reserve:" + callId, "reserve", account, callId, reserve);
      return this.call(callId);
    });
  }
  sent(callId,intent) {
    const result=this.transaction(() => {
      const c = this.call(callId);
      if (!c) throw Error("CALL_NOT_FOUND");
      const request=this.receipts.requestLocked(c,intent);if(request?.conflict)return {conflict:true};
      if (c.state === "sent") return c;
      if (c.state !== "reserved") throw Error("INVALID_CALL_TRANSITION");
      this.db
        .prepare("UPDATE reading_calls SET state='sent' WHERE id=?")
        .run(callId);
      this.event("sent:" + callId, "sent", c.account, callId, 0);
      return this.call(callId);
    });
    if(result?.conflict)throw Error("PROVIDER_REQUEST_CONFLICT");return result;
  }
  unknown(callId) {
    return this.transaction(() => {
      const c = this.call(callId);
      if (!c) throw Error("CALL_NOT_FOUND");
      if (c.state === "unknown" || c.state === "settled") return c;
      if (c.state !== "sent") throw Error("INVALID_CALL_TRANSITION");
      this.db
        .prepare("UPDATE reading_calls SET state='unknown' WHERE id=?")
        .run(callId);
      this.event("unknown:" + callId, "unknown", c.account, callId, c.reserved);
      return this.call(callId);
    });
  }
  captureUnknownReceipt(callId, receipt) {
    if (receipt === undefined) return;
    try {
      this.captureProviderReceipt(callId, receipt);
    } catch {
      this.receipts.pause(this.call(callId), "provider-receipt-write-failed");
    }
  }
  captureProviderReceipt(callId, receipt, usage) {
    const normalized = usage === undefined ? undefined : validateUsage(usage);
    return this.transaction(() => {
      const call = this.call(callId);
      if (!call) throw Error("CALL_NOT_FOUND");
      return this.receipts.captureLocked(call, receipt, normalized);
    });
  }
  settle(callId, usage, receipt) {
    const normalized = validateUsage(usage),
      serialized = JSON.stringify(normalized);
    let observed, receiptError;
    if (receipt !== undefined)
      try {
        observed = this.captureProviderReceipt(callId, receipt, normalized);
      } catch (error) {
        receiptError = error;
      }
    const result = this.transaction(() =>
      this.settleLocked(callId, normalized, serialized),
    );
    if (receiptError) {
      this.receipts.pause(this.call(callId), "provider-receipt-write-failed");
      throw Error("PROVIDER_RECEIPT_WRITE_FAILED");
    }
    if (this.receipts.request(callId) && !this.receipts.latest(callId)) {
      this.receipts.pause(this.call(callId), "provider-receipt-missing");
      throw Error("PROVIDER_RECEIPT_RECONCILIATION");
    }
    if (observed && ["conflict", "invalid"].includes(observed.status))
      throw Error("PROVIDER_RECEIPT_RECONCILIATION");
    if (result?.conflict) throw Error(result.conflict);
    return result;
  }
  // Used by the authenticated maintenance coordinator in the same ledger transaction.
  settleLocked(callId, normalized, serialized = JSON.stringify(normalized)) {
    const c = this.call(callId);
    if (!c) throw Error("CALL_NOT_FOUND");
    if (c.state === "settled") {
      if (c.usage !== serialized) {
        if (
          !this.db
            .prepare("SELECT 1 FROM reading_cost_audits WHERE call_id=?")
            .get(callId)
        )
          throw Error("USAGE_CONFLICT");
        this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
        const operation =
          "cost-usage-conflict:" + callId + ":" + sha256(serialized);
        if (
          !this.db
            .prepare("SELECT 1 FROM reading_events WHERE operation=?")
            .get(operation)
        )
          this.event(operation, "cost-proof-conflict", c.account, callId, 0);
        return { conflict: "USAGE_CONFLICT" };
      }
      return c;
    }
    const deniedBilling =
      c.state === "released" &&
      this.db
        .prepare(
          "SELECT 1 FROM reading_cost_audits WHERE call_id=? AND disposition='not-billed'",
        )
        .get(callId);
    if (!["sent", "unknown"].includes(c.state) && !deniedBilling)
      throw Error("INVALID_CALL_TRANSITION");
    const actual = estimatedCost(this.price(c.price), normalized);
    this.db
      .prepare(
        "UPDATE reading_calls SET state='settled',actual=?,usage=? WHERE id=?",
      )
      .run(actual, serialized, callId);
    this.db
      .prepare("UPDATE reading_wallets SET spent=spent+? WHERE account=?")
      .run(actual, c.account);
    this.event("settle:" + callId, "settle", c.account, callId, actual);
    if (deniedBilling)
      this.event(
        "cost-proof-conflict:" + callId,
        "cost-proof-conflict",
        c.account,
        callId,
        0,
      );
    if (
      deniedBilling ||
      actual > c.reserved ||
      this.wallet(c.account).spent > this.wallet(c.account).granted
    )
      this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
    return this.call(callId);
  }
  releaseUnsent(callId) {
    return this.transaction(() => {
      const c = this.call(callId);
      if (!c) throw Error("CALL_NOT_FOUND");
      if (c.state === "released") return c;
      if (c.state !== "reserved") throw Error("NOT_PROVEN_UNSENT");
      this.db
        .prepare("UPDATE reading_calls SET state='released' WHERE id=?")
        .run(callId);
      this.event("release:" + callId, "release", c.account, callId, c.reserved);
      return this.call(callId);
    });
  }
  recoverSent() {
    for (const c of this.db
      .prepare("SELECT id FROM reading_calls WHERE state='sent'")
      .all()) {
      const envelope = this.db
        .prepare("SELECT usage FROM reading_envelopes WHERE call=?")
        .get(c.id);
      if (envelope) this.settle(c.id, JSON.parse(envelope.usage));
      else {const usage=this.receipts.usage(c.id);if(usage)this.settle(c.id,usage);else this.unknown(c.id);}
    }
  }
  audit(account) {
    const wallets = account
      ? this.db
          .prepare("SELECT * FROM reading_wallets WHERE account=?")
          .all(account)
      : this.db.prepare("SELECT * FROM reading_wallets").all();
    let checkedCalls = 0;
    for (const wallet of wallets) {
      const events = this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN kind='grant' THEN amount ELSE 0 END),0) granted,COALESCE(SUM(CASE WHEN kind IN ('settle','legacy-settle') THEN amount ELSE 0 END),0) spent FROM reading_events WHERE account=?",
        )
        .get(wallet.account);
      let valid =
        events.granted === wallet.granted && events.spent === wallet.spent && this.legacy.audit(wallet.account);
      const projection = this.db
        .prepare(
          "SELECT COALESCE(SUM(actual),0) spent FROM reading_calls WHERE account=? AND state='settled'",
        )
        .get(wallet.account);
      valid &&= projection.spent + this.legacy.spent(wallet.account) === wallet.spent;
      for (const call of this.db
        .prepare("SELECT * FROM reading_calls WHERE account=?")
        .all(wallet.account)) {
        checkedCalls++;
        const reserve = this.db
          .prepare(
            "SELECT amount FROM reading_events WHERE operation=? AND account=?",
          )
          .get("reserve:" + call.id, wallet.account);
        valid &&= reserve?.amount === call.reserved;
        if (call.state === "released") {
          const sent = this.db
            .prepare(
              "SELECT 1 FROM reading_events WHERE operation=? AND account=? AND call=? AND kind='sent'",
            )
            .get("sent:" + call.id, wallet.account, call.id);
          const release = this.db
            .prepare(
              "SELECT amount FROM reading_events WHERE operation=? AND account=? AND call=? AND kind=?",
            )
            .get(
              (sent ? "cost-release:" : "release:") + call.id,
              wallet.account,
              call.id,
              sent ? "reconcile-release" : "release",
            );
          const receipt =
            sent &&
            this.db
              .prepare(
                "SELECT 1 FROM reading_cost_audits WHERE account=? AND call_id=? AND disposition='not-billed'",
              )
              .get(wallet.account, call.id);
          valid &&=
            release?.amount === call.reserved &&
            (!sent || !!receipt) &&
            call.actual === null &&
            call.usage === null;
        }
        const receipt = this.db
          .prepare(
            "SELECT * FROM reading_cost_audits WHERE account=? AND call_id=?",
          )
          .get(wallet.account, call.id);
        if (receipt) {
          const conflict = this.db
            .prepare(
              "SELECT 1 FROM reading_events WHERE account=? AND call=? AND kind='cost-proof-conflict'",
            )
            .get(wallet.account, call.id);
          valid &&=
            receipt.disposition === "usage"
              ? call.state === "settled" &&
                call.usage === receipt.usage &&
                call.actual === receipt.actual
              : call.state === "released" ||
                (call.state === "settled" && !!conflict);
          if (conflict)
            valid &&=
              this.db
                .prepare("SELECT paused FROM reading_controls WHERE id=1")
                .get().paused === 1;
        }
        if (call.state === "settled") {
          const settle = this.db
            .prepare(
              "SELECT amount FROM reading_events WHERE operation=? AND account=?",
            )
            .get("settle:" + call.id, wallet.account);
          try {
            valid &&=
              settle?.amount === call.actual &&
              estimatedCost(this.price(call.price), JSON.parse(call.usage)) ===
                call.actual;
          } catch {
            valid = false;
          }
        }
      }
      if (!valid) {
        this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
        throw Error("LEDGER_RECONCILIATION_REQUIRED");
      }
    }
    return { accounts: wallets.length, checkedCalls, valid: true };
  }
  saveEnvelope(callId, fingerprint, result, usage) {
    const body = JSON.stringify(result),
      normalized = JSON.stringify(validateUsage(usage));
    if (
      Buffer.byteLength(body) > 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(fingerprint)
    )
      throw Error("INVALID_RESULT_ENVELOPE");
    const call = this.call(callId);
    if (
      !call ||
      call.block !== fingerprint ||
      !["sent", "settled"].includes(call.state)
    )
      throw Error("INVALID_RESULT_ENVELOPE");
    this.db
      .prepare("INSERT OR IGNORE INTO reading_envelopes VALUES(?,?,?,?)")
      .run(callId, fingerprint, body, normalized);
    const saved = this.db
      .prepare("SELECT * FROM reading_envelopes WHERE call=?")
      .get(callId);
    if (saved.result !== body || saved.usage !== normalized)
      throw Error("RESULT_ENVELOPE_CONFLICT");
  }
  completedEnvelope(account, task, fingerprint, price) {
    const envelope=this.db
      .prepare(
        `SELECT e.*,c.id call_id FROM reading_envelopes e JOIN reading_calls c ON e.call=c.id
      WHERE c.account=? AND c.task=? AND e.fingerprint=? AND (? IS NULL OR c.price=?) AND c.state='settled' ORDER BY c.rowid LIMIT 1`,
      )
      .get(account, task, fingerprint, price ?? null, price ?? null);
    if(envelope)this.receipts.assertUsable(envelope.call_id);return envelope;
  }
  clearEnvelope(callId) {
    this.db.prepare("DELETE FROM reading_envelopes WHERE call=?").run(callId);
  }
  close() {
    this.db.close();
  }
}
