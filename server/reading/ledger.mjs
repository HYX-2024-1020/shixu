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
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS reading_wallets(account TEXT PRIMARY KEY,granted INTEGER NOT NULL,spent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_prices(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_calls(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES reading_wallets(account),
        task TEXT NOT NULL,block TEXT NOT NULL,generation INTEGER NOT NULL,price TEXT NOT NULL REFERENCES reading_prices(id),
        day TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','sent','settled','unknown','released')),
        reserved INTEGER NOT NULL,actual INTEGER,usage TEXT,fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_events(seq INTEGER PRIMARY KEY,operation TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,
        account TEXT NOT NULL,call TEXT,amount INTEGER NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_controls(id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reading_envelopes(call TEXT PRIMARY KEY REFERENCES reading_calls(id),fingerprint TEXT NOT NULL,result TEXT NOT NULL,usage TEXT NOT NULL);
      INSERT OR IGNORE INTO reading_controls(id) VALUES(1);
      CREATE TRIGGER IF NOT EXISTS reading_events_no_update BEFORE UPDATE ON reading_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS reading_events_no_delete BEFORE DELETE ON reading_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS reading_prices_no_update BEFORE UPDATE ON reading_prices BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRICE'); END;
      CREATE TRIGGER IF NOT EXISTS reading_prices_no_delete BEFORE DELETE ON reading_prices BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRICE'); END;
      PRAGMA foreign_keys=ON;`);
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
  call(callId) {
    return this.db
      .prepare("SELECT * FROM reading_calls WHERE id=?")
      .get(callId);
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
    const unknownRisk = this.db
      .prepare(
        "SELECT COALESCE(SUM(reserved),0) n FROM reading_calls WHERE account=? AND state='unknown'",
      )
      .get(account).n;
    const paused = this.db
      .prepare("SELECT paused FROM reading_controls WHERE id=1")
      .get().paused;
    return {
      ...w,
      reserved,
      unknownRisk,
      available: Math.max(0, w.granted - w.spent - reserved - unknownRisk),
      pausedReason: unknownRisk
        ? "UNKNOWN_COST"
        : paused
          ? "LEDGER_PAUSED"
          : "",
      lowBalance: w.granted - w.spent < 3000000,
    };
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
      if (
        this.db.prepare("SELECT paused FROM reading_controls WHERE id=1").get()
          .paused
      )
        throw Error("LEDGER_PAUSED");
      if (
        this.db
          .prepare(
            "SELECT 1 FROM reading_calls WHERE account=? AND state='unknown'",
          )
          .get(account)
      )
        throw Error("UNKNOWN_COST");
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
      if (site + reserve > this.limits.siteDailyMicros)
        throw Error("SITE_BUDGET");
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
  sent(callId) {
    return this.transaction(() => {
      const c = this.call(callId);
      if (!c) throw Error("CALL_NOT_FOUND");
      if (c.state === "sent") return c;
      if (c.state !== "reserved") throw Error("INVALID_CALL_TRANSITION");
      this.db
        .prepare("UPDATE reading_calls SET state='sent' WHERE id=?")
        .run(callId);
      this.event("sent:" + callId, "sent", c.account, callId, 0);
      return this.call(callId);
    });
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
  settle(callId, usage) {
    const normalized = validateUsage(usage),
      serialized = JSON.stringify(normalized);
    return this.transaction(() => {
      const c = this.call(callId);
      if (!c) throw Error("CALL_NOT_FOUND");
      if (c.state === "settled") {
        if (c.usage !== serialized) throw Error("USAGE_CONFLICT");
        return c;
      }
      if (!["sent", "unknown"].includes(c.state))
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
      if (
        actual > c.reserved ||
        this.wallet(c.account).spent > this.wallet(c.account).granted
      )
        this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
      return this.call(callId);
    });
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
      else this.unknown(c.id);
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
          "SELECT COALESCE(SUM(CASE WHEN kind='grant' THEN amount ELSE 0 END),0) granted,COALESCE(SUM(CASE WHEN kind='settle' THEN amount ELSE 0 END),0) spent FROM reading_events WHERE account=?",
        )
        .get(wallet.account);
      let valid =
        events.granted === wallet.granted && events.spent === wallet.spent;
      const projection = this.db
        .prepare(
          "SELECT COALESCE(SUM(actual),0) spent FROM reading_calls WHERE account=? AND state='settled'",
        )
        .get(wallet.account);
      valid &&= projection.spent === wallet.spent;
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
    return this.db
      .prepare(
        `SELECT e.*,c.id call_id FROM reading_envelopes e JOIN reading_calls c ON e.call=c.id
      WHERE c.account=? AND c.task=? AND e.fingerprint=? AND (? IS NULL OR c.price=?) AND c.state='settled' ORDER BY c.rowid LIMIT 1`,
      )
      .get(account, task, fingerprint, price ?? null, price ?? null);
  }
  clearEnvelope(callId) {
    this.db.prepare("DELETE FROM reading_envelopes WHERE call=?").run(callId);
  }
  close() {
    this.db.close();
  }
}
