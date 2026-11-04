import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountRegistry } from "../../scripts/stage-a/legacy/sync-accounts.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingLegacyMaintenance } from "./legacy-ledger.mjs";
import { sha256, readMaterial } from "./material.mjs";
import { walletView } from "../../shared/reading-view.mjs";
import { DatabaseSync } from "node:sqlite";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import { LEDGER_CORE_SCHEMA } from "../database-schemas.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingTasks } from "./tasks.mjs";

const price = {
  id: "legacy-test-price",
  model: "synthetic",
  currency: "CNY",
  source: "synthetic only",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 0,
  outputMicrosPerMillion: 1000000,
};
test("pre-intake queued work and old continue actions cannot consume after final billing; a fresh user action authorizes only its generation", async (t) => {
  const f = fixture(t),
    store = new SyncStore(":memory:");
  createAttachmentStore(store);
  const device = store.createDevice("synthetic").deviceId;
  store.apply(
    device,
    {
      id: "packet",
      opId: "seed",
      type: "put",
      baseVersion: 0,
      data: {
        text: "合成材料",
        captureDate: "2026-11-01",
        sources: [],
        attachments: [],
        result: null,
      },
    },
    store.epoch,
  );
  let calls = 0;
  const tasks = new ReadingTasks({
    store,
    ledger: f.ledger,
    account: f.account,
    priceId: price.id,
    modelVersion: "synthetic",
    authorize: () => {},
    reader: readMaterial,
    provider: async (sources) => {
      calls++;
      return {
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        result: {
          summary: "合成",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成",
              summary: "",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [{ sourceId: sources[0].id, quote: sources[0].text }],
            },
          ],
        },
      };
    },
  });
  try {
    tasks.enqueue({ id: "old-task", packetId: "packet", deviceId: device });
    const beforeToken = tasks.maintenanceOperation("old-task");
    f.intake();
    f.proof();
    f.reconcile();
    await tasks.run("old-task");
    assert.equal(calls, 0);
    assert.equal(f.ledger.wallet(f.account).spent, 1400);
    const stopped = tasks.get("old-task");
    assert.ok(["paused", "error"].includes(stopped.state));
    const action = {
      operationId: "old-continue",
      expectedGeneration: stopped.generation,
      expectedRevision: stopped.input_revision,
      expectedMaintenanceOperation: beforeToken,
    };
    assert.throws(
      () => tasks.action("old-task", action, "continue", device),
      (e) => e.code === "STALE_TASK",
    );
    const fresh = {
      ...action,
      operationId: "fresh-continue",
      expectedMaintenanceOperation: tasks.maintenanceOperation("old-task"),
    };
    const queued = tasks.action("old-task", fresh, "continue", device);
    assert.equal(
      f.ledger.legacy.approved(f.account, "old-task", stopped.generation),
      false,
    );
    assert.equal(
      f.ledger.legacy.approved(f.account, "old-task", queued.generation),
      true,
    );
    await tasks.run("old-task");
    assert.equal(calls, 1, JSON.stringify(tasks.get("old-task")));
    assert.equal(f.ledger.wallet(f.account).spent, 1402);
    for (let i = 0; i < 3 && tasks.get("old-task").state === "queued"; i++)
      await tasks.run("old-task");
    assert.equal(calls, 1);
    assert.equal(tasks.get("old-task").state, "done");
    assert.equal(f.ledger.audit().valid, true);
  } finally {
    tasks.close();
    store.close();
  }
});
function fixture(t, { reserve = 1000, siteDailyMicros = 50000000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-legacy-ledger-"));
  const registry = new AccountRegistry(
    directory,
    "synthetic-legacy-cost-secret-32-characters",
  );
  const accounts = registry.generate(2).map((a) => a.userId),
    [account, unused] = accounts;
  for (const [job, state, n] of [
    ["old-pending", "pending", reserve],
    ["old-done", "done", reserve],
    ["old-error", "error", 0],
  ])
    registry.db
      .prepare("INSERT INTO ai_usage VALUES(?,?,?,?,?,?)")
      .run(account, job, sha256(job), "2026-10-31", n, state);
  let now = Date.parse("2026-11-01T15:59:00Z");
  const path = join(directory, "independent.sqlite"),
    ledger = new ReadingLedger(path, { now: () => now, siteDailyMicros });
  ledger.freezePrice(price);
  const connections = [ledger];
  t.after(() => {
    for (const c of connections) c.close();
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let proof;
  const host = new ReadingLegacyMaintenance(
    ledger,
    ({ actor }) => actor === "host",
    ({ evidenceHash }) => ({ ...proof, evidenceHash }),
  );
  const request = {
    operationId: "intake-1",
    expectedSourceHash: host.preview(registry, "host").sourceHash,
  };
  const f = {
    registry,
    ledger,
    host,
    accounts,
    account,
    unused,
    request,
    intake: () => host.intake(registry, request, "host"),
    advance: () => (now += 120000),
    reopen: () => {
      const c = new ReadingLedger(path, { now: () => now, siteDailyMicros });
      connections.push(c);
      return c;
    },
    call: (who = account, n = "new") => ({
      callId: n,
      account: who,
      task: "task",
      block: "block",
      generation: 1,
      priceId: price.id,
      maxPromptTokens: 5,
      maxOutputTokens: 5,
    }),
  };
  f.proof = (
    who = account,
    spent = 1400,
    days = [{ day: "2026-11-01", micros: spent }],
  ) => {
    const r = host.review(who, "host");
    proof = {
      final: true,
      account: who,
      sourceHash: r.sourceHash,
      usageHash: r.usageHash,
      currency: "CNY",
      allHistoricalActivityCovered: true,
      proofIdHash: sha256("final-proof:" + who),
      spentMicros: spent,
      beijingDays: days,
    };
    return proof;
  };
  f.reconcile = (who = account) =>
    host.reconcile(
      who,
      {
        operationId: "reconcile:" + who,
        evidenceHash: sha256("evidence:" + who),
        expectedLedgerSequence: ledger.sequence(who),
      },
      "host",
    );
  return f;
}
test("legacy reservations including completed/error rows remain unknown, preserve the source, grant nothing and survive restart/midnight", (t) => {
  const f = fixture(t),
    before = f.registry.db
      .prepare("SELECT * FROM ai_usage ORDER BY job_id")
      .all();
  f.intake();
  f.intake();
  const w = f.ledger.wallet(f.account);
  assert.equal(w.granted, 0);
  assert.equal(w.spent, 0);
  assert.equal(w.unknownRisk, 2000);
  assert.equal(w.pausedReason, "RECONCILIATION_REQUIRED");
  assert.equal(f.ledger.legacy.pending(f.unused), true);
  assert.equal(f.ledger.legacy.risk(f.unused), 0);
  assert.match(walletView(w), /历史费用待核对/);
  assert.throws(
    () => f.ledger.grantInitial(f.account),
    /RECONCILIATION_REQUIRED/,
  );
  assert.throws(() => f.ledger.reserve(f.call()), /RECONCILIATION_REQUIRED/);
  assert.throws(
    () => f.ledger.reserve(f.call(f.unused)),
    /RECONCILIATION_REQUIRED/,
  );
  f.advance();
  assert.deepEqual(f.reopen().wallet(f.account), w);
  assert.deepEqual(
    f.registry.db.prepare("SELECT * FROM ai_usage ORDER BY job_id").all(),
    before,
  );
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_prices").get().n,
    1,
  );
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_calls").get().n,
    0,
  );
  assert.equal(f.ledger.audit().valid, true);
});
test("legacy unknown risk protects unrelated accounts site-wide even after Beijing midnight", (t) => {
  const f = fixture(t, { reserve: 25000000 });
  f.intake();
  f.ledger.grantInitial("new-account");
  assert.throws(() => f.ledger.reserve(f.call("new-account")), /SITE_BUDGET/);
  f.advance();
  assert.throws(() => f.ledger.reserve(f.call("new-account")), /SITE_BUDGET/);
});
test("intake is atomic on receipt failure and stale/corrupt input is rejected before any wallet is created", (t) => {
  const f = fixture(t),
    prepare = f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO reading_legacy_intakes"))
      throw Error("INJECTED_RECEIPT");
    return prepare(sql);
  };
  assert.throws(() => f.intake(), /INJECTED_RECEIPT/);
  f.ledger.db.prepare = prepare;
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_wallets").get().n,
    0,
  );
  f.registry.db
    .prepare(
      "UPDATE ai_usage SET state='interrupted' WHERE job_id='old-pending'",
    )
    .run();
  assert.throws(() => f.intake(), /STALE_LEGACY_SOURCE/);
  f.request.expectedSourceHash = f.host.preview(f.registry, "host").sourceHash;
  f.intake();
  f.registry.db
    .prepare("UPDATE ai_usage SET state='done' WHERE job_id='old-pending'")
    .run();
  const next = {
    operationId: "intake-2",
    expectedSourceHash: f.host.preview(f.registry, "host").sourceHash,
  };
  assert.throws(
    () => f.host.intake(f.registry, next, "host"),
    /LEGACY_SOURCE_CONFLICT/,
  );
  assert.equal(f.ledger.legacy.risk(f.account), 2000);
});
test("intake refuses collisions with already granted accounts and rolls back every preceding account", (t) => {
  const f = fixture(t);
  f.ledger.grantInitial(f.accounts.toSorted().at(-1));
  assert.throws(() => f.intake(), /LEGACY_WALLET_COLLISION/);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_legacy_accounts").get()
      .n,
    0,
  );
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_wallets").get().n,
    1,
  );
});
test("only final cumulative account evidence can settle actual spending and grant once; old reservations are never converted to fake usage", (t) => {
  const f = fixture(t);
  f.intake();
  f.proof();
  const seq = f.ledger.sequence(f.account),
    request = {
      operationId: "review-1",
      evidenceHash: sha256("evidence"),
      expectedLedgerSequence: seq,
    };
  const result = f.host.reconcile(f.account, request, "host");
  assert.deepEqual(f.host.reconcile(f.account, request, "host"), result);
  assert.equal(f.ledger.wallet(f.account).spent, 1400);
  assert.equal(f.ledger.wallet(f.account).granted, 20000000);
  assert.equal(f.ledger.wallet(f.account).unknownRisk, 0);
  assert.equal(f.ledger.wallet(f.account).pausedReason, "");
  assert.equal(f.ledger.legacy.risk(), 0);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_calls").get().n,
    0,
  );
  assert.equal(f.ledger.grantInitial(f.account).granted, 20000000);
  assert.throws(() => f.ledger.reserve(f.call()), /STALE_COST_REVIEW/);
  f.ledger.legacy.approve(f.account, "task", 1);
  assert.throws(
    () => f.ledger.reserve({ ...f.call(), generation: 2 }),
    /STALE_COST_REVIEW/,
  );
  f.ledger.reserve(f.call());
  f.ledger.sent("new");
  f.ledger.settle("new", { prompt_tokens: 3, completion_tokens: 4 });
  assert.equal(f.ledger.wallet(f.account).spent, 1407);
  assert.equal(f.ledger.audit().valid, true);
  assert.equal(f.reopen().wallet(f.account).spent, 1407);
  assert.equal(f.ledger.legacy.pending(f.unused), true);
});
test("final evidence failures, unauthorized actors and async verifiers cannot remove unknown or issue a grant", (t) => {
  const f = fixture(t);
  f.intake();
  assert.throws(() => f.host.review(f.account, "user"), /FORBIDDEN/);
  for (const mutate of [
    (p) => (p.final = false),
    (p) => (p.allHistoricalActivityCovered = false),
    (p) => (p.sourceHash = sha256("wrong")),
    (p) => (p.account = f.unused),
    (p) => (p.beijingDays = [{ day: "2026-11-01", micros: 1 }]),
    (p) => (p.beijingDays = [{ day: "2026-02-30", micros: 1400 }]),
    (p) => (p.beijingDays = [{ day: "2026-11-03", micros: 1400 }]),
    (p) =>
      (p.beijingDays = [
        { day: "2026-11-01", micros: 700 },
        { day: "2026-11-01", micros: 700 },
      ]),
  ]) {
    mutate(f.proof());
    assert.throws(() => f.reconcile(), /INVALID_LEGACY_FINAL_PROOF/);
  }
  const savedVerifier = f.host.verify;
  f.host.verify = (ctx) => ({
    ...savedVerifier(ctx),
    evidenceHash: sha256("wrong-evidence"),
  });
  assert.throws(() => f.reconcile(), /INVALID_LEGACY_FINAL_PROOF/);
  f.host.verify = async () => f.proof();
  assert.throws(() => f.reconcile(), /INVALID_LEGACY_FINAL_PROOF/);
  assert.equal(f.ledger.wallet(f.account).granted, 0);
  assert.equal(f.ledger.legacy.risk(), 2000);
});
test("verified actual daily cost protects the Beijing daily budget and is not assigned to the old UTC reservation date", (t) => {
  const f = fixture(t, { siteDailyMicros: 1000 });
  f.intake();
  f.proof(f.account, 1400);
  f.reconcile();
  assert.equal(f.ledger.legacy.site("2026-10-31"), 0);
  assert.equal(f.ledger.legacy.site("2026-11-01"), 1400);
  f.ledger.grantInitial("new-account");
  assert.throws(() => f.ledger.reserve(f.call("new-account")), /SITE_BUDGET/);
  f.advance();
  assert.equal(f.ledger.reserve(f.call("new-account")).state, "reserved");
  assert.equal(f.ledger.audit().valid, true);
});
test("a verified cumulative overspend is retained without a refund and independently pauses the ledger", (t) => {
  const f = fixture(t);
  f.intake();
  f.proof(f.account, 21000000);
  f.reconcile();
  assert.equal(f.ledger.wallet(f.account).spent, 21000000);
  assert.equal(f.ledger.wallet(f.account).available, 0);
  assert.equal(f.ledger.wallet(f.account).pausedReason, "LEDGER_PAUSED");
  assert.equal(f.ledger.audit().valid, true);
});
test("a reused final proof and a stale in-transaction review fail atomically, with immutable old metadata retained", (t) => {
  const f = fixture(t);
  f.intake();
  const original = f.proof();
  f.reconcile();
  const second = f.proof(f.unused, 0, []);
  second.proofIdHash = original.proofIdHash;
  assert.throws(() => f.reconcile(f.unused), /UNIQUE/);
  assert.equal(f.ledger.legacy.pending(f.unused), true);
  f.proof(f.unused, 0, []);
  const verifier = f.host.verify;
  f.host.verify = (context) => {
    const p = verifier(context);
    f.ledger.event("concurrent-review", "review", f.unused, null, 0);
    return p;
  };
  assert.throws(() => f.reconcile(f.unused), /STALE_MAINTENANCE_REVIEW/);
  assert.equal(f.ledger.wallet(f.unused).granted, 0);
  for (const table of [
    "reading_legacy_usage",
    "reading_legacy_accounts",
    "reading_legacy_intakes",
    "reading_legacy_settlements",
  ])
    assert.throws(
      () => f.ledger.db.exec("DELETE FROM " + table),
      /IMMUTABLE_LEGACY_LEDGER/,
    );
});

