import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { ReadingCostMaintenance } from "./cost-maintenance.mjs";
import { archiveWindowSample } from "./archive-fixtures.mjs";
import { readMaterial } from "./material.mjs";

function fixture(t, { disposition = "usage", mutateProof = (p) => p } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-cost-audit-unit-"));
  let store = new SyncStore(join(directory, "tenant.sqlite"));
  createAttachmentStore(store);
  let ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.grantInitial("a");
  ledger.freezePrice({
    id: "test",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic evidence",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  const device = store.createDevice("synthetic").deviceId,
    sample = archiveWindowSample();
  const put = (data) =>
    store.apply(
      device,
      {
        id: "p",
        opId: crypto.randomUUID(),
        type: "put",
        baseVersion: store.record("p")?.version || 0,
        data,
      },
      store.epoch,
    );
  put({
    text: "",
    sources: [],
    attachments: [],
    captureDate: "2026-10-29",
    result: null,
    status: "pending",
  });
  const file = store.files.put("p", "zip", {
    name: sample.name,
    body: sample.body,
    type: sample.type,
    epoch: store.epoch,
  });
  put({ attachments: [file] });
  let calls = 0;
  const accepted = [];
  const args = {
    store,
    ledger,
    account: "a",
    priceId: "test",
    modelVersion: "synthetic/1",
    authorize: (id) => assert.equal(id, device),
    reader: Object.assign((f, o) => readMaterial(f, o), {
      pdfWindows: true,
      archiveWindows: true,
    }),
    provider: async (sources) => {
      if (++calls === 2) throw Error("synthetic lost usage and result");
      accepted.push(...sources.map((s) => s.text));
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成事项",
              summary: "合成",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [
                {
                  sourceId: sources[0].id,
                  quote: sources[0].text.slice(0, 10),
                },
              ],
            },
          ],
        },
      };
    },
  };
  let tasks = new ReadingTasks(args);
  const authorize = ({ actor, operation }) =>
    actor === "maintainer" && operation === "reconcile-call-cost";
  const verify = ({ call, evidenceHash }) =>
    mutateProof({
      account: call.account,
      callId: call.id,
      fingerprint: call.fingerprint,
      priceId: call.price,
      evidenceHash,
      reference: "synthetic-statement-1",
      final: true,
      disposition,
      usage:
        disposition === "usage"
          ? { prompt_tokens: 30, completion_tokens: 10 }
          : null,
    });
  tasks.enqueue({ id: "t", packetId: "p", deviceId: device });
  t.after(() => {
    tasks.close();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get ledger() {
      return ledger;
    },
    device,
    sample,
    accepted,
    args,
    authorize,
    verify,
    calls: () => calls,
    get tasks() {
      return tasks;
    },
    get maintenance() {
      return new ReadingCostMaintenance(tasks, authorize, verify);
    },
    restart() {
      tasks.close();
      ledger.close();
      store.close();
      store = new SyncStore(join(directory, "tenant.sqlite"));
      createAttachmentStore(store);
      ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
      args.store = store;
      args.ledger = ledger;
      tasks = new ReadingTasks(args);
    },
    action(action, operation = tasks.maintenanceOperation("t")) {
      const now = tasks.get("t");
      return tasks.action(
        "t",
        {
          operationId: crypto.randomUUID(),
          expectedGeneration: now.generation,
          expectedRevision: now.input_revision,
          expectedMaintenanceOperation: operation,
        },
        action,
        device,
      );
    },
    async pause() {
      for (let i = 0; i < 10 && tasks.get("t").state === "queued"; i++)
        await tasks.run("t");
      assert.equal(tasks.get("t").reason, "UNKNOWN_COST");
    },
    review() {
      const review = this.maintenance.preview("t", "maintainer");
      return {
        review,
        request: {
          operationId: crypto.randomUUID(),
          expectedGeneration: review.generation,
          expectedWatermark: review.watermark,
          expectedLedgerSequence: review.ledgerSequence,
          callId: review.unknownCalls[0].id,
          evidenceHash: "a".repeat(64),
        },
      };
    },
    async finish() {
      for (let i = 0; i < 40 && tasks.get("t").state === "queued"; i++)
        await tasks.run("t");
      return tasks.get("t");
    },
  };
}

