import { ReadingTasks } from "./tasks.mjs";
import { createReadingScheduler } from "./scheduler.mjs";
import { SyncError } from "../sync-store.mjs";

const active = ["queued", "running", "applying"];
const recoverable = ["cancelled", "paused", "interrupted", "error"];
const fail = (status, code) => {
  throw new SyncError(status, code, code);
};

// Explicitly injected into an isolated service. No automatic wallet grant,
// migration, provider configuration or production enablement.
export function createReadingRoutes({
  ledger,
  reader,
  provider,
  priceId,
  modelVersion,
  authorize,
  enabled = () => true,
  registration = false,
}) {
  if (
    !ledger ||
    typeof reader !== "function" ||
    typeof provider !== "function" ||
    typeof authorize !== "function"
  )
    throw Error("READING_CONFIGURATION_REQUIRED");
  ledger.price(priceId);
  ledger.audit();
  ledger.recoverSent();
  for (const call of ledger.db
    .prepare("SELECT id FROM reading_calls WHERE state='reserved'")
    .all())
    ledger.releaseUnsent(call.id);
  const scheduler = createReadingScheduler(),
    engines = new Map(),
    inflight = new Map();
  let closed = false;
  function engine(account, store) {
    if (!engines.has(account))
      engines.set(
        account,
        new ReadingTasks({
          store,
          account,
          ledger,
          reader,
          provider,
          priceId,
          modelVersion,
          authorize: (device) => authorize(account, device),
        }),
      );
    return engines.get(account);
  }
  function schedule(e, id) {
    const key = e.account + ":" + id;
    if (closed || inflight.has(key)) return;
    const pending = scheduler
      .submit(e, id)
      .catch((error) => {
        e.db
          .prepare(
            "UPDATE reading_tasks SET state='paused',reason=? WHERE id=? AND state='queued'",
          )
          .run(
            error.message === "QUEUE_FULL" ? "RESOURCE" : "READING_TASK_FAILED",
            id,
          );
      })
      .finally(() => {
        inflight.delete(key);
        // A user may continue while an aborted older generation is draining.
        if (!closed && e.get(id)?.state === "queued") schedule(e, id);
      });
    inflight.set(key, pending);
  }
  const view = (e, t) => ({
    contractVersion: 1,
    id: t.id,
    packetId: t.packet,
    state: t.state,
    generation: t.generation,
    inputRevision: t.input_revision,
    calls: t.calls,
    activeMs: t.active_ms,
    reason: t.reason,
    rootTaskId: t.id,
    error: t.reason || "",
    protocol: 4,
    actions:
      t.state === "purged"
        ? []
        : [
            ...(active.includes(t.state) ? ["stop"] : []),
            ...(recoverable.includes(t.state) ? ["continue"] : []),
            ...(["paused", "interrupted", "error", "conflict"].includes(t.state)
              ? ["accept-partial"]
              : []),
            "purge",
          ],
    readingSummary: JSON.parse(t.coverage).map((c) => ({
      attachmentId: c.attachmentId,
      name: c.name,
      state: c.state,
      readRanges: c.covered?.length || 0,
      unreadRanges: c.uncovered?.length || 0,
    })),
    completedBlocks: e.db
      .prepare("SELECT COUNT(*) n FROM reading_blocks WHERE task=?")
      .get(t.id).n,
    wallet: (() => {
      try {
        return ledger.wallet(e.account);
      } catch {
        return { available: 0, pausedReason: "RECONCILIATION_REQUIRED" };
      }
    })(),
  });
  const paged = (record) => {
    const text = JSON.stringify(record);
    return Buffer.byteLength(text) > 400000
      ? {
          id: record.id,
          version: record.version,
          deletedAt: record.deletedAt,
          purged: record.purged,
          paged: { units: text.length },
        }
      : record;
  };
  return {
    attach(account, store) {
      const e = engine(account, store);
      for (const task of e.db
        .prepare("SELECT * FROM reading_tasks WHERE state='queued'")
        .all()) {
        try {
          const wallet = ledger.wallet(account);
          if (!enabled() || wallet.pausedReason)
            throw Error(wallet.pausedReason || "MAINTENANCE");
          schedule(e, task.id);
        } catch (error) {
          e.db
            .prepare(
              "UPDATE reading_tasks SET state='paused',reason=? WHERE id=?",
            )
            .run(
              [
                "UNKNOWN_COST",
                "RECONCILIATION_REQUIRED",
                "MAINTENANCE",
              ].includes(error.message)
                ? error.message
                : "MAINTENANCE",
              task.id,
            );
        }
      }
    },
    capabilities() {
      return {
        contractVersion: 1,
        authRequired: true,
        timezone: "Asia/Shanghai",
        serverTime: new Date().toISOString(),
        features: {
          readingTasks: true,
          readingEnabled: enabled(),
          formats: ["txt", "csv", "docx"],
          registration,
          originalLifecycle: false,
        },
        limits: {
          windowCharacters: 120000,
          checkpointCalls: 24,
          initialMicros: 20000000,
          siteDailyMicros: 50000000,
          taskInflightMicros: 2000000,
        },
      };
    },
    async handle({ account, device, store, method, url, value }) {
      authorize(account, device);
      if (closed) fail(503, "MAINTENANCE");
      if (url.pathname === "/api/v4/changes" && method === "GET") {
        const cursor = url.searchParams.get("cursor") || "0";
        if (!/^\d+$/.test(cursor)) fail(400, "INVALID_CURSOR");
        const result = store.pull({
          cursor: Number(cursor),
          epoch: url.searchParams.get("epoch"),
          limit: 1,
        });
        return { ...result, records: result.records.map(paged) };
      }
      const recordMatch = /^\/api\/v4\/records\/([\w-]{1,120})$/.exec(
        url.pathname,
      );
      if (recordMatch && method === "GET") {
        if (url.searchParams.get("epoch") !== store.epoch)
          fail(409, "RESET_REQUIRED");
        const record = store.record(recordMatch[1]);
        if (
          !record ||
          record.version !== Number(url.searchParams.get("version"))
        )
          fail(409, "REVISION_CONFLICT");
        const offsetText = url.searchParams.get("offset");
        if (!/^\d+$/.test(offsetText || "")) fail(400, "INVALID_CURSOR");
        const offset = Number(offsetText),
          text = JSON.stringify(record);
        if (!Number.isSafeInteger(offset) || offset >= text.length)
          fail(400, "INVALID_CURSOR");
        return {
          contractVersion: 1,
          offset,
          version: record.version,
          total: text.length,
          text: text.slice(offset, offset + 65536),
        };
      }
      if (url.pathname === "/api/v4/wallet" && method === "GET")
        try {
          return {
            contractVersion: 1,
            ...ledger.wallet(account),
            timezone: "Asia/Shanghai",
          };
        } catch {
          fail(503, "RECONCILIATION_REQUIRED");
        }
      const e = engine(account, store);
      if (url.pathname === "/api/v4/tasks" && method === "GET") {
        return {
          contractVersion: 1,
          tasks: e.db
            .prepare(
              "SELECT * FROM reading_tasks ORDER BY rowid DESC LIMIT 100",
            )
            .all()
            .map((t) => view(e, t)),
        };
      }
      if (url.pathname === "/api/v4/tasks" && method === "POST") {
        if (!enabled()) fail(503, "AI_DISABLED");
        if (value.contractVersion !== 1 || value.kind !== "organize")
          fail(426, "CLIENT_UPGRADE_REQUIRED");
        if (value.epoch !== store.epoch) fail(409, "RESET_REQUIRED");
        try {
          ledger.wallet(account);
        } catch {
          fail(503, "RECONCILIATION_REQUIRED");
        } // Reconcile before queue mutation.
        const prior = e.get(value.id);
        if (
          !prior &&
          store.record(value.packetId)?.version !== value.baseVersion
        )
          fail(409, "REVISION_CONFLICT");
        const task = e.enqueue({
          id: value.id,
          packetId: value.packetId,
          deviceId: device,
        });
        if (task.state === "queued") schedule(e, task.id);
        return view(e, task);
      }
      const match =
        /^\/api\/v4\/tasks\/([\w-]{1,90})(?:\/(stop|continue|purge|accept-partial))?$/.exec(
          url.pathname,
        );
      if (!match) fail(404, "NOT_FOUND");
      const task = e.get(match[1]);
      if (!task) fail(404, "TASK_NOT_FOUND");
      if (method === "GET" && !match[2]) return view(e, task);
      if (method !== "POST" || !match[2]) fail(404, "NOT_FOUND");
      if (value.contractVersion !== 1) fail(426, "CLIENT_UPGRADE_REQUIRED");
      if (match[2] === "continue" && !enabled()) fail(503, "AI_DISABLED");
      const response = e.action(
        task.id,
        {
          operationId: value.operationId,
          expectedGeneration: value.expectedGeneration,
          expectedRevision: value.expectedRevision,
        },
        match[2],
        device,
      );
      if (response.state === "queued") schedule(e, response.id);
      return view(e, response);
    },
    async close() {
      closed = true;
      scheduler.close();
      for (const e of engines.values()) e.close();
      await Promise.allSettled([...inflight.values()]);
    },
    snapshot: () => scheduler.snapshot(),
  };
}