test("legacy import protections cannot be silently rebuilt after a trigger is lost", (t) => {
  const f = fixture(t);
  f.intake();
  f.ledger.db.exec("DROP TRIGGER reading_legacy_usage_delete");
  assert.throws(() => f.reopen(), /DATABASE_SCHEMA_MISMATCH/);
  assert.equal(f.ledger.wallet(f.account).unknownRisk, 2000);
});

test("a live previous writer cannot omit legacy risk after the ledger-core 4 upgrade", (t) => {
  const f = fixture(t),
    path = join(
      f.registry.db.location().split("accounts.sqlite")[0],
      "previous-writer.sqlite",
    );
  const old = new DatabaseSync(path);
  let upgraded;
  try {
    ensureDatabaseSchema(old, "ledger-core", LEDGER_CORE_SCHEMA.slice(0, 3), {
      compatibleObjects: [
        "CREATE INDEX reading_calls_account_task ON reading_calls(account,task)",
      ],
    });
    old.exec("UPDATE reading_controls SET paused=0 WHERE id=1");
    upgraded = new ReadingLedger(path);
    assert.throws(
      () => old.exec("UPDATE reading_controls SET paused=0 WHERE id=1"),
      /INCOMPATIBLE_SCHEMA_WRITER/,
    );
    assert.equal(upgraded.audit().valid, true);
  } finally {
    upgraded?.close();
    old.close();
  }
});