for (const disposition of ["usage", "not-billed"])
  test(`audited ${disposition} preserves archive paid blocks, counters, action fence and exact full text after restart`, async (t) => {
    const f = fixture(t, { disposition });
    await f.pause();
    const before = f.tasks.roots.stats("t"),
      spent = f.ledger.wallet("a").spent;
    const { review, request } = f.review();
    assert.equal(review.unknownCalls.length, 1);
    const receipt = f.maintenance.reconcile("t", request, "maintainer");
    assert.deepEqual(
      f.maintenance.reconcile("t", request, "maintainer"),
      receipt,
    );
    assert.throws(
      () =>
        f.maintenance.reconcile(
          "t",
          { ...request, evidenceHash: "b".repeat(64) },
          "maintainer",
        ),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(f.calls(), 2);
    assert.equal(f.tasks.get("t").state, "paused");
    assert.equal(f.ledger.wallet("a").unknownRisk, 0);
    assert.equal(
      f.ledger.wallet("a").spent,
      spent + (disposition === "usage" ? 40 : 0),
    );
    assert.equal(f.tasks.roots.stats("t").calls, before.calls);
    assert.equal(f.tasks.roots.stats("t").completed, before.completed);
    assert.equal(f.tasks.roots.stats("t").activeMs, before.activeMs);
    assert.throws(
      () => f.action("continue", null),
      (e) => e.code === "STALE_TASK",
    );
    assert.throws(
      () =>
        f.ledger.db
          .prepare("UPDATE reading_cost_audits SET actor='other'")
          .run(),
      /APPEND_ONLY/,
    );
    assert.throws(
      () => f.ledger.db.prepare("DELETE FROM reading_cost_audits").run(),
      /APPEND_ONLY/,
    );
    const operation = f.tasks.maintenanceOperation("t");
    f.restart();
    assert.equal(f.tasks.maintenanceOperation("t"), operation);
    assert.equal(f.tasks.auditedCostAvailable("t"), true);
    f.action("continue");
    assert.equal((await f.finish()).state, "done");
    assert.equal(f.calls(), 7); // Six valid blocks and the single lost attempt.
    assert.equal(f.accepted.join(""), f.sample.expectedText);
    assert.equal(f.tasks.roots.stats("t").calls, 7);
    assert.equal(
      f.ledger.wallet("a").spent,
      120 + (disposition === "usage" ? 40 : 0),
    );
    const c = f.store.record("p").data.readingCoverage[0];
    assert.equal(c.archivePagination.next, null);
    assert.equal(c.archivePdfPages[0].checked, 19);
    assert.ok(!c.uncovered.some((r) => /WINDOW_PENDING/.test(r.code)));
    assert.equal(f.tasks.materials.size, 0);
  });

test("cost audit rejects missing authority, stale review, untrusted or incomplete final billing evidence and foreign calls", async (t) => {
  const f = fixture(t);
  await f.pause();
  const { request } = f.review();
  assert.throws(
    () => new ReadingCostMaintenance(f.tasks, f.authorize),
    /MAINTENANCE_EVIDENCE_AUTHORITY_REQUIRED/,
  );
  assert.throws(
    () => f.maintenance.reconcile("t", request, "user"),
    /MAINTENANCE_FORBIDDEN/,
  );
  for (const field of [
    "expectedGeneration",
    "expectedWatermark",
    "expectedLedgerSequence",
  ])
    assert.throws(
      () =>
        f.maintenance.reconcile(
          "t",
          { ...request, [field]: request[field] + 1 },
          "maintainer",
        ),
      /STALE_MAINTENANCE_REVIEW/,
    );
  assert.throws(
    () =>
      f.maintenance.reconcile(
        "t",
        { ...request, callId: "foreign" },
        "maintainer",
      ),
    /COST_CALL_NOT_OWNED/,
  );
  for (const mutate of [
    (p) => null,
    (p) => ({ ...p, final: false }),
    (p) => ({ ...p, account: "other" }),
    (p) => ({ ...p, priceId: "other" }),
    (p) => ({ ...p, fingerprint: "0".repeat(64) }),
    (p) => ({ ...p, callId: "other" }),
    (p) => ({ ...p, evidenceHash: "0".repeat(64) }),
    (p) => ({ ...p, reference: "" }),
    (p) => ({ ...p, extra: "untrusted" }),
    (p) => ({ ...p, usage: {} }),
    (p) => ({ ...p, disposition: "not-billed" }),
    (p) => Promise.resolve(p),
  ]) {
    const m = new ReadingCostMaintenance(f.tasks, f.authorize, (args) =>
      mutate(f.verify(args)),
    );
    assert.throws(
      () => m.reconcile("t", request, "maintainer"),
      /INVALID_COST_EVIDENCE|INVALID_USAGE/,
    );
  }
  assert.equal(f.ledger.wallet("a").unknownRisk > 0, true);
  assert.equal(f.ledger.lastCostAudit("a"), undefined);
  assert.equal(f.calls(), 2);
});

test("receipt write failure rolls back usage and risk release; proof verification cannot race ledger or generation", async (t) => {
  const f = fixture(t);
  await f.pause();
  const { request } = f.review();
  const before = f.ledger.wallet("a"),
    prepare = f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO reading_cost_audits"))
      throw Error("synthetic disk failure");
    return prepare(sql);
  };
  try {
    assert.throws(
      () => f.maintenance.reconcile("t", request, "maintainer"),
      /synthetic disk failure/,
    );
  } finally {
    f.ledger.db.prepare = prepare;
  }
  assert.deepEqual(f.ledger.wallet("a"), before);
  assert.equal(f.ledger.call(request.callId).state, "unknown");
  assert.equal(f.ledger.lastCostAudit("a"), undefined);
  const raced = new ReadingCostMaintenance(f.tasks, f.authorize, (args) => {
    f.store.db
      .prepare("UPDATE reading_tasks SET generation=generation+1 WHERE id='t'")
      .run();
    return f.verify(args);
  });
  assert.throws(
    () => raced.reconcile("t", request, "maintainer"),
    /STALE_MAINTENANCE_REVIEW/,
  );
  assert.deepEqual(f.ledger.wallet("a"), before);
});

