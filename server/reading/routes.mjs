import { ReadingTasks } from "./tasks.mjs";
import { createReadingScheduler } from "./scheduler.mjs";
import { SyncError } from "../sync-store.mjs";
import { ReadingCostMaintenance } from "./cost-maintenance.mjs";
import { ReadingCheckpointMaintenance } from "./checkpoint-maintenance.mjs";
import { ReadingTimeMaintenance } from "./time-maintenance.mjs";
import { ReadingMaintenance } from "./maintenance.mjs";

const active = ["queued", "running", "applying"];
const recoverable = ["cancelled", "paused", "interrupted", "error"];
const shutdownMessages = {
  SHUTDOWN: "服务关闭，进度已保留；重新连接后可继续",
  SHUTDOWN_TIMEOUT: "关闭等待已结束，有调用费用待核对；已完成进度保留",
  SHUTDOWN_TIME_UNCERTAIN:
    "关闭时读取尚未结束，需核对活跃时间后继续；已完成进度保留",
  ACTIVE_TIME_RECONCILIATION:
    "任务活跃时间待核对，请联系维护者；已完成进度保留",
  SERVICE_CLOSING: "服务正在关闭，请稍后重试",
  CHECKPOINT_NO_PROGRESS: "累计24次调用未取得新增有效块，需核对后继续",
  CHECKPOINT_RECONCILIATION: "历史任务的累计调用检查点待核对，已完成进度保留",
  SAFETY_RECONCILIATION: "资料进度与安全记录不一致，请联系维护者核对；累计费用与时间保留",
  STALE_COST_REVIEW: "费用核对状态已变化，请刷新后重新发起整理",
  COST_RECONCILIATION_AUDITED: "费用已核对，累计费用与进度保留；缺失结果继续整理可能再次计费",
  UNKNOWN_COST: "调用费用待核对，请联系维护者；已完成进度保留",
  LEDGER_PAUSED: "费用账本待核对，AI已暂停；已完成进度保留",
  CHECKPOINT_AUDITED: "调用检查点已核对，累计调用、费用、时间与进度保留；请主动继续",
  ACTIVE_TIME_AUDITED: "活跃时间已核对并保守补计，累计费用与进度保留；请主动继续",
  EXECUTION_LIMIT_AUDITED: "维护核对已延长本投递时限，累计费用与时间保留；可继续",
  EXECUTION_LIMIT: "该投递累计活跃时间已用尽，请联系维护者核对",
  REUPLOAD_REQUIRED: "原件已清理，请从保留本机副本的设备重传核对后继续",
  READING_TIMEOUT: "单步读取超时，已完成进度保留；可稍后继续",
};
const fail = (status, code) => {
  throw new SyncError(status, code, shutdownMessages[code] || code);
};

