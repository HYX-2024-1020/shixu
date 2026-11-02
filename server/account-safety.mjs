import { createHash, randomUUID } from "node:crypto";
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

// The independent ledger retains only random tokens and hashes, never passwords,
// password verifiers, device keys, names or authentication response bodies.
// This fences unsafe restored registries; it does not perform E's backup replay.
export class AccountSafety {
  constructor(registry, ledger, { fault = () => {} } = {}) {
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
    this.recover();
    registry.safety = this;
  }
  hash() {
    const hash = createHash("sha256");
    for (const query of queries) {
      hash.update(query);
      for (const row of this.db.prepare(query).iterate())
        hash.update(JSON.stringify(row));
    }
    return hash.digest("hex");
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
  recover() {
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
      if (
        local ||
        this.db
          .prepare(
            "SELECT 1 FROM bindings UNION SELECT 1 FROM account_credentials UNION SELECT 1 FROM ai_usage LIMIT 1",
          )
          .get()
      )
        throw Error("ACCOUNT_SAFETY_BASELINE_REQUIRED");
      this.transaction(() => {}, true);
    } else this.assert();
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
  transaction(fn, initial = false) {
    if (!initial) this.assert();
    if (this.active || this.db.isTransaction) denied();
    const previous = this.local();
    let token;
    this.active = true;
    return withDatabaseWriteAuthority(this.db, () => {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        const value = fn();
        const hash = this.hash(),
          head = this.head();
        if (initial || hash !== head.state_hash) {
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