test("cost reconciliation preserves independent time/safety fences and never schedules a task", async (t) => {
  const f = fixture(t);
  await f.pause();
  f.tasks.roots.block("t", "ACTIVE_TIME_RECONCILIATION");
  const { request } = f.review();
  f.maintenance.reconcile("t", request, "maintainer");
  assert.equal(f.tasks.roots.stats("t").reason, "ACTIVE_TIME_RECONCILIATION");
  assert.equal(f.tasks.auditedCostAvailable("t"), false);
  assert.throws(
    () => f.action("continue"),
    (e) => e.code === "ACTIVE_TIME_RECONCILIATION",
  );
  assert.equal(f.calls(), 2);
});

test("a late charged usage overturning a no-billing audit is accounted once and globally fences future spending", async (t) => {
  const f = fixture(t, { disposition: "not-billed" });
  await f.pause();
  const { request } = f.review();
  f.maintenance.reconcile("t", request, "maintainer");
  const usage = { prompt_tokens: 12, completion_tokens: 8 };
  f.ledger.settle(request.callId, usage);
  f.ledger.settle(request.callId, usage);
  assert.equal(f.ledger.wallet("a").spent, 40);
  assert.equal(f.ledger.wallet("a").pausedReason, "LEDGER_PAUSED");
  assert.equal(f.tasks.roots.stats("t").calls, 2);
  assert.throws(
    () => f.action("continue"),
    (e) => e.code === "LEDGER_PAUSED",
  );
  assert.equal(f.ledger.audit("a").valid, true);
  assert.equal(f.calls(), 2);
});

test("usage contradicting a settled billing audit cannot silently alter spending or erase its conflict fence", async (t) => {
  const f = fixture(t);
  await f.pause();
  const { request } = f.review();
  const receipt = f.maintenance.reconcile("t", request, "maintainer");
  assert.throws(
    () =>
      f.ledger.settle(request.callId, {
        prompt_tokens: 31,
        completion_tokens: 10,
      }),
    /USAGE_CONFLICT/,
  );
  assert.equal(f.ledger.wallet("a").spent, 60);
  assert.equal(f.ledger.wallet("a").pausedReason, "LEDGER_PAUSED");
  assert.deepEqual(
    f.maintenance.reconcile("t", request, "maintainer"),
    receipt,
  );
  assert.equal(f.ledger.wallet("a").pausedReason, "LEDGER_PAUSED");
});

test("ledger integrity rejects a sent call released without any immutable nonbilling audit", async (t) => {
  const f = fixture(t);
  await f.pause();
  const { request } = f.review();
  f.ledger.db
    .prepare("UPDATE reading_calls SET state='released' WHERE id=?")
    .run(request.callId);
  assert.throws(() => f.ledger.audit("a"), /LEDGER_RECONCILIATION_REQUIRED/);
});

