import test from "node:test";
import assert from "node:assert/strict";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
import { readMaterial } from "./material.mjs";
function fixture(t) {
  let calls = 0;
  const provider = async (sources) => {
    calls++;
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        summary: "合成",
        warnings: [],
        items: [
          {
            kind: "note",
            title: "有来源的合成事项",
            summary: "",
            facts: [],
            nextSteps: [],
            uncertainties: [],
            due: null,
            evidence: [
              { sourceId: sources[0].id, quote: sources[0].text.slice(0, 8) },
            ],
          },
        ],
      },
    };
  };
  const f = mergeFixture(t, {
    provider,
    sourceName: "合成.pdf",
    sourceBytes: pdfBytes(
      Array.from({ length: 19 }, (_, n) => ({
        text: "第" + (n + 1) + "页独有合成资料，尾部核对",
      })),
    ),
    reader: Object.assign((file, o) => readMaterial(file, o), {
      pdfWindows: true,
    }),
  });
  return { ...f, calls: () => calls };
}
test("tenant cursor cannot skip unread PDF windows by forging terminal metadata", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  await f.tasks.run("task");
  const row = f.store.db.prepare("SELECT * FROM reading_windows").get();
  assert.ok(row.next_page > 0);
  const coverage = JSON.parse(row.coverage);
  coverage.pagination.nextPage = null;
  coverage.uncovered = coverage.uncovered.filter(
    (r) => r.code !== "PDF_WINDOW_PENDING",
  );
  f.store.db
    .prepare("UPDATE reading_windows SET next_page=0,coverage=?")
    .run(JSON.stringify(coverage));
  const before = f.calls(),
    task = await finishMerge(f.tasks);
  assert.equal(task.state, "paused");
  assert.equal(task.reason, "WINDOW_STATE_RECONCILIATION");
  assert.equal(f.calls(), before);
  assert.equal(f.store.record("packet").data.result, null);
});
import { ReadingWindowMaintenance } from "./window-maintenance.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { applyReadingMigrations } from "./schema.mjs";
function audit(f, verify) {
  return new ReadingWindowMaintenance(
    f.tasks,
    (p) => p.actor === "maintainer",
    verify ||
      (({ account, evidenceHash, review }) => ({
        account,
        evidenceHash,
        final: true,
        generation: review.generation,
        reference: "synthetic-window-final",
        rootTaskId: review.rootTaskId,
        snapshotHash: review.snapshotHash,
        watermark: review.watermark,
      })),
  );
}
const request = (a) => {
  const p = a.preview("task", "maintainer");
  return {
    operationId: crypto.randomUUID(),
    evidenceHash: "a".repeat(64),
    expectedGeneration: p.generation,
    expectedWatermark: p.watermark,
    expectedLedgerSequence: p.ledgerSequence,
  };
};
async function advanced(f) {
  f.enqueue();
  await f.tasks.run("task");
  await f.tasks.run("task");
  return { ...f.store.db.prepare("SELECT * FROM reading_windows").get() };
}
test("confirmed cursor deletion or rollback latches through purge/new task while counters and payment stay unchanged", async (t) => {
  const f = fixture(t);
  const trusted = await advanced(f);
  f.store.db.prepare("DELETE FROM reading_windows").run();
  await finishMerge(f.tasks);
  assert.equal(f.tasks.get("task").reason, "WINDOW_STATE_RECONCILIATION");
  const before = f.ledger.wallet("synthetic").spent;
  f.action("purge");
  f.enqueue("later");
  assert.equal(
    (await finishMerge(f.tasks, "later")).reason,
    "WINDOW_STATE_RECONCILIATION",
  );
  assert.equal(f.ledger.wallet("synthetic").spent, before);
  assert.equal(f.calls(), 1);
  assert.ok(f.ledger.db.prepare("SELECT 1 FROM reading_window_purges").get());
  assert.ok(trusted.coverage);
});
test("trusted exact metadata restoration and final audit require fresh explicit resume, never refunds or starts work", async (t) => {
  const f = fixture(t);
  const trusted = await advanced(f);
  f.store.db.prepare("UPDATE reading_windows SET next_page=0").run();
  await finishMerge(f.tasks);
  const old = f.tasks.get("task"),
    oldNonce = f.tasks.maintenanceOperation("task"),
    oldCreation = f.ledger.recoveryOperation("synthetic"),
    a = audit(f),
    spent = f.ledger.wallet("synthetic").spent;
  assert.throws(
    () => a.restoreRows("task", [{ ...trusted, next_page: 0 }], "maintainer"),
    /UNTRUSTED_WINDOW_RESTORE/,
  );
  assert.equal(a.restoreRows("task", [trusted], "maintainer").queued, false);
  const req = request(a),
    receipt = a.reconcile("task", req, "maintainer");
  assert.equal(
    a.reconcile("task", { ...req }, "maintainer").operation,
    receipt.operation,
  );
  assert.equal(f.tasks.get("task").state, "paused");
  assert.equal(f.ledger.wallet("synthetic").spent, spent);
  assert.equal(f.calls(), 1);
  assert.notEqual(f.tasks.maintenanceOperation("task"), oldNonce);
  assert.notEqual(f.ledger.recoveryOperation("synthetic"), oldCreation);
  assert.throws(
    () =>
      f.tasks.action(
        "task",
        {
          operationId: "old-window-continue",
          expectedGeneration: old.generation,
          expectedRevision: old.input_revision,
          expectedMaintenanceOperation: oldNonce,
        },
        "continue",
        f.device,
      ),
    (e) => e.code === "STALE_TASK",
  );
  f.action("continue");
  assert.equal(
    (await finishMerge(f.tasks)).state,
    "done",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.calls(), 3);
  assert.equal(f.tasks.roots.stats("task").spent, 60);
});
test("pending cursor receipt replays a failed tenant write without a duplicate charge; committed rollback is different", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.store.db.exec(
    "CREATE TRIGGER synthetic_window_failure BEFORE INSERT ON reading_windows BEGIN SELECT RAISE(ABORT,'synthetic cursor failure');END;",
  );
  await f.tasks.run("task");
  f.store.db.exec("DROP TRIGGER synthetic_window_failure");
  assert.equal(f.tasks.get("task").state, "paused");
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_window_receipts").get()
      .n,
    1,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_windows").get().n,
    0,
  );
  f.action("continue");
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(f.calls(), 3);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_window_commits").get()
      .n,
    3,
  );
});
test("missing independently certified paid block cannot trigger another recognition on a cursor replay", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.store.db.prepare("DELETE FROM reading_blocks").run();
  f.tasks.dropMaterial("task");
  await finishMerge(f.tasks);
  assert.equal(f.calls(), 1);
  assert.equal(f.tasks.get("task").reason, "SAFETY_RECONCILIATION");
  assert.equal(f.store.record("packet").data.result, null);
});
test("window proof and schema history are immutable; changed or future migration schemas roll back", async (t) => {
  const f = fixture(t);
  await advanced(f);
  for (const table of [
    "reading_window_anchors",
    "reading_window_receipts",
    "reading_window_commits",
  ])
    assert.throws(
      () => f.ledger.db.exec("DELETE FROM " + table),
      /IMMUTABLE_WINDOW_PROOF/,
    );
  assert.throws(
    () => f.ledger.db.exec("DELETE FROM reading_schema_versions"),
    /IMMUTABLE_SCHEMA_VERSION/,
  );
  assert.throws(
    () =>
      applyReadingMigrations(f.ledger, "window-safety", [
        { version: 1, sql: "SELECT 1;" },
      ]),
    /READING_SCHEMA_MISMATCH/,
  );
  assert.throws(() =>
    applyReadingMigrations(f.ledger, "failure-fixture", [
      {
        version: 1,
        sql: "CREATE TABLE synthetic_partial(id INTEGER); SELECT * FROM missing_fixture;",
      },
    ]),
  );
  assert.equal(
    f.ledger.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='synthetic_partial'")
      .get(),
    undefined,
  );
});
test("audit receipt and final release recover at both cross-database boundaries without automatic work", async (t) => {
  for (const boundary of ["tenant", "final"]) {
    const f = fixture(t);
    const trusted = await advanced(f);
    f.store.db.prepare("UPDATE reading_windows SET next_page=0").run();
    await finishMerge(f.tasks);
    const a = audit(f);
    a.restoreRows("task", [trusted], "maintainer");
    const req = request(a),
      db = boundary === "tenant" ? f.store.db : f.ledger.db,
      prepare = db.prepare.bind(db);
    let failed = false;
    db.prepare = (sql) => {
      if (
        !failed &&
        sql.startsWith(
          boundary === "tenant"
            ? "UPDATE reading_roots SET reason="
            : "INSERT INTO reading_window_finalizations",
        )
      ) {
        failed = true;
        throw Error("synthetic audit boundary failure");
      }
      return prepare(sql);
    };
    assert.throws(
      () => a.reconcile("task", req, "maintainer"),
      /synthetic audit boundary/,
    );
    db.prepare = prepare;
    assert.equal(
      f.tasks.roots.stats("task").reason,
      "WINDOW_STATE_RECONCILIATION",
    );
    assert.equal(f.calls(), 1);
    assert.equal(f.tasks.get("task").state, "paused");
    assert.ok(a.reconcile("task", req, "maintainer").operation);
    assert.equal(f.tasks.roots.stats("task").reason, "");
    assert.equal(f.calls(), 1);
  }
});
test("untrusted authority, stale/mutating final evidence and pending sent calls cannot release a window fence", async (t) => {
  const f = fixture(t);
  const trusted = await advanced(f);
  f.store.db.prepare("UPDATE reading_windows SET next_page=0").run();
  await finishMerge(f.tasks);
  const a = audit(f);
  assert.throws(
    () => a.restoreRows("task", [trusted], "intruder"),
    /MAINTENANCE_FORBIDDEN/,
  );
  a.restoreRows("task", [trusted], "maintainer");
  const bad = audit(f, ({ account, evidenceHash, review }) => ({
    account,
    evidenceHash,
    final: false,
    generation: review.generation,
    reference: "not-final",
    rootTaskId: review.rootTaskId,
    snapshotHash: review.snapshotHash,
    watermark: review.watermark,
  }));
  assert.throws(
    () => bad.reconcile("task", request(bad), "maintainer"),
    /INVALID_WINDOW_EVIDENCE/,
  );
  const stale = request(a);
  f.store.db.prepare("UPDATE reading_tasks SET generation=generation+1").run();
  assert.throws(
    () => a.reconcile("task", stale, "maintainer"),
    /STALE_MAINTENANCE_REVIEW/,
  );
  f.ledger.reserve({
    callId: "pending-other-root",
    account: "synthetic",
    task: "other-root",
    block: "synthetic-pending",
    generation: 1,
    priceId: "synthetic",
    maxPromptTokens: 10,
    maxOutputTokens: 10,
  });
  f.ledger.sent("pending-other-root");
  assert.throws(
    () => a.reconcile("task", request(a), "maintainer"),
    /UNKNOWN_COST/,
  );
  assert.equal(
    f.tasks.roots.stats("task").reason,
    "WINDOW_STATE_RECONCILIATION",
  );
  assert.equal(f.calls(), 1);
});
test("an explicit purge can be audited without restoring deleted cursor rows or resetting historical consumption", async (t) => {
  const f = fixture(t);
  await advanced(f);
  f.store.db.prepare("DELETE FROM reading_windows").run();
  await finishMerge(f.tasks);
  f.action("purge");
  const a = audit(f);
  assert.ok(a.reconcile("task", request(a), "maintainer"));
  assert.equal(f.tasks.get("task").state, "purged");
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_windows").get().n,
    0,
  );
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.throws(
    () => f.enqueue("fresh"),
    (e) => e.code === "STALE_COST_REVIEW",
  );
  f.tasks.enqueue({
    id: "fresh",
    packetId: "packet",
    deviceId: f.device,
    expectedCostOperation: f.ledger.recoveryOperation("synthetic"),
  });
  assert.equal((await finishMerge(f.tasks, "fresh")).state, "done");
  assert.equal(f.tasks.roots.stats("fresh").id, "task");
  assert.equal(f.tasks.roots.stats("fresh").spent, 80);
  assert.equal(f.calls(), 4);
});
test("plain partial publication cannot trust a forged paid result even without optional image/semantic providers", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop");
  const row = f.store.db.prepare("SELECT * FROM reading_blocks").get(),
    raw = JSON.parse(row.result);
  raw.items[0].facts = ["伪造的额外报告要求"];
  f.store.db
    .prepare("UPDATE reading_blocks SET result=?")
    .run(JSON.stringify(raw));
  f.store.db
    .prepare("UPDATE reading_tasks SET state='paused' WHERE id='task'")
    .run();
  assert.throws(() => f.action("accept-partial"), /SAFETY_RECONCILIATION/);
  assert.equal(f.store.record("packet").data.result, null);
  assert.equal(f.calls(), 1);
});
test("partial acceptance cannot replace the trusted observed coverage with forged task-summary metadata", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop");
  const c = JSON.parse(f.tasks.get("task").coverage);
  c[0].pagination.nextPage = null;
  c[0].uncovered = [];
  f.store.db
    .prepare(
      "UPDATE reading_tasks SET state='paused',coverage=? WHERE id='task'",
    )
    .run(JSON.stringify(c));
  assert.throws(
    () => f.action("accept-partial"),
    /WINDOW_STATE_RECONCILIATION/,
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.store.record("packet").data.result, null);
});
test("failed coverage projection may supersede an uncommitted parser observation without billing the failed attempt", async (t) => {
  const f = fixture(t),
    reader = f.tasks.reader;
  let reads = 0;
  f.tasks.reader = Object.assign(
    async (...args) => {
      const m = await reader(...args);
      if (++reads === 1) {
        m.uncovered.push({
          kind: "file",
          code: "SYNTHETIC_TRANSIENT_OMISSION",
        });
        m.reasons.push("SYNTHETIC_TRANSIENT_OMISSION");
      }
      return m;
    },
    { pdfWindows: true },
  );
  f.enqueue();
  f.store.db.exec(
    "CREATE TRIGGER synthetic_coverage_failure BEFORE UPDATE OF coverage ON reading_tasks BEGIN SELECT RAISE(ABORT,'synthetic coverage projection failure');END;",
  );
  await f.tasks.run("task");
  f.store.db.exec("DROP TRIGGER synthetic_coverage_failure");
  assert.equal(f.calls(), 0);
  assert.equal(f.tasks.get("task").state, "paused");
  f.action("continue");
  assert.equal(
    (await finishMerge(f.tasks)).state,
    "done",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.calls(), 3);
  assert.ok(
    f.ledger.db
      .prepare(
        "SELECT 1 FROM reading_window_views WHERE supersedes IS NOT NULL",
      )
      .get(),
  );
});
test("trusted observed coverage can be restored without changing counters or original availability", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  const trusted = JSON.parse(f.tasks.get("task").coverage);
  f.action("stop");
  f.store.db
    .prepare("UPDATE reading_tasks SET state='paused',coverage='[]'")
    .run();
  assert.throws(
    () => f.action("accept-partial"),
    /WINDOW_STATE_RECONCILIATION/,
  );
  const a = audit(f);
  assert.throws(
    () => a.restoreCoverage("task", [], "maintainer"),
    /UNTRUSTED_WINDOW_RESTORE/,
  );
  a.restoreCoverage("task", trusted, "maintainer");
  a.reconcile("task", request(a), "maintainer");
  assert.equal(f.calls(), 1);
  assert.equal(f.tasks.get("task").state, "paused");
  f.action("continue");
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(f.calls(), 3);
});
test("a removed immutable-proof trigger or an unknown future component version fails startup closed", async (t) => {
  const f = fixture(t);
  await advanced(f);
  f.ledger.db.exec("DROP TRIGGER reading_window_receipts_delete");
  assert.throws(() => new ReadingTasks(f.args), /READING_SCHEMA_MISMATCH/);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  const versions = [
    { version: 1, sql: "CREATE TABLE synthetic_schema_one(id INTEGER);" },
    { version: 2, sql: "CREATE TABLE synthetic_schema_two(id INTEGER);" },
  ];
  applyReadingMigrations(f.ledger, "future-fixture", versions);
  assert.throws(
    () =>
      applyReadingMigrations(f.ledger, "future-fixture", versions.slice(0, 1)),
    /READING_SCHEMA_MISMATCH/,
  );
});

test("a forged first cursor can only reset to an independently anchored empty state", async (t) => {
  const f = fixture(t);
  f.enqueue();
  const file = f.store.record("packet").data.attachments[0];
  f.tasks.windows.safety.registerInputs("task", [file]);
  f.store.db
    .prepare("INSERT INTO reading_windows VALUES(?,?,?,?,?,?)")
    .run("task", file.id, file.hash, 0, 0, "{}");
  await f.tasks.run("task");
  assert.equal(f.tasks.get("task").reason, "WINDOW_STATE_RECONCILIATION");
  assert.equal(f.calls(), 0);
  const a = audit(f);
  assert.throws(
    () => a.resetInitial("task", file.id, "outsider"),
    /MAINTENANCE_FORBIDDEN/,
  );
  a.resetInitial("task", file.id, "maintainer");
  a.reconcile("task", request(a), "maintainer");
  f.action("continue");
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(f.calls(), 3);
  assert.throws(
    () => a.resetInitial("task", file.id, "maintainer"),
    /UNTRUSTED_WINDOW_RESTORE/,
  );
  f.ledger.db.exec("DROP TRIGGER reading_schema_versions_delete");
  assert.throws(() => new ReadingTasks(f.args), /READING_SCHEMA_MISMATCH/);
});
