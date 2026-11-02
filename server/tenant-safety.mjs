import { createHash, randomUUID } from "node:crypto";
import {
  ensureDatabaseSchema,
  withDatabaseWriteAuthority,
} from "./database-schema.mjs";
import { LEDGER_TENANT_SAFETY_SCHEMA } from "./database-schemas.mjs";
import { SyncError } from "./sync-store.mjs";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const denied = () => {
  throw new SyncError(
    503,
    "TENANT_SAFETY_RECONCILIATION",
    "资料删除与期限记录待核对，服务已暂停；本机资料仍保留",
  );
};

// Lifecycle metadata only: no names, text, blobs, results or credentials. This
// uses the existing independent ledger and writer authority, not another store.
export class TenantSafety {
  constructor(store, ledger, account, { fault = () => {} } = {}) {
    Object.assign(this, {
      store,
      db: store.db,
      ledger,
      account,
      fault,
      active: false,
      blocked: false,
    });
    this.db.exec("PRAGMA synchronous=FULL");
    ensureDatabaseSchema(
      ledger.db,
      "ledger-tenant-safety",
      LEDGER_TENANT_SAFETY_SCHEMA,
    );
    this.recover();
    store.safety = this;
  }
  state() {
    return {
      epoch: this.store.meta("epoch"),
      records: this.db
        .prepare("SELECT id,deleted_at,purged FROM sync_records ORDER BY id")
        .all(),
      files: this.db
        .prepare(
          "SELECT packet,id,hash,size,mode,state,expires,cleanup,version FROM original_files ORDER BY packet,id",
        )
        .all(),
      trash: this.db
        .prepare("SELECT packet,cleanup FROM original_trash ORDER BY packet")
        .all(),
    };
  }
  local() {
    const token =
      this.db
        .prepare("SELECT token FROM original_safety_checkpoint WHERE id=1")
        .get()?.token || "";
    if (token !== (this.store.meta("tenant_safety") || "")) denied();
    return token;
  }
  rows() {
    return this.ledger.db
      .prepare(
        `SELECT i.*,d.decision FROM tenant_safety_intents i
      LEFT JOIN tenant_safety_decisions d ON d.token=i.token WHERE i.account=? ORDER BY i.seq`,
      )
      .all(this.account);
  }
  head() {
    return this.rows()
      .filter((r) => r.decision === "committed")
      .at(-1);
  }
  decide(token, decision) {
    this.ledger.transaction(() => {
      const intent = this.ledger.db
        .prepare(
          "SELECT state_hash FROM tenant_safety_intents WHERE token=? AND account=?",
        )
        .get(token, this.account);
      if (!intent) denied();
      this.ledger.db
        .prepare("INSERT INTO tenant_safety_decisions VALUES(?,?)")
        .run(token, decision);
      this.ledger.event(
        "tenant-safety:" + token + ":" + intent.state_hash,
        "tenant-safety-" + decision,
        "system:tenant-safety",
        null,
        0,
      );
    });
  }
  recover() {
    const rows = this.rows();
    let previous = "",
      pending;
    for (const row of rows) {
      if (
        pending ||
        row.previous !== previous ||
        digest(JSON.parse(row.state)) !== row.state_hash
      )
        denied();
      if (row.decision === "committed") previous = row.token;
      else if (!row.decision) pending = row;
    }
    let head = this.head();
    const local = this.local(),
      hash = digest(this.state());
    if (pending) {
      if (local === pending.token && hash === pending.state_hash)
        this.decide(pending.token, "committed");
      else if (local === pending.base_token && hash === pending.base_hash)
        this.decide(pending.token, "aborted");
      else denied();
      head = this.head();
    }
    if (!head) {
      // Even an empty restored tenant cannot silently forget prior task roots.
      if (
        local ||
        this.state().records.length ||
        this.state().files.length ||
        this.state().trash.length ||
        (this.ledger.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='reading_safe_roots'",
          )
          .get() &&
          this.ledger.db
            .prepare("SELECT 1 FROM reading_safe_roots WHERE account=? LIMIT 1")
            .get(this.account))
      )
        throw Error("TENANT_SAFETY_BASELINE_REQUIRED");
      this.transaction(() => {}, { initial: true });
    } else if (head.token === local && head.state_hash === hash) this.assert();
    else {
      const ancestor = rows.find(
        (r) =>
          r.token === local &&
          r.decision === "committed" &&
          r.state_hash === hash,
      );
      if (!ancestor) denied();
      const target = JSON.parse(head.state);
      this.checkReplay(this.state(), target);
      // Replay only destructive/constraining transitions, never missing content,
      // positive restoration or a renewal from an older unverified projection.
      this.transaction(
        () => {
          for (const r of target.records) {
            if (r.purged) this.store.files.purge(r.id);
            this.db
              .prepare(
                "UPDATE sync_records SET deleted_at=?,purged=?,data=CASE WHEN ? THEN NULL ELSE data END WHERE id=?",
              )
              .run(r.deleted_at, r.purged, r.purged, r.id);
          }
          for (const f of target.files) {
            if (["deleted", "cleaned"].includes(f.state))
              this.store.originals.remove(f, f.state);
            this.db
              .prepare(
                "UPDATE original_files SET state=?,expires=?,cleanup=?,version=? WHERE packet=? AND id=?",
              )
              .run(f.state, f.expires, f.cleanup, f.version, f.packet, f.id);
          }
          this.db.exec("DELETE FROM original_trash");
          for (const t of target.trash)
            this.db
              .prepare("INSERT INTO original_trash VALUES(?,?)")
              .run(t.packet, t.cleanup);
          // A restored cursor/operation cache must not accept old offline writes.
          this.db
            .prepare("UPDATE sync_meta SET value=? WHERE key='epoch'")
            .run(randomUUID());
        },
        { replay: true },
      );
      this.store.epoch = this.store.meta("epoch");
    }
  }
  checkReplay(before, target) {
    if (
      before.records.length !== target.records.length ||
      before.files.length !== target.files.length
    )
      denied();
    for (let i = 0; i < before.records.length; i++) {
      const b = before.records[i],
        a = target.records[i];
      if (
        b.id !== a.id ||
        b.purged > a.purged ||
        (b.deleted_at && b.deleted_at !== a.deleted_at)
      )
        denied();
    }
    for (let i = 0; i < before.files.length; i++) {
      const b = before.files[i],
        a = target.files[i];
      if (
        ["packet", "id", "hash", "size", "mode"].some((k) => b[k] !== a[k]) ||
        a.version < b.version ||
        ["expires", "cleanup"].some(
          (k) =>
            b[k] !== a[k] && (b[k] === null || a[k] === null || a[k] > b[k]),
        ) ||
        (a.state !== b.state &&
          !["pending_cleanup", "deleted", "cleaned"].includes(a.state)) ||
        (["deleted", "cleaned"].includes(b.state) &&
          !["deleted", "cleaned"].includes(a.state))
      )
        denied();
    }
    for (const b of before.trash) {
      const a = target.trash.find((t) => t.packet === b.packet);
      if (
        (!a && !target.records.find((r) => r.id === b.packet)?.purged) ||
        (a && a.cleanup > b.cleanup)
      )
        denied();
    }
  }
  assert() {
    if (this.active) return;
    const rows = this.rows(),
      head = rows.filter((r) => r.decision === "committed").at(-1);
    if (
      this.blocked ||
      rows.some((r) => !r.decision) ||
      !head ||
      head.token !== this.local() ||
      head.state_hash !== digest(this.state())
    )
      denied();
  }
  transaction(fn, { initial = false, replay = false } = {}) {
    if (this.active) return fn();
    if (!initial && !replay) this.assert();
    if (this.db.isTransaction) denied();
    const previous = this.head()?.token || "",
      baseToken = this.local(),
      baseHash = digest(this.state());
    let token;
    this.active = true;
    return withDatabaseWriteAuthority(this.db, () => {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        // Recheck under the tenant write lock; another coordinated connection
        // must not slip a lifecycle change between the preflight and BEGIN.
        if (
          this.local() !== baseToken ||
          digest(this.state()) !== baseHash ||
          (this.head()?.token || "") !== previous
        )
          denied();
        const result = fn(),
          state = this.state(),
          hash = digest(state);
        if (initial || replay || hash !== this.head().state_hash) {
          token = randomUUID();
          this.ledger.transaction(() => {
            if (
              this.rows().some((r) => !r.decision) ||
              (this.head()?.token || "") !== previous
            )
              denied();
            this.ledger.db
              .prepare(
                "INSERT INTO tenant_safety_intents(account,token,previous,base_token,base_hash,state_hash,state,at) VALUES(?,?,?,?,?,?,?,?)",
              )
              .run(
                this.account,
                token,
                previous,
                baseToken,
                baseHash,
                hash,
                JSON.stringify(state),
                this.ledger.now(),
              );
          });
          this.fault("prepared");
          this.db
            .prepare(
              "INSERT INTO original_safety_checkpoint VALUES(1,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token",
            )
            .run(token);
          this.db
            .prepare(
              "INSERT INTO sync_meta VALUES('tenant_safety',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(token);
        }
        this.db.exec("COMMIT");
        if (token) {
          this.fault("tenant-committed");
          this.decide(token, "committed");
        }
        return result;
      } catch (error) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
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