// Explicitly injected into an isolated service. No automatic wallet grant,
// migration, provider configuration or production enablement.
export function createReadingRoutes({
  maintenanceAuthorize,
  maintenanceVerifyCost,
  maintenanceVerifyTime,
  maintenanceVerifyCheckpoint,
  ledger,
  reader,
  provider,
  priceId,
  modelVersion,
  authorize,
  enabled = () => true,
  registration = false,
  activeLimitMs = 1800000,
}) {
  if (
    !ledger ||
    typeof reader !== "function" ||
    typeof provider !== "function" ||
    typeof authorize !== "function" ||
    !Number.isInteger(activeLimitMs) ||
    activeLimitMs < 1 ||
    activeLimitMs > 1800000
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
          activeLimitMs,
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
        if (closed) return;
        e.db
          .prepare(
            "UPDATE reading_tasks SET state='paused',reason=? WHERE id=? AND state='queued'",
          )
          .run(
            error.message === "QUEUE_FULL"
              ? "RESOURCE"
              : error.code === "REUPLOAD_REQUIRED"
                ? "REUPLOAD_REQUIRED"
                : "READING_TASK_FAILED",
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
  const view = (e, t, roots) => {
    const info=e.chat.publicInfo(t.id);
    const savedRoot=roots?.get(t.packet)||e.roots.stats(t.id);
    const root={...savedRoot,reason:savedRoot.reason||info.chatSafetyReason||""};
    roots?.set(t.packet, root);
    const wallet=(()=>{try{return ledger.wallet(e.account);}catch{return {available:0,pausedReason:"RECONCILIATION_REQUIRED"};}})();
    const auditedCostAvailable=recoverable.includes(t.state) && ["UNKNOWN_COST","SHUTDOWN_TIMEOUT",""].includes(t.reason) && e.auditedCostAvailable(t.id,root,wallet);
    const auditedTimeAvailable=t.reason === "EXECUTION_LIMIT" && e.auditedTimeAvailable(t.id);
    const checkpointAudited=e.roots.safety.lastCheckpointAudit(root.id) && !t.reason && recoverable.includes(t.state);
    const displayReason=root.reason || (wallet.pausedReason==="LEDGER_PAUSED" ? "LEDGER_PAUSED" : checkpointAudited ? "CHECKPOINT_AUDITED" : auditedTimeAvailable ? "EXECUTION_LIMIT_AUDITED" : auditedCostAvailable ? "COST_RECONCILIATION_AUDITED" : (e.roots.safety.lastTimeAudit(root.id) && !t.reason && recoverable.includes(t.state) ? "ACTIVE_TIME_AUDITED" : t.reason));
    return {
      contractVersion: 1,
      ...info,
      id: t.id,
      packetId: t.packet,
      state: t.state,
      phase: info.kind!=="chat" && e.merge.active(t.id) ? "merging" : "reading",
      completedMergeBatches: e.db.prepare("SELECT COUNT(*) n FROM reading_merge_results WHERE task=?").get(t.id).n,
      generation: t.generation,
      maintenanceOperation: e.maintenanceOperation(t.id),
      inputRevision: t.input_revision,
      calls: t.calls,
      reusedBlocks: e.reuse.count(t.id),
      activeMs: t.active_ms,
      reason: displayReason,
      rootTaskId: root.id,
      rootCalls: root.calls,
      rootActiveMs: root.activeMs,
      rootActiveSeconds: Math.ceil(root.activeMs / 1000),
      rootSpent: root.spent,
      checkpointCalls: root.checkpointCalls,
      nextCheckpointCalls: root.nextCheckpointCalls,
      error:
        shutdownMessages[displayReason] || displayReason ||
        "",
      protocol: 4,
      actions:
        t.state === "purged"
          ? []
          : [
              ...(active.includes(t.state) ? ["stop"] : []),
              ...(recoverable.includes(t.state) &&
              (t.reason !== "EXECUTION_LIMIT" || auditedTimeAvailable) &&
              root.activeMs < e.executionLimit(t.id) &&
              !wallet.pausedReason &&
              ![
                "ACTIVE_TIME_RECONCILIATION",
                "CHECKPOINT_RECONCILIATION",
                "CHECKPOINT_NO_PROGRESS",
                "SAFETY_RECONCILIATION",
              ].includes(root.reason)
                ? ["continue"]
                : []),
              ...(info.kind!=="chat" && ["paused", "interrupted", "error", "conflict"].includes(
                t.state,
              )
                ? ["accept-partial"]
                : []),
              "purge",
            ],
      readingSummary: JSON.parse(t.coverage).map((c) => ({
        attachmentId: c.attachmentId,
        name: c.name,
        state: c.state,
        archivePdfPages:c.archivePdfPages,
        archiveImageTiles:c.archiveImageTiles,
        archivePdfVisualPages:c.archivePdfVisualPages,
        pdfVisual:c.pdfVisualPagination,
        imageTiles:c.imagePagination ? {checked:c.covered?.filter(r=>r.kind==="image").length||0,total:c.imagePagination.totalTiles}:undefined,
        readRanges: c.covered?.length || 0,
        unreadRanges: c.uncovered?.length || 0,
        ...(c.pagination ? {pdfPages:{
          checked:c.pagination.nextPage === null ? c.pagination.totalPages : c.pagination.nextPage - 1,
          total:c.pagination.totalPages,
        }} : {}),
      })),
      completedBlocks: e.db
        .prepare("SELECT COUNT(*) n FROM reading_blocks WHERE task=?")
        .get(t.id).n,
      wallet,
    };
  };
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
          formats: ["txt", "csv", "docx", "xlsx", "pdf", ...(reader.imageWindows===true && provider.imageInput===true ? ["png","jpg","jpeg","gif","webp"] : [])],
          imageTiles:reader.imageWindows===true && provider.imageInput===true,
          itemChat:typeof provider.chat==='function',
          pdfPageVisual:reader.pdfVisualWindows===true && provider.imageInput===true,
          pdfTextOnly: !(reader.pdfVisualWindows===true && provider.imageInput===true),
          registration,
          originalLifecycle: true,
          originalReverification: true,
          submissionManifest: true,
        },
        limits: {
          windowCharacters: 120000,
          checkpointCalls: 24,
          initialMicros: 20000000,
          siteDailyMicros: 50000000,
          taskInflightMicros: 2000000,
          originalBytes: 500 * 1024 * 1024,
          submissionBytes: 20 * 1024 * 1024,
        },
      };
    },
    maintenanceReview(account, id, actor) {
      const e=engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingMaintenance(e,maintenanceAuthorize).preview(id,actor);
    },
    extendExecutionLimit(account, id, request, actor) {
      const e=engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingMaintenance(e,maintenanceAuthorize).extend(id,request,actor);
    },
    checkpointMaintenanceReview(account,id,actor) {
      const e=engines.get(account);
      if(!e)throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCheckpointMaintenance(e,maintenanceAuthorize,maintenanceVerifyCheckpoint).preview(id,actor);
    },
    reconcileRootCheckpoint(account,id,request,actor) {
      const e=engines.get(account);
      if(!e)throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCheckpointMaintenance(e,maintenanceAuthorize,maintenanceVerifyCheckpoint).reconcile(id,request,actor);
    },
    timeMaintenanceReview(account, id, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingTimeMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyTime,
      ).preview(id, actor);
    },
    reconcileRootTime(account, id, request, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingTimeMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyTime,
      ).reconcile(id, request, actor);
    },
    costMaintenanceReview(account,id,actor) {
      const e=engines.get(account);
      if(!e)throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCostMaintenance(e,maintenanceAuthorize,maintenanceVerifyCost).preview(id,actor);
    },
    reconcileCallCost(account,id,request,actor) {
      const e=engines.get(account);
      if(!e)throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCostMaintenance(e,maintenanceAuthorize,maintenanceVerifyCost).reconcile(id,request,actor);
    },
    async handle({
      account,
      device,
      store,
      method,
      url,
      value,
      bytes,
      headers,
    }) {
      authorize(account, device);
      if (closed) fail(503, "MAINTENANCE");
      if (store.originals) {
        const originals = store.originals;
        if (url.pathname === "/api/v4/storage" && method === "GET")
          return originals.list({
            cursor: Number(url.searchParams.get("cursor") || 0),
            ...(url.searchParams.has("packetId")
              ? { packetId: url.searchParams.get("packetId") }
              : {}),
          });
        if (url.pathname === "/api/v4/submissions" && method === "POST")
          return originals.begin(value);
        const verification =
          /^\/api\/v4\/originals\/([\w-]{1,100})\/([\w-]{1,100})\/verify$/.exec(
            url.pathname,
          );
        if (verification && method === "PUT") {
          if (headers?.["content-type"] !== "application/octet-stream")
            fail(415, "BINARY_REQUIRED");
          return originals.verifyForReading(
            verification[1],
            verification[2],
            bytes,
          );
        }
        const upload =
          /^\/api\/v4\/submissions\/([\w-]{1,100})\/files\/([\w-]{1,100})$/.exec(
            url.pathname,
          );
        if (upload && method === "PUT") {
          if (headers?.["content-type"] !== "application/octet-stream")
            fail(415, "BINARY_REQUIRED");
          return originals.put(upload[1], upload[2], bytes);
        }
        const commit = /^\/api\/v4\/submissions\/([\w-]{1,100})\/commit$/.exec(
          url.pathname,
        );
        if (commit && method === "POST")
          return originals.commit(commit[1], value, device);
        const action = /^\/api\/v4\/originals\/(renew|delete)$/.exec(
          url.pathname,
        );
        if (action && method === "POST")
          return originals.action(action[1], value, (packet) => {
            const e = engine(account, store);
            const t = e.db
              .prepare(
                "SELECT * FROM reading_tasks WHERE packet=? AND state IN ('queued','running','applying')",
              )
              .get(packet);
            if (t)
              e.action(
                t.id,
                {
                  operationId:
                    "original_stop_" + value.operationId.slice(0, 70),
                  expectedGeneration: t.generation,
                  expectedRevision: t.input_revision,
                },
                "stop",
                device,
              );
            for (const task of e.db
              .prepare("SELECT id FROM reading_tasks WHERE packet=?")
              .all(packet))
              e.clearMaterial(task.id);
          });
      }
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
        const roots = new Map();
        return {
          contractVersion: 1,
          tasks: e.db
            .prepare(
              "SELECT * FROM reading_tasks ORDER BY rowid DESC LIMIT 100",
            )
            .all()
            .map((t) => view(e, t, roots)),
        };
      }
      if (url.pathname === "/api/v4/tasks" && method === "POST") {
        if (!enabled()) fail(503, "AI_DISABLED");
        if (value.contractVersion !== 1 || !["organize","chat"].includes(value.kind))
          fail(426, "CLIENT_UPGRADE_REQUIRED");
        if (value.epoch !== store.epoch) fail(409, "RESET_REQUIRED");
        try {
          ledger.wallet(account);
        } catch {
          fail(503, "RECONCILIATION_REQUIRED");
        } // Reconcile before queue mutation.
        const prior = e.get(value.id);
        if(!prior && (value.expectedCostOperation ?? null)!==ledger.recoveryOperation(account))fail(409,"STALE_COST_REVIEW");
        if(!prior && ledger.wallet(account).pausedReason)fail(503,ledger.wallet(account).pausedReason);
        if (
          !prior &&
          store.record(value.packetId)?.version !== value.baseVersion
        )
          fail(409, "REVISION_CONFLICT");
        const task = e.enqueue({
          id: value.id,
          packetId: value.packetId,
          deviceId: device,
          expectedCostOperation:value.expectedCostOperation ?? null,
          ...(value.kind==='chat' ? {chat:{itemId:value.itemId,instruction:value.instruction,baseVersion:value.baseVersion,epoch:value.epoch}} : {}),
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
          expectedMaintenanceOperation: value.expectedMaintenanceOperation,
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
    finalizeShutdown() {
      closed = true;
      scheduler.close();
      for (const e of engines.values()) e.finalizeShutdown();
    },
    snapshot: () => scheduler.snapshot(),
  };
}
