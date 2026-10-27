// Executable design only. Not imported by any running application/service.
export const transitions = Object.freeze({
  queued: [
    "running",
    "paused",
    "cancelled",
    "interrupted",
    "conflict",
    "purged",
  ],
  running: [
    "applying",
    "paused",
    "cancelled",
    "interrupted",
    "error",
    "conflict",
    "purged",
  ],
  applying: [
    "done",
    "partial",
    "conflict",
    "interrupted",
    "cancelled",
    "purged",
  ],
  paused: ["queued", "applying", "cancelled", "conflict", "purged"],
  interrupted: ["queued", "applying", "cancelled", "conflict", "purged"],
  error: ["queued", "applying", "cancelled", "conflict", "purged"],
  conflict: ["applying", "cancelled", "purged"],
  cancelled: ["queued", "purged"],
  done: ["purged"],
  partial: ["purged"],
  purged: [],
});
export const legacyStates = Object.freeze({
  queued: "interrupted",
  running: "interrupted",
  applying: "conflict",
  done: "done",
  error: "error",
  conflict: "conflict",
  interrupted: "interrupted",
});
export function migrateState(state) {
  if (!Object.hasOwn(legacyStates, state)) throw Error("UNKNOWN_LEGACY_STATE");
  return legacyStates[state];
}
export function transition(from, to) {
  if (!Object.hasOwn(transitions, from) || !transitions[from].includes(to))
    throw Error("INVALID_TASK_TRANSITION");
  return to;
}
export function locksInput(state) {
  if (!Object.hasOwn(transitions, state)) throw Error("UNKNOWN_TASK_STATE");
  return ["queued", "running", "applying"].includes(state);
}
export function acceptsResponse(task, response) {
  return (
    ["running", "applying"].includes(task.state) &&
    typeof task.id === "string" &&
    task.id.length > 0 &&
    Number.isSafeInteger(task.generation) &&
    task.generation > 0 &&
    task.generation === response.generation &&
    typeof task.inputRevision === "string" &&
    task.inputRevision.length > 0 &&
    task.inputRevision === response.inputRevision &&
    task.id === response.taskId &&
    task.deleted !== true
  );
}
export function reusableBlock(block, expected) {
  return (
    block.state === "completed" &&
    block.validated === true &&
    block.paid === true &&
    expected.originalsVerified === true &&
    [
      "inputHash",
      "rangeHash",
      "readerVersion",
      "promptVersion",
      "schemaVersion",
      "modelVersion",
      "dependenciesHash",
    ].every(
      (key) =>
        typeof block[key] === "string" &&
        block[key].length > 0 &&
        block[key] === expected[key],
    )
  );
}
export function beijingDay(utcMs) {
  if (!Number.isSafeInteger(utcMs) || utcMs < 0) throw Error("INVALID_TIME");
  return new Date(utcMs + 8 * 3600000).toISOString().slice(0, 10);
}
export const limits = Object.freeze({
  fileBytes: 10 * 1024 ** 2,
  submissionBytes: 20 * 1024 ** 2,
  files: 20,
  storageBytes: 500 * 1024 ** 2,
  expandedBytes: 64 * 1024 ** 2,
  archiveEntries: 1000,
  compressionRatio: 100,
  nestedArchives: 0,
  imagePixels: 32000000,
  renderPixels: 8000000,
  renderBatch: 2,
  workerMemoryBytes: 512 * 1024 ** 2,
  workerTempBytes: 256 * 1024 ** 2,
  globalTempBytes: 512 * 1024 ** 2,
  workerTasks: 16,
  cpuPercent: 50,
  parserConcurrency: 1,
  modelConcurrency: 3,
  waitingTasks: 20,
  textWindow: 120000,
  parserTimeoutMs: 30000,
  modelTimeoutMs: 240000,
  taskActiveMs: 1800000,
  retries: 2,
  checkpointCalls: 24,
  personalMicros: 20000000,
  siteDailyMicros: 50000000,
  taskInflightMicros: 2000000,
  validationBatchMicros: 10000000,
});

// Restoration guard/filter prototype, not an online recovery tool.
// A trusted fence must come from outside the selected old data snapshot.
export function restoredProjection(snapshot, ledger, events, fence, now) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(snapshot.safetySeq) ||
    snapshot.safetySeq < 0 ||
    !Number.isSafeInteger(ledger.seq) ||
    !Number.isSafeInteger(fence.ledgerSeq) ||
    !Number.isSafeInteger(fence.safetySeq) ||
    ledger.seq < 0 ||
    fence.ledgerSeq < 0 ||
    fence.safetySeq < 0 ||
    ledger.seq < fence.ledgerSeq ||
    snapshot.safetySeq > fence.safetySeq
  )
    throw Error("RECOVERY_FENCE_MISMATCH");
  let seq = snapshot.safetySeq;
  const deleted = new Set(snapshot.deletedIds || []);
  const revoked = new Set(snapshot.revokedIds || []);
  for (const event of events) {
    if (event.seq !== ++seq || seq > fence.safetySeq)
      throw Error("SAFETY_LOG_GAP");
    if (event.kind === "delete" || event.kind === "expire")
      deleted.add(event.objectId);
    else if (event.kind === "revoke") revoked.add(event.objectId);
    else throw Error("UNSUPPORTED_SAFETY_EVENT");
  }
  if (seq !== fence.safetySeq) throw Error("SAFETY_LOG_GAP");
  if (!Number.isSafeInteger(ledger.spentMicros) || ledger.spentMicros < 0)
    throw Error("INVALID_LEDGER");
  return {
    // Account/credential/password replay is explicitly left to E's full implementation.
    records: snapshot.records.filter((r) => !deleted.has(r.id)),
    bindings: snapshot.bindings.filter((b) => !revoked.has(b.id)),
    originals: snapshot.originals.filter(
      (o) =>
        !deleted.has(o.packetId) &&
        !deleted.has(o.id) &&
        Number.isSafeInteger(o.cleanupAt) &&
        o.cleanupAt > now,
    ),
    spentMicros: ledger.spentMicros,
    aiEnabled: false,
  };
}