test("an account cost receipt also fences old continue intents for another historical root", async (t) => {
  const f = fixture(t);
  await f.pause();
  f.store.db
    .prepare(
      `INSERT INTO reading_tasks(id,packet,device,input_revision,base_version,state)
    SELECT 'other','other-packet',device,input_revision,1,'paused' FROM reading_tasks WHERE id='t'`,
    )
    .run();
  f.tasks.roots.attach(f.tasks.get("other"));
  const other = f.tasks.get("other");
  assert.equal(f.tasks.maintenanceOperation("other"), null);
  const { request } = f.review();
  f.maintenance.reconcile("t", request, "maintainer");
  assert.ok(f.tasks.maintenanceOperation("other"));
  assert.throws(
    () =>
      f.tasks.action(
        "other",
        {
          operationId: crypto.randomUUID(),
          expectedGeneration: other.generation,
          expectedRevision: other.input_revision,
          expectedMaintenanceOperation: null,
        },
        "continue",
        f.device,
      ),
    (e) => e.code === "STALE_TASK",
  );
});

test("old queued work and old task-creation intents cannot consume a newly reconciled cost allowance", async (t) => {
  const f = fixture(t);
  await f.pause();
  f.store.db
    .prepare(
      `INSERT INTO reading_tasks(id,packet,device,input_revision,base_version,state)
    SELECT 'other','other-packet',device,input_revision,1,'queued' FROM reading_tasks WHERE id='t'`,
    )
    .run();
  f.tasks.roots.attach(f.tasks.get("other"));
  const { request } = f.review();
  assert.throws(
    () => f.maintenance.reconcile("t", request, "maintainer"),
    /TASK_STILL_DRAINING/,
  );
  f.store.db
    .prepare("UPDATE reading_tasks SET state='purged' WHERE id='other'")
    .run();
  f.maintenance.reconcile("t", request, "maintainer");
  assert.throws(
    () =>
      f.tasks.enqueue({ id: "old-create", packetId: "p", deviceId: f.device }),
    (e) => e.code === "STALE_COST_REVIEW",
  );
  assert.equal(f.calls(), 2);
});
test("cost audit refuses a draining engine and stale ledger sequence; under-reservation stays globally paused", async (t) => {
  const f = fixture(t, {
    mutateProof: (p) => ({
      ...p,
      usage: { prompt_tokens: 150000, completion_tokens: 0 },
    }),
  });
  await f.pause();
  const { request } = f.review();
  f.tasks.controllers.set("t", new AbortController());
  try {
    assert.throws(
      () => f.maintenance.reconcile("t", request, "maintainer"),
      /TASK_STILL_DRAINING/,
    );
  } finally {
    f.tasks.controllers.delete("t");
  }
  const raced = new ReadingCostMaintenance(f.tasks, f.authorize, (args) => {
    f.ledger.event("synthetic-concurrent-event", "test", "a", null, 0);
    return f.verify(args);
  });
  assert.throws(
    () => raced.reconcile("t", request, "maintainer"),
    /STALE_MAINTENANCE_REVIEW/,
  );
  const current = f.review().request;
  f.maintenance.reconcile("t", current, "maintainer");
  assert.equal(f.ledger.wallet("a").spent, 150020);
  assert.equal(f.ledger.wallet("a").pausedReason, "LEDGER_PAUSED");
  assert.throws(
    () => f.action("continue"),
    (e) => e.code === "LEDGER_PAUSED",
  );
});

test("a receipt failure cannot reopen global spending after verified under-reservation", async (t) => {
  const f = fixture(t, {
    mutateProof: (p) => ({
      ...p,
      usage: { prompt_tokens: 150000, completion_tokens: 0 },
    }),
  });
  await f.pause();
  const { request } = f.review(),
    prepare = f.ledger.db.prepare.bind(f.ledger.db);
  f.ledger.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO reading_cost_audits"))
      throw Error("synthetic receipt failure");
    return prepare(sql);
  };
  try {
    assert.throws(
      () => f.maintenance.reconcile("t", request, "maintainer"),
      /synthetic receipt failure/,
    );
  } finally {
    f.ledger.db.prepare = prepare;
  }
  assert.equal(f.ledger.call(request.callId).state, "unknown");
  assert.equal(f.ledger.wallet("a").spent, 20);
  assert.equal(f.ledger.lastCostAudit("a"), undefined);
  assert.equal(
    f.ledger.db.prepare("SELECT paused FROM reading_controls WHERE id=1").get()
      .paused,
    1,
  );
});
