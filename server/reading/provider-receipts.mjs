import { sha256 } from "./material.mjs";
import { applyReadingMigrations, assertReadingSchema } from "./schema.mjs";
const hash = (v) => sha256(JSON.stringify(v)),
  hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
  uint = (v) => Number.isSafeInteger(v) && v >= 0;
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === keys;
const token = (v, max) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  /^[A-Za-z0-9._:/-]+$/.test(v);
const SQL = `CREATE TABLE reading_provider_requests(call_id TEXT PRIMARY KEY REFERENCES reading_calls(id),account TEXT NOT NULL,provider TEXT NOT NULL,request_hash TEXT NOT NULL,model TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE reading_provider_receipts(seq INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES reading_calls(id),account TEXT NOT NULL,observation_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL,provider TEXT NOT NULL,request_hash TEXT,response_id TEXT,model TEXT,created INTEGER,http_status INTEGER,response_hash TEXT,usage_hash TEXT,usage TEXT,at INTEGER NOT NULL);
CREATE INDEX reading_provider_receipt_call ON reading_provider_receipts(call_id,seq);
CREATE TABLE reading_provider_response_links(provider TEXT NOT NULL,response_id TEXT NOT NULL,call_id TEXT NOT NULL REFERENCES reading_calls(id),PRIMARY KEY(provider,response_id));
${["reading_provider_requests", "reading_provider_receipts", "reading_provider_response_links"].flatMap((table) => ["UPDATE", "DELETE"].map((action) => `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROVIDER_RECEIPT');END;`)).join("\n")}`;
export class ReadingProviderReceipts {
  constructor(ledger) {
    this.ledger = ledger;
    this.db = ledger.db;
    applyReadingMigrations(ledger, "provider-receipts", [
      { version: 1, sql: SQL },
    ]);
    assertReadingSchema(ledger, SQL);
  }
  request(call) {
    return this.db
      .prepare("SELECT * FROM reading_provider_requests WHERE call_id=?")
      .get(call);
  }
  requestLocked(call, intent) {
    if (intent === undefined) return;
    if (
      !exact(intent, "model,provider,requestHash") ||
      intent.provider !== "deepseek" ||
      !hex(intent.requestHash) ||
      !token(intent.model, 160)
    )
      throw Error("INVALID_PROVIDER_REQUEST_INTENT");
    const prior = this.request(call.id);
    if (prior) {
      if (
        prior.account !== call.account ||
        prior.provider !== intent.provider ||
        prior.request_hash !== intent.requestHash ||
        prior.model !== intent.model
      ) {
        this.pause(call, "provider-request-conflict");
        return { conflict: true };
      }
      return;
    }
    if (call.state !== "reserved") throw Error("PROVIDER_REQUEST_NOT_RESERVED");
    this.db
      .prepare("INSERT INTO reading_provider_requests VALUES(?,?,?,?,?,?)")
      .run(
        call.id,
        call.account,
        intent.provider,
        intent.requestHash,
        intent.model,
        this.ledger.now(),
      );
    this.ledger.event(
      "provider-request:" + call.id,
      "provider-request",
      call.account,
      call.id,
      0,
    );
  }
  pause(call, kind) {
    this.db.exec("UPDATE reading_controls SET paused=1 WHERE id=1");
    const operation = kind + ":" + call.id;
    if (
      !this.db
        .prepare("SELECT 1 FROM reading_events WHERE operation=?")
        .get(operation)
    )
      this.ledger.event(operation, kind, call.account, call.id, 0);
  }
  latest(call) {
    return this.db
      .prepare(
        "SELECT * FROM reading_provider_receipts WHERE call_id=? ORDER BY seq DESC LIMIT 1",
      )
      .get(call);
  }
  captureLocked(call, raw, usage) {
    if (raw === undefined) return null;
    if (!["sent", "unknown", "settled"].includes(call.state))
      throw Error("PROVIDER_RECEIPT_NOT_SENT");
    const request = this.request(call.id),
      shape = exact(
        raw,
        "created,httpStatus,model,provider,requestHash,responseHash,responseId",
      ),
      provider = raw?.provider === "deepseek" ? "deepseek" : "invalid";
    const value = {
      provider,
      requestHash: hex(raw?.requestHash) ? raw.requestHash : null,
      responseId: token(raw?.responseId, 200) ? raw.responseId : null,
      model: token(raw?.model, 160) ? raw.model : null,
      created: uint(raw?.created) ? raw.created : null,
      httpStatus:
        Number.isSafeInteger(raw?.httpStatus) &&
        raw.httpStatus >= 100 &&
        raw.httpStatus <= 599
          ? raw.httpStatus
          : null,
      responseHash: hex(raw?.responseHash) ? raw.responseHash : null,
    };
    let status =
      !shape ||
      provider === "invalid" ||
      !value.requestHash ||
      (!value.responseHash && value.httpStatus === 200) ||
      !value.httpStatus
        ? "invalid"
        : !request
          ? "unbound"
          : provider !== request.provider ||
              value.requestHash !== request.request_hash
            ? "conflict"
            : !value.responseId ||
                !value.model ||
                value.created === null ||
                value.httpStatus !== 200
              ? "missing"
              : "linked";
    const serialized = usage === undefined ? null : JSON.stringify(usage),
      usageHash = serialized ? sha256(serialized) : null;
    const previous = this.latest(call.id);
    if (previous?.status === "conflict" || previous?.status === "invalid")
      status = "conflict";
    if (status === "linked") {
      const owner = this.db
        .prepare(
          "SELECT call_id FROM reading_provider_response_links WHERE provider=? AND response_id=?",
        )
        .get(provider, value.responseId);
      if (owner && owner.call_id !== call.id) status = "conflict";
    }
    if (
      previous &&
      ((previous.status === "linked" && status !== "linked") ||
        (previous.response_id &&
          value.responseId &&
          previous.response_id !== value.responseId) ||
        (previous.response_hash &&
          value.responseHash &&
          previous.response_hash !== value.responseHash) ||
        (previous.model && value.model && previous.model !== value.model) ||
        (previous.created !== null &&
          value.created !== null &&
          previous.created !== value.created) ||
        previous.http_status !== value.httpStatus ||
        (previous.usage_hash && usageHash && previous.usage_hash !== usageHash))
    )
      status = "conflict";
    const observationHash = hash([call.id, status, value, usageHash]);
    const old = this.db
      .prepare(
        "SELECT * FROM reading_provider_receipts WHERE observation_hash=?",
      )
      .get(observationHash);
    if (old) return old;
    if (status === "linked")
      this.db
        .prepare(
          "INSERT OR IGNORE INTO reading_provider_response_links VALUES(?,?,?)",
        )
        .run(provider, value.responseId, call.id);
    this.db
      .prepare(
        "INSERT INTO reading_provider_receipts(call_id,account,observation_hash,status,provider,request_hash,response_id,model,created,http_status,response_hash,usage_hash,usage,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        call.id,
        call.account,
        observationHash,
        status,
        provider,
        value.requestHash,
        value.responseId,
        value.model,
        value.created,
        value.httpStatus,
        value.responseHash,
        usageHash,
        serialized,
        this.ledger.now(),
      );
    this.ledger.event(
      "provider-receipt:" + observationHash,
      "provider-receipt",
      call.account,
      call.id,
      0,
    );
    if (["conflict", "invalid"].includes(status))
      this.pause(call, "provider-receipt-conflict");
    return this.latest(call.id);
  }
  usage(call) {
    const row = this.db
      .prepare(
        "SELECT usage,usage_hash FROM reading_provider_receipts WHERE call_id=? AND usage IS NOT NULL ORDER BY seq LIMIT 1",
      )
      .get(call);
    if (!row || sha256(row.usage) !== row.usage_hash) return null;
    return JSON.parse(row.usage);
  }
  assertUsable(call) {
    const row = this.latest(call);
    if (row && ["conflict", "invalid"].includes(row.status))
      throw Error("PROVIDER_RECEIPT_RECONCILIATION");
    if (this.request(call) && !row)
      throw Error("PROVIDER_RECEIPT_RECONCILIATION");
  }
  review(call, { includeIds = false } = {}) {
    const request = this.request(call),
      row = this.latest(call);
    if (!request && !row) return { status: "legacy-unrecorded" };
    return {
      status: row?.status || "awaiting",
      provider: request?.provider || row.provider,
      requestHash: request?.request_hash || null,
      responseIdHash: row?.response_id ? sha256(row.response_id) : null,
      ...(includeIds ? { responseId: row?.response_id || null } : {}),
      model: row?.model || null,
      created: row?.created ?? null,
      httpStatus: row?.http_status ?? null,
      responseHash: row?.response_hash || null,
      usageHash: row?.usage_hash || null,
      finalBillingEvidence: false,
    };
  }
}
