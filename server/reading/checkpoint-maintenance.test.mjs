import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { ReadingCheckpointMaintenance } from "./checkpoint-maintenance.mjs";
import { readMaterial, sha256 } from "./material.mjs";

function fixture(t, reason = "CHECKPOINT_NO_PROGRESS") {
  const directory = mkdtempSync(join(tmpdir(), "shixu-checkpoint-audit-"));
  const store = new SyncStore(join(directory, "tenant.sqlite"));
  createAttachmentStore(store);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.grantInitial("a");
  ledger.freezePrice({
    id: "test",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  const device = store.createDevice("synthetic").deviceId;
  store.apply(
    device,
    {
      id: "p",
      opId: "p",
      type: "put",
      baseVersion: 0,
      data: {
        text: "合成资料",
        captureDate: "2026-10-31",
        attachments: [],
        sources: [],
        result: null,
        status: "pending",
      },
    },
    store.epoch,
  );
  let calls = 0;
  const args = {
    store,
    ledger,
    account: "a",
    priceId: "test",
    modelVersion: "synthetic/1",
    reader: readMaterial,
    authorize: () => {},
    provider: async (sources) => {
      calls++;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成",
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
  const tasks = new ReadingTasks(args);
  tasks.enqueue({ id: "t", packetId: "p", deviceId: device });
  const seed = (start, count) => {
    for (let n = start; n < start + count; n++) {
      const id = "seed" + n;
      ledger.reserve({
        callId: id,
        account: "a",
        task: "t",
        block: id,
        generation: 1,
        priceId: "test",
        maxPromptTokens: 10,
        maxOutputTokens: 10,
      });
      ledger.sent(id);
      ledger.settle(id, { prompt_tokens: 10, completion_tokens: 10 });
    }
    store.db
      .prepare(
        "UPDATE reading_tasks SET calls=calls+?,active_ms=37,state='paused' WHERE id='t'",
      )
      .run(count);
  };
  seed(0, 24);
  if (reason === "CHECKPOINT_NO_PROGRESS") tasks.roots.checkpoint("t");
  else tasks.roots.block("t", reason);
  store.db
    .prepare("UPDATE reading_tasks SET reason=? WHERE id='t'")
    .run(reason);
  const authorize = ({ actor, operation }) =>
    actor === "maintainer" && operation === "reconcile-root-checkpoint";
  let mutate = (p) => p;
  const verify = ({ account, evidenceHash, review }) =>
    mutate({
      account,
      evidenceHash,
      rootTaskId: review.rootTaskId,
      generation: review.generation,
      watermark: review.watermark,
      snapshotHash: review.snapshotHash,
      reason: review.reason,
      reference: "synthetic-final-review",
      final: true,
      disposition: "resume-next-checkpoint",
    });
  const audit = new ReadingCheckpointMaintenance(tasks, authorize, verify);
  const request = () => {
    const r = audit.preview("t", "maintainer");
    return {
      operationId: "audit1",
      evidenceHash: sha256("synthetic-checkpoint-review"),
      expectedGeneration: r.generation,
      expectedWatermark: r.watermark,
      expectedLedgerSequence: r.ledgerSequence,
    };
  };
  t.after(() => {
    tasks.close();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    store,
    ledger,
    tasks,
    args,
    audit,
    request,
    seed,
    calls: () => calls,
    mutate: (f) => (mutate = f),
  };
}

for (const reason of ["CHECKPOINT_NO_PROGRESS", "CHECKPOINT_RECONCILIATION"])
  test(`${reason} review retains counters and history, rejects old intents and requires explicit resume`, async (t) => {
    const f = fixture(t, reason),
      old = f.tasks.get("t"),
      request = f.request();
    const history = f.store.db
      .prepare("SELECT * FROM reading_root_checkpoints")
      .all();
    const oldCreation = f.ledger.recoveryOperation("a");
    const receipt = f.audit.reconcile("t", request, "maintainer");
    assert.deepEqual(
      f.audit.reconcile("t", { ...request }, "maintainer"),
      receipt,
    );
    assert.equal(f.calls(), 0);
    assert.equal(f.tasks.get("t").state, "paused");
    const root = f.tasks.roots.stats("t");
    assert.equal(root.reason, "");
    assert.equal(root.calls, 24);
    assert.equal(root.completed, 0);
    assert.equal(root.activeMs, 37);
    assert.equal(root.spent, 480);
    assert.equal(root.checkpointCalls, 24);
    assert.equal(root.nextCheckpointCalls, 48);
    assert.deepEqual(
      f.store.db.prepare("SELECT * FROM reading_root_checkpoints").all(),
      history,
    );
    assert.notEqual(f.ledger.recoveryOperation("a"), oldCreation);
    assert.throws(
      () =>
        f.tasks.enqueue({
          id: "stale",
          packetId: "p",
          deviceId: "d",
          expectedCostOperation: oldCreation,
        }),
      (e) => e.code === "STALE_COST_REVIEW",
    );
    const action = {
      operationId: "continue1",
      expectedGeneration: old.generation,
      expectedRevision: old.input_revision,
    };
    assert.throws(
      () => f.tasks.action("t", action, "continue"),
      (e) => e.code === "STALE_TASK",
    );
    f.tasks.action(
      "t",
      {
        ...action,
        expectedMaintenanceOperation: f.tasks.maintenanceOperation("t"),
      },
      "continue",
    );
    for (let n = 0; n < 4 && f.tasks.get("t").state === "queued"; n++)
      await f.tasks.run("t");
    assert.equal(f.tasks.get("t").state, "done");
    assert.equal(f.calls(), 1);
    assert.equal(f.tasks.roots.stats("t").calls, 25);
    assert.equal(f.ledger.wallet("a").spent, 500);
    assert.throws(
      () => f.ledger.db.exec("DELETE FROM reading_checkpoint_audits"),
      /SAFETY_APPEND_ONLY/,
    );
  });

test("another interval with no progress pauses again at 48 without resetting paid calls", (t) => {
  const f = fixture(t);
  f.audit.reconcile("t", f.request(), "maintainer");
  f.seed(24, 24);
  const root = f.tasks.roots.checkpoint("t");
  assert.equal(root.calls, 48);
  assert.equal(root.reason, "CHECKPOINT_NO_PROGRESS");
  assert.equal(root.spent, 960);
  assert.equal(root.completed, 0);
});

test("checkpoint authority and bound final evidence cannot erase a different safety gate", (t) => {
  const f = fixture(t);
  assert.throws(() => f.audit.preview("t", "client"), /MAINTENANCE_FORBIDDEN/);
  for (const mutation of [
    (p) => ({ ...p, final: false }),
    (p) => ({ ...p, reason: "" }),
    (p) => ({ ...p, snapshotHash: "0".repeat(64) }),
    (p) => Promise.resolve(p),
  ]) {
    f.mutate(mutation);
    assert.throws(
      () => f.audit.reconcile("t", f.request(), "maintainer"),
      /INVALID_CHECKPOINT_EVIDENCE/,
    );
  }
  f.mutate((p) => p);
  f.tasks.roots.block("t", "SAFETY_RECONCILIATION");
  assert.throws(
    () => f.audit.reconcile("t", f.request(), "maintainer"),
    /CHECKPOINT_AUDIT_NOT_APPLICABLE/,
  );
  assert.equal(
    f.ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_checkpoint_audits")
      .get().n,
    0,
  );
});

test("stale evidence and a crash after receipt cannot release the gate until exact projection completes", (t) => {
  const f = fixture(t),
    stale = f.request();
  f.store.db
    .prepare("UPDATE reading_tasks SET generation=generation+1 WHERE id='t'")
    .run();
  assert.throws(
    () => f.audit.reconcile("t", stale, "maintainer"),
    /STALE_MAINTENANCE_REVIEW/,
  );
  const request = f.request(),
    project = f.audit.project.bind(f.audit);
  f.audit.project = () => {
    throw Error("synthetic power loss");
  };
  assert.throws(
    () => f.audit.reconcile("t", request, "maintainer"),
    /synthetic power loss/,
  );
  assert.equal(f.tasks.roots.stats("t").reason, "CHECKPOINT_NO_PROGRESS");
  assert.equal(
    f.ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_checkpoint_finalizations")
      .get().n,
    0,
  );
  f.audit.project = project;
  f.audit.reconcile("t", request, "maintainer");
  assert.equal(f.tasks.roots.stats("t").reason, "");
  assert.equal(f.calls(), 0);
  f.store.db.prepare("UPDATE reading_tasks SET active_ms=0 WHERE id='t'").run();
  assert.equal(f.tasks.roots.stats("t").reason, "SAFETY_RECONCILIATION");
});

test("checkpoint review refuses unknown costs and newly registered executors", (t) => {
  const f = fixture(t);
  const request = f.request();
  f.ledger.reserve({
    callId: "uncertain",
    account: "a",
    task: "t",
    block: "uncertain",
    generation: 1,
    priceId: "test",
    maxPromptTokens: 10,
    maxOutputTokens: 10,
  });
  f.ledger.sent("uncertain");
  f.ledger.unknown("uncertain");
  assert.throws(
    () => f.audit.reconcile("t", request, "maintainer"),
    /STALE_MAINTENANCE_REVIEW/,
  );
  assert.throws(
    () => f.audit.reconcile("t", f.request(), "maintainer"),
    /UNKNOWN_COST/,
  );
  assert.equal(
    f.ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_checkpoint_audits")
      .get().n,
    0,
  );
});

test("checkpoint receipt cannot survive a changed tenant projection or hide an orphan executor", (t) => {
  const f = fixture(t),
    request = f.request(),
    project = f.audit.project.bind(f.audit);
  f.audit.project = () => {
    throw Error("synthetic power loss");
  };
  assert.throws(
    () => f.audit.reconcile("t", request, "maintainer"),
    /synthetic power loss/,
  );
  f.audit.project = project;
  f.store.db
    .prepare("UPDATE reading_tasks SET generation=generation+1 WHERE id='t'")
    .run();
  assert.throws(
    () => f.audit.reconcile("t", request, "maintainer"),
    /STALE_MAINTENANCE_REVIEW/,
  );
  assert.equal(
    f.ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_checkpoint_finalizations")
      .get().n,
    0,
  );
  const step = f.tasks.roots.safety.begin("t", "t", 1);
  f.tasks.roots.safety.abandon(step);
  assert.equal(f.tasks.roots.stats("t").reason, "ACTIVE_TIME_RECONCILIATION");
  assert.throws(
    () =>
      f.audit.reconcile(
        "t",
        { ...f.request(), operationId: "second" },
        "maintainer",
      ),
    /CHECKPOINT_AUDIT_PENDING/,
  );
});

test("historical checkpoint review establishes the current progress baseline without inventing progress", (t) => {
  const f = fixture(t, "CHECKPOINT_RECONCILIATION");
  f.tasks.roots.progress("t", "synthetic-already-completed-block");
  f.audit.reconcile("t", f.request(), "maintainer");
  assert.equal(f.tasks.roots.stats("t").completed, 1);
  f.seed(24, 24);
  assert.equal(f.tasks.roots.checkpoint("t").reason, "CHECKPOINT_NO_PROGRESS");
  assert.equal(f.tasks.roots.stats("t").completed, 1);
});
