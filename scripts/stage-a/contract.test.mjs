import test from "node:test";
import assert from "node:assert/strict";
import {
  transitions,
  transition,
  migrateState,
  locksInput,
  acceptsResponse,
  reusableBlock,
  beijingDay,
  limits,
  restoredProjection,
} from "./contract.mjs";

test("all transitions reference known states; terminal paid results cannot resume", () => {
  for (const [from, next] of Object.entries(transitions))
    for (const to of next) {
      assert.ok(Object.hasOwn(transitions, to));
      assert.equal(transition(from, to), to);
    }
  for (const state of ["done", "partial", "purged"]) {
    assert.throws(
      () => transition(state, "running"),
      /INVALID_TASK_TRANSITION/,
    );
    assert.throws(() => transition(state, "queued"), /INVALID_TASK_TRANSITION/);
  }
  assert.equal(transition("cancelled", "queued"), "queued");
  assert.throws(
    () => transition("constructor", "queued"),
    /INVALID_TASK_TRANSITION/,
  );
  assert.throws(() => migrateState("completed"), /UNKNOWN_LEGACY_STATE/);
  assert.throws(() => migrateState("__proto__"), /UNKNOWN_LEGACY_STATE/);
});

test("migration and recovery release old running locks and never auto-replay paid work", () => {
  assert.equal(migrateState("queued"), "interrupted");
  assert.equal(migrateState("running"), "interrupted");
  assert.equal(migrateState("applying"), "conflict");
  assert.equal(migrateState("done"), "done");
  for (const state of Object.keys(transitions))
    assert.equal(
      locksInput(state),
      ["queued", "running", "applying"].includes(state),
    );
});

test("stop, newer generation, changed input, new task and deletion fence late publication", () => {
  const task = {
    id: "task1",
    state: "running",
    generation: 3,
    inputRevision: "r1",
  };
  const response = { taskId: "task1", generation: 3, inputRevision: "r1" };
  assert.equal(acceptsResponse(task, response), true);
  for (const change of [
    { state: "cancelled" },
    { state: "paused" },
    { state: "done" },
    { generation: 4 },
    { inputRevision: "r2" },
    { id: "task2" },
    { deleted: true },
  ])
    assert.equal(acceptsResponse({ ...task, ...change }, response), false);
  assert.equal(
    acceptsResponse({ id: "task1", state: "running" }, { taskId: "task1" }),
    false,
  );
  assert.equal(
    acceptsResponse(
      { state: "running", generation: 1, inputRevision: "r" },
      { generation: 1, inputRevision: "r" },
    ),
    false,
  );
});

test("only validated completed paid blocks with verified originals and identical dependencies are reusable", () => {
  const block = {
    state: "completed",
    paid: true,
    validated: true,
    inputHash: "hash",
    rangeHash: "page1",
    readerVersion: "reader1",
    promptVersion: "prompt1",
    schemaVersion: "v1",
    modelVersion: "model1",
    dependenciesHash: "deps1",
  };
  const expected = { ...block, originalsVerified: true };
  assert.equal(reusableBlock(block, expected), true);
  for (const key of [
    "inputHash",
    "rangeHash",
    "readerVersion",
    "promptVersion",
    "schemaVersion",
    "modelVersion",
    "dependenciesHash",
  ])
    assert.equal(
      reusableBlock(block, { ...expected, [key]: "changed" }),
      false,
    );
  assert.equal(
    reusableBlock(block, { ...expected, originalsVerified: false }),
    false,
  );
  assert.equal(reusableBlock({ ...block, state: "running" }, expected), false);
  assert.equal(reusableBlock({ ...block, validated: false }, expected), false);
  assert.equal(reusableBlock({ ...block, paid: false }, expected), false);
});

test("site budget switches at Beijing midnight while personal balance has no day reset", () => {
  assert.equal(
    beijingDay(Date.parse("2026-10-27T15:59:59.999Z")),
    "2026-10-27",
  );
  assert.equal(
    beijingDay(Date.parse("2026-10-27T16:00:00.000Z")),
    "2026-10-28",
  );
  assert.throws(() => beijingDay(NaN), /INVALID_TIME/);
});

test("configuration leaves working room for expanded input and bounded render batch", () => {
  const workingSet =
    limits.expandedBytes +
    limits.renderPixels * 4 * limits.renderBatch +
    limits.submissionBytes;
  assert.ok(workingSet < limits.workerTempBytes);
  assert.ok(
    limits.workerTempBytes * limits.parserConcurrency < limits.globalTempBytes,
  );
  assert.ok(
    limits.imagePixels * 4 + limits.renderPixels * 4 * limits.renderBatch <
      limits.workerMemoryBytes,
  );
  assert.ok(limits.taskActiveMs > limits.modelTimeoutMs);
  assert.ok(limits.taskInflightMicros < limits.personalMicros);
  assert.ok(
    limits.taskInflightMicros * limits.modelConcurrency <
      limits.siteDailyMicros,
  );
});

const snapshot = {
  safetySeq: 2,
  spentMicros: 0,
  records: [{ id: "deleted" }, { id: "kept" }],
  bindings: [{ id: "revoked" }, { id: "active" }],
  originals: [
    { id: "expired", packetId: "kept", cleanupAt: 99 },
    { id: "old", packetId: "deleted", cleanupAt: 500 },
    { id: "valid", packetId: "kept", cleanupAt: 500 },
  ],
};
const ledger = { seq: 10, spentMicros: 9000000 };
const events = [
  { seq: 3, kind: "delete", objectId: "deleted" },
  { seq: 4, kind: "revoke", objectId: "revoked" },
];
const fence = { ledgerSeq: 10, safetySeq: 4 };

test("old data restored with current ledger and safety log cannot revive deletion or refund spending", () => {
  const restored = restoredProjection(snapshot, ledger, events, fence, 100);
  assert.deepEqual(restored.records, [{ id: "kept" }]);
  assert.deepEqual(restored.bindings, [{ id: "active" }]);
  assert.deepEqual(
    restored.originals.map((o) => o.id),
    ["valid"],
  );
  assert.equal(restored.spentMicros, 9000000);
  assert.equal(restored.aiEnabled, false);
});

test("incomplete safety log, old ledger and unsupported replay stay closed", () => {
  assert.throws(
    () =>
      restoredProjection(snapshot, { ...ledger, seq: 9 }, events, fence, 100),
    /RECOVERY_FENCE/,
  );
  assert.throws(
    () => restoredProjection(snapshot, ledger, events.slice(1), fence, 100),
    /SAFETY_LOG_GAP/,
  );
  assert.throws(
    () => restoredProjection(snapshot, ledger, events.slice(0, 1), fence, 100),
    /SAFETY_LOG_GAP/,
  );
  assert.throws(
    () =>
      restoredProjection(
        snapshot,
        ledger,
        [{ ...events[0], kind: "password_reset" }, events[1]],
        fence,
        100,
      ),
    /UNSUPPORTED_SAFETY_EVENT/,
  );
  assert.throws(
    () =>
      restoredProjection(
        snapshot,
        ledger,
        events,
        { ...fence, ledgerSeq: -1 },
        100,
      ),
    /RECOVERY_FENCE/,
  );
});
