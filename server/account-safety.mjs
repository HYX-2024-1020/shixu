import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  ensureDatabaseSchema,
  withDatabaseWriteAuthority,
} from "./database-schema.mjs";
import { LEDGER_ACCOUNT_SAFETY_SCHEMA } from "./database-schemas.mjs";
import { SyncError } from "./sync-store.mjs";

const denied = () => {
  throw new SyncError(
    503,
    "ACCOUNT_SAFETY_RECONCILIATION",
    "账号安全记录不一致，服务已暂停，请联系维护者核对；本机资料仍保留",
  );
};
const queries = [
  "SELECT id,enabled,invite_hash,limits,created_at FROM accounts ORDER BY id",
  "SELECT id,user_id,kind,identity,public_key,revoked,expires FROM bindings ORDER BY id",
  "SELECT * FROM account_credentials ORDER BY user_id",
  "SELECT binding,user_id,kind,slot FROM account_device_slots ORDER BY binding",
  "SELECT * FROM account_grant_intents ORDER BY account",
  "SELECT * FROM account_v4_events ORDER BY seq",
];

function projectionHash(db, projections) {
  const hash = createHash("sha256");
  for (const query of projections) {
    hash.update(query);
    for (const row of db.prepare(query).iterate())
      hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
}

// Used on an independently reviewed, stopped registry with the current schema.
export function accountBaselineHash(db) {
  return projectionHash(db, [...queries, "SELECT * FROM ai_usage ORDER BY user_id,job_id"]);
}

// The ledger stores checkpoint hashes and minimal revocation evidence. It
// never stores passwords, verifiers, device keys or authentication responses.
export class AccountSafety {
  constructor(registry, ledger, { fault = () => {}, baselineHash } = {}) {
    this.registry = registry;
    this.db = registry.db;
    this.ledger = ledger;
    this.fault = fault;
    this.active = false;
    this.blocked = false;
    this.db.exec("PRAGMA synchronous=FULL");
    ensureDatabaseSchema(
      ledger.db,
      "ledger-account-safety",
      LEDGER_ACCOUNT_SAFETY_SCHEMA,
    );
    this.recover(baselineHash);
    registry.safety = this;
  }
  hash() {
    return projectionHash(this.db, queries);
  }
  local() {
    return (
      this.db
        .prepare("SELECT token FROM account_safety_checkpoint WHERE id=1")
        .get()?.token || ""
    );
  }
  head() {
    return this.ledger.db
      .prepare(
        "SELECT i.* FROM account_safety_intents i JOIN account_safety_decisions d ON d.token=i.token WHERE d.decision='committed' ORDER BY i.seq DESC LIMIT 1",
      )
      .get();
  }
  pending() {
    return this.ledger.db
      .prepare(
        "SELECT i.* FROM account_safety_intents i LEFT JOIN account_safety_decisions d ON d.token=i.token WHERE d.token IS NULL ORDER BY i.seq",
      )
      .all();
  }
  decide(token, decision) {
    this.ledger.transaction(() => {
      const intent = this.ledger.db
        .prepare("SELECT state_hash FROM account_safety_intents WHERE token=?")
        .get(token);
      if (!intent) denied();
      this.ledger.db
        .prepare("INSERT INTO account_safety_decisions VALUES(?,?)")
        .run(token, decision);
      // Existing data-version ledger-prefix proofs also cover these decisions.
      // A synthetic system identity contributes no grant, spending or user seq.
      this.ledger.event(
        "account-safety:" + token + ":" + intent.state_hash,
        "account-safety-" + decision,
        "system:account-safety",
        null,
        0,
      );
    });
  }
  recover(baselineHash) {
    const local = this.local(),
      hash = this.hash();
    let previous = "";
    // Validate the complete append-only chain, including aborted intents.
    const rows = this.ledger.db
      .prepare(
        "SELECT i.*,d.decision FROM account_safety_intents i LEFT JOIN account_safety_decisions d ON d.token=i.token ORDER BY i.seq",
      )
      .all();
    let unresolved = false;
    for (const row of rows) {
      if (
        unresolved ||
        row.previous !== previous ||
        !/^[a-f0-9]{64}$/.test(row.state_hash)
      )
        denied();
      if (row.decision === "committed") previous = row.token;
      else if (!row.decision) unresolved = true;
    }
    const pending = this.pending(),
      head = this.head();
    if (pending.length > 1) denied();
    if (pending.length) {
      const intent = pending[0];
      if (local === intent.token && hash === intent.state_hash)
        this.decide(intent.token, "committed");
      else if (
        local === (head?.token || "") &&
        (!head || hash === head.state_hash)
      )
        this.decide(intent.token, "aborted");
      else denied();
    }
    if (!this.head()) {
      if (local) throw Error("ACCOUNT_SAFETY_BASELINE_REQUIRED");
      this.transaction(() => {
        const populated = this.db
          .prepare(
            "SELECT 1 FROM bindings UNION SELECT 1 FROM account_credentials UNION SELECT 1 FROM ai_usage LIMIT 1",
          )
          .get();
        if ((populated || baselineHash !== undefined) &&
            (typeof baselineHash !== "string" || accountBaselineHash(this.db) !== baselineHash))
          throw Error("ACCOUNT_SAFETY_BASELINE_REQUIRED");
      }, true);
    } else {
      const latest = this.head();
      if (local !== latest.token) this.replayRestrictions(rows, local, hash, latest.token);
      this.assert();
    }
  }
  replayRestrictions(rows, local, hash, latest) {
    const committed = rows.filter(row => row.decision === "committed");
    const ancestor = committed.findIndex(row => row.token === local && row.state_hash === hash);
    if (ancestor < 0 || committed.at(-1)?.token !== latest) denied();
    withDatabaseWriteAuthority(this.db, () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        if (this.local() !== local || this.hash() !== hash || this.pending().length ||
            this.head()?.token !== latest) denied();
        for (const checkpoint of committed.slice(ancestor + 1)) {
          const row = this.ledger.db.prepare("SELECT * FROM account_safety_revocations WHERE token=?").get(checkpoint.token);
          if (!row) {
            this.applyRestriction(checkpoint.token);
            if (this.hash() !== checkpoint.state_hash) denied();
            continue;
          }
          const binding = this.db.prepare("UPDATE bindings SET revoked=1 WHERE id=? AND user_id=?")
            .run(row.binding, row.account);
          if (binding.changes !== 1) denied();
          this.db.prepare("DELETE FROM account_device_slots WHERE binding=?").run(row.binding);
          this.db.prepare("INSERT INTO account_v4_events VALUES(?,?,'revoke',?,?,?)")
            .run(row.event_seq, row.operation, row.account, row.binding, row.at);
          const fingerprint = createHmac("sha256", this.registry.secret)
            .update(JSON.stringify(["revoke", row.account, row.binding]))
            .digest("hex");
          this.db.prepare("INSERT INTO account_v4_operations VALUES(?,?,?)")
            .run(row.operation, fingerprint, '{"ok":true}');
          if (this.hash() !== checkpoint.state_hash) denied();
        }
        this.db.prepare("UPDATE account_safety_checkpoint SET token=? WHERE id=1").run(latest);
        this.db.exec("COMMIT");
      } catch (error) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }
  applyRestriction(token) {
    const restriction = this.ledger.db.prepare(
      "SELECT account,kind FROM account_safety_restrictions WHERE token=?",
    ).get(token);
    if (!restriction) denied();
    if (restriction.kind === "disable") {
      this.db.prepare("UPDATE accounts SET enabled=0 WHERE id=?").run(restriction.account);
    } else {
      this.db.prepare("UPDATE bindings SET revoked=1 WHERE user_id=? AND kind=?")
        .run(restriction.account, restriction.kind.slice("revoke-".length));
    }
  }
  assert() {
    if (this.active) return;
    const head = this.head();
    if (
      this.blocked ||
      this.pending().length ||
      !head ||
      head.token !== this.local() ||
      head.state_hash !== this.hash()
    )
      denied();
  }
  transaction(fn, initial = false, restriction) {
    if (!initial) this.assert();
    if (this.active || this.db.isTransaction) denied();
    const previous = this.local();
    let token;
    this.active = true;
    return withDatabaseWriteAuthority(this.db, () => {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        const beforeEvent = this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM account_v4_events").get().seq;
        const value = fn();
        const hash = this.hash(),
          head = this.head();
        if (initial || hash !== head.state_hash) {
          const events = this.db.prepare("SELECT * FROM account_v4_events WHERE seq>? ORDER BY seq LIMIT 2").all(beforeEvent);
          const event = events.length === 1 && events[0].kind === "revoke" ? events[0] : null;
          const receipt = event && this.db.prepare("SELECT response FROM account_v4_operations WHERE id=?").get(event.operation);
          token = randomUUID();
          this.ledger.transaction(() => {
            if (
              this.pending().length ||
              (this.head()?.token || "") !== previous
            )
              denied();
            this.ledger.db
              .prepare(
                "INSERT INTO account_safety_intents(token,previous,state_hash,at) VALUES(?,?,?,?)",
              )
              .run(token, previous, hash, this.ledger.now());
            if (event?.binding && receipt?.response === '{"ok":true}')
              this.ledger.db.prepare("INSERT INTO account_safety_revocations VALUES(?,?,?,?,?,?)")
                .run(token, event.seq, event.operation, event.account, event.binding, event.at);
            else if (restriction)
              this.ledger.db.prepare("INSERT INTO account_safety_restrictions VALUES(?,?,?)")
                .run(token, restriction.account, restriction.kind);
            this.ledger.event("account-safety-prepare:" + token, "account-safety-prepare", "system:account-safety", null, 0);
          });
          this.fault("prepared");
          this.db
            .prepare(
              "INSERT INTO account_safety_checkpoint VALUES(1,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token",
            )
            .run(token);
        }
        this.db.exec("COMMIT");
        if (token) this.fault("registry-committed");
        if (token) this.decide(token, "committed");
        return value;
      } catch (error) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        // A failed independent write must never be hidden by continuing to serve.
        if (token) {
          this.blocked = true;
          denied();
        }
        throw error;
      } finally {
        this.active = false;
      }
    });
  }
}
