import {
  mergeCards,
  undoCardMerge,
  CardOperationError,
} from "../generated/ai-core.mjs";
import { ReadingWindowMaintenance } from "./window-maintenance.mjs";
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
  MATERIAL_DECIDED: "材料已保留或删除，原任务不再继续；普通卡片与已有费用保留",
  MAINTENANCE: "服务器维护中，进度与费用保留；维护完成后请主动继续",
  SITE_MONTH_BUDGET:
    "全站月预算不足，进度保留；维护者调整预算或下月恢复后请主动继续",
  READING_TASK_FAILED:
    "处理结果未通过核对，资料与累计费用保留；不会自动重试，主动继续可能再次计费",
  NO_READABLE_MATERIAL:
    "本步没有可读内容，未派发新的模型请求；请核对文件与读取覆盖",
  ADMIN_PAUSED: "管理员已暂停后续 AI 派发，进度保留；恢复权限后请主动继续",
  ACCOUNT_DISABLED:
    "账号已停用，任务与费用保留；恢复账号及设备授权后请主动继续",
  RECONCILIATION_REQUIRED: "历史费用待核对，AI暂不可用；记录和同步仍可用",
  ASSOCIATION_CONTEXT_LIMIT:
    "历史关联内容超过当前安全容量，已读取结果保留，可收下部分结果",
  ASSOCIATION_INPUT_CHANGED:
    "历史事项已变化，已付费进度保留；可收下本次结果或清除任务后重新整理",
  WINDOW_STATE_RECONCILIATION:
    "读取进度与独立记录不一致，已暂停；请联系维护者核对",
  WINDOW_STATE_AUDITED: "读取进度已核对，累计调用、费用和时间保留；请主动继续",
  VISUAL_REVIEW_REQUIRED: "图像事项尚待依据核对，已识别进度保留",
  VISUAL_REVIEW_NOT_READY: "图像核对服务尚未就绪，不能直接收下未经核对的结果",
  VISUAL_REVIEW_CONTEXT_LIMIT:
    "图像依据核对内容超过本窗安全范围，进度保留待处理",
  SHUTDOWN: "服务关闭，进度已保留；重新连接后可继续",
  SHUTDOWN_TIMEOUT: "关闭等待已结束，有调用费用待核对；已完成进度保留",
  SHUTDOWN_TIME_UNCERTAIN:
    "关闭时读取尚未结束，需核对活跃时间后继续；已完成进度保留",
  ACTIVE_TIME_RECONCILIATION:
    "任务活跃时间待核对，请联系维护者；已完成进度保留",
  SERVICE_CLOSING: "服务正在关闭，请稍后重试",
  CHECKPOINT_NO_PROGRESS: "累计24次调用未取得新增有效块，需核对后继续",
  CHECKPOINT_RECONCILIATION: "历史任务的累计调用检查点待核对，已完成进度保留",
  SAFETY_RECONCILIATION:
    "资料进度与安全记录不一致，请联系维护者核对；累计费用与时间保留",
  STALE_COST_REVIEW: "费用核对状态已变化，请刷新后重新发起整理",
  COST_RECONCILIATION_AUDITED:
    "费用已核对，累计费用与进度保留；缺失结果继续整理可能再次计费",
  UNKNOWN_COST:
    "这份材料的调用费用暂按预留估算，核对前不会重复发起；可继续整理其他材料",
  LEDGER_PAUSED: "费用账本待核对，AI已暂停；已完成进度保留",
  CHECKPOINT_AUDITED:
    "调用检查点已核对，累计调用、费用、时间与进度保留；请主动继续",
  ACTIVE_TIME_AUDITED:
    "活跃时间已核对并保守补计，累计费用与进度保留；请主动继续",
  EXECUTION_LIMIT_AUDITED:
    "维护核对已延长本投递时限，累计费用与时间保留；可继续",
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
  maintenanceVerifyWindow,
  ledger,
  reader,
  provider,
  priceId,
  modelVersion,
  authorize,
  enabled = () => true,
  registration = false,
  materialNoticeRequired = false,
  activeLimitMs = 1800000,
  executorIdentity,
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
          executorIdentity,
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
    const info = e.chat.publicInfo(t.id);
    const diagnostic = e.diagnostics.latest(t.id);
    const savedRoot = roots?.get(t.packet) || e.roots.stats(t.id);
    const root = {
      ...savedRoot,
      reason: savedRoot.reason || info.chatSafetyReason || "",
    };
    roots?.set(t.packet, root);
    const wallet = (() => {
      try {
        return ledger.wallet(e.account);
      } catch {
        return { available: 0, pausedReason: "RECONCILIATION_REQUIRED" };
      }
    })();
    const taskCostUnresolved = ledger.taskHasUnresolvedCost(e.account, t.id);
    const auditedCostAvailable =
      recoverable.includes(t.state) &&
      ["UNKNOWN_COST", "SHUTDOWN_TIMEOUT", ""].includes(t.reason) &&
      e.auditedCostAvailable(t.id, root, wallet);
    const auditedTimeAvailable =
      t.reason === "EXECUTION_LIMIT" && e.auditedTimeAvailable(t.id);
    const checkpointAudited =
      e.roots.safety.lastCheckpointAudit(root.id) &&
      !t.reason &&
      recoverable.includes(t.state);
    const windowAudited =
      e.windows.safety.lastAudit(root.id) &&
      !t.reason &&
      recoverable.includes(t.state);
    const displayReason =
      root.reason ||
      (wallet.pausedReason === "LEDGER_PAUSED"
        ? "LEDGER_PAUSED"
        : windowAudited
          ? "WINDOW_STATE_AUDITED"
          : checkpointAudited
            ? "CHECKPOINT_AUDITED"
            : auditedTimeAvailable
              ? "EXECUTION_LIMIT_AUDITED"
              : auditedCostAvailable
                ? "COST_RECONCILIATION_AUDITED"
                : e.roots.safety.lastTimeAudit(root.id) &&
                    !t.reason &&
                    recoverable.includes(t.state)
                  ? "ACTIVE_TIME_AUDITED"
                  : t.reason);
    return {
      contractVersion: 1,
      diagnostic,
      ...info,
      id: t.id,
      packetId: t.packet,
      state: t.state,
      phase:
        info.kind !== "chat" &&
        (e.association.active(t.id) ||
          ["ASSOCIATION_INPUT_CHANGED", "ASSOCIATION_CONTEXT_LIMIT"].includes(
            t.reason,
          ))
          ? "associating"
          : info.kind !== "chat" && e.visual.active(t.id)
            ? "verifying"
            : info.kind !== "chat" && e.merge.active(t.id)
              ? "merging"
              : "reading",
      completedVisualBatches: e.db
        .prepare("SELECT COUNT(*) n FROM reading_visual_results WHERE task=?")
        .get(t.id).n,
      completedAssociationBatches: e.db
        .prepare(
          "SELECT COUNT(*) n FROM reading_association_results WHERE task=?",
        )
        .get(t.id).n,
      completedMergeBatches: e.db
        .prepare("SELECT COUNT(*) n FROM reading_merge_results WHERE task=?")
        .get(t.id).n,
      generation: t.generation,
      maintenanceOperation: e.maintenanceOperation(t.id),
      inputRevision: t.input_revision,
      calls: t.calls,
      hasPreview:
        info.kind !== "chat" &&
        t.state !== "purged" &&
        !!e.db
          .prepare("SELECT 1 FROM reading_blocks WHERE task=? LIMIT 1")
          .get(t.id),
      reusedBlocks: e.reuse.count(t.id),
      remainingOf: e.remainders.info(t)?.parent || null,
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
        (shutdownMessages[displayReason] || displayReason || "") +
        (displayReason && diagnostic ? `；报告编号 ${diagnostic.id}` : ""),
      protocol: 4,
      disposition:
        e.store.record(t.packet)?.data?.defaultCardDisposition?.choice || null,
      actions:
        t.state === "purged" ||
        e.store.record(t.packet)?.data?.defaultCardDisposition
          ? []
          : [
              ...(active.includes(t.state) ? ["stop"] : []),
              ...(t.state === "partial" &&
              !e.remainders.child(t.id) &&
              !root.reason &&
              !wallet.pausedReason &&
              !taskCostUnresolved &&
              root.activeMs < e.executionLimit(t.id)
                ? ["remaining"]
                : []),
              ...(recoverable.includes(t.state) &&
              t.reason !== "ASSOCIATION_INPUT_CHANGED" &&
              (t.reason !== "EXECUTION_LIMIT" || auditedTimeAvailable) &&
              root.activeMs < e.executionLimit(t.id) &&
              !wallet.pausedReason &&
              !taskCostUnresolved &&
              ![
                "ACTIVE_TIME_RECONCILIATION",
                "CHECKPOINT_RECONCILIATION",
                "CHECKPOINT_NO_PROGRESS",
                "SAFETY_RECONCILIATION",
                "WINDOW_STATE_RECONCILIATION",
              ].includes(root.reason)
                ? ["continue"]
                : []),
              ...(root.reason !== "WINDOW_STATE_RECONCILIATION" &&
              info.kind !== "chat" &&
              e.visual.publishable(t) &&
              ["paused", "interrupted", "error", "conflict"].includes(t.state)
                ? ["accept-partial"]
                : []),
              "purge",
            ],
      readingSummary: JSON.parse(t.coverage).map((c) => ({
        attachmentId: c.attachmentId,
        name: c.name,
        state: c.state,
        archivePdfPages: c.archivePdfPages,
        archiveImageTiles: c.archiveImageTiles,
        officeImageParts: c.officeImageParts,
        archivePdfVisualPages: c.archivePdfVisualPages,
        pdfVisual: c.pdfVisualPagination,
        imageTiles: c.imagePagination
          ? {
              checked: c.covered?.filter((r) => r.kind === "image").length || 0,
              total: c.imagePagination.totalTiles,
            }
          : undefined,
        readRanges: c.covered?.length || 0,
        unreadRanges: c.uncovered?.length || 0,
        ...(c.pagination
          ? {
              pdfPages: {
                checked:
                  c.pagination.nextPage === null
                    ? c.pagination.totalPages
                    : c.pagination.nextPage - 1,
                total: c.pagination.totalPages,
              },
            }
          : {}),
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
    // Host-only adapter. The public dispatcher below cannot supply this authority
    // or inspect another tenant. Never return the full user view to management.
    adminTasks() {
      if (closed) fail(503, "SERVICE_CLOSING");
      return [...engines.values()].flatMap((e) =>
        e.db
          .prepare(
            "SELECT * FROM reading_tasks WHERE state!='purged' ORDER BY rowid DESC",
          )
          .all()
          .map((t) => {
            const v = view(e, t);
            return {
              id: e.account + "~" + t.id,
              accountId: e.account,
              taskId: t.id,
              status: t.state,
              stage: v.phase,
              stageLabel: v.phase,
              progress: ["done", "partial"].includes(t.state) ? 100 : null,
              errorCode: v.reason || null,
              diagnostic: v.diagnostic,
              costMicro: v.rootSpent,
              calls: v.rootCalls,
              activeSeconds: v.rootActiveSeconds,
              completedBlocks: v.completedBlocks,
              generation: t.generation,
              revision: t.input_revision,
              maintenanceOperation: v.maintenanceOperation,
              limitSeconds: Math.ceil(e.executionLimit(t.id) / 1000),
              limitReview:
                recoverable.includes(t.state) &&
                v.rootActiveMs >= e.executionLimit(t.id) &&
                !e.roots.stats(t.id).reason
                  ? {
                      generation: t.generation,
                      watermark: e.roots.safety.latest(v.rootTaskId).seq,
                    }
                  : null,
              actions: [
                ...(active.includes(t.state) ? ["pause", "stop"] : []),
                ...(v.actions.includes("continue") ? ["retry"] : []),
              ],
              updatedAt: t.updated_at
                ? new Date(t.updated_at).toISOString()
                : null,
            };
          }),
      );
    },
    adminTaskAction(account, id, action, request) {
      if (closed) fail(503, "SERVICE_CLOSING");
      const e = engines.get(account),
        task = e?.get(id);
      if (!task) fail(404, "TASK_NOT_FOUND");
      if (!["pause", "stop", "retry"].includes(action))
        fail(400, "INVALID_ACTION");
      if (action === "retry") {
        if (!enabled()) fail(503, "AI_DISABLED");
        ledger.dispatchGuard?.(account);
        // Keep all normal device, cost, input, time and checkpoint gates.
        authorize(account, task.device);
      }
      const result = e.action(
        id,
        request,
        action === "retry" ? "continue" : action,
        undefined,
        true,
      );
      if (result.state === "queued") schedule(e, result.id);
      return { state: result.state, generation: result.generation };
    },
    attach(account, store, { resume = true } = {}) {
      const e = engine(account, store);
      if (!resume) {
        e.db
          .prepare(
            "UPDATE reading_tasks SET state='paused',reason='ACCOUNT_DISABLED' WHERE state='queued'",
          )
          .run();
        return;
      }
      for (const task of e.db
        .prepare("SELECT * FROM reading_tasks WHERE state='queued'")
        .all()) {
        try {
          const wallet = ledger.wallet(account);
          if (!enabled(account) || wallet.pausedReason)
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
        materialUseNotice: materialNoticeRequired
          ? {
              version: 3,
              text: "连接账号后资料同步至拾序服务器；选择AI整理或事项对话时，相关材料会发送至DeepSeek。云端原件通常保存30天，到期后7天待清理，可下载、续期或删除；临时整理不长期保存原件，清理后继续需补传。云端删除不删除已下载的本机副本。服务器每天一致性备份，最近两份成功备份通常保留7天；最后一份校验有效备份在新备份可用前继续保留，避免清空恢复点；删除不等于立即从已有备份消失，恢复仍须通过费用与安全记录核对。",
            }
          : null,
        features: {
          readingTasks: true,
          remainingTasks: true,
          readingEnabled: enabled(),
          formats: [
            "txt",
            "csv",
            "docx",
            "xlsx",
            "pdf",
            ...(reader.imageWindows === true && provider.imageInput === true
              ? ["png", "apng", "jpg", "jpeg", "gif", "webp"]
              : []),
          ],
          imageTiles:
            reader.imageWindows === true && provider.imageInput === true,
          officeImageAssets:
            reader.officeWindows === true && provider.imageInput === true,
          windowProgressProofs: true,
          solid7z: reader.archiveWindows === true,
          animatedPng:
            reader.imageWindows === true && provider.imageInput === true,
          visualFactReview: typeof provider.reviewVisual === "function",
          historyAssociation: typeof provider.association === "function",
          itemChat: typeof provider.chat === "function",
          attachmentChat: typeof provider.chat === "function",
          accountChatProposals: typeof provider.chat === "function",
          pdfPageVisual:
            reader.pdfVisualWindows === true && provider.imageInput === true,
          pdfTextOnly: !(
            reader.pdfVisualWindows === true && provider.imageInput === true
          ),
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
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingMaintenance(e, maintenanceAuthorize).preview(id, actor);
    },
    extendExecutionLimit(account, id, request, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingMaintenance(e, maintenanceAuthorize).extend(
        id,
        request,
        actor,
      );
    },
    windowMaintenanceReview(account, id, actor) {
      const e = engines.get(account);
      if (!e) throw Error("ACCOUNT_ENGINE_REQUIRED");
      return new ReadingWindowMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyWindow,
      ).preview(id, actor);
    },
    windowMaintenanceRestore(account, id, rows, actor) {
      const e = engines.get(account);
      if (!e) throw Error("ACCOUNT_ENGINE_REQUIRED");
      return new ReadingWindowMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyWindow,
      ).restoreRows(id, rows, actor);
    },
    windowMaintenanceRestoreCoverage(account, id, coverage, actor) {
      const e = engines.get(account);
      if (!e) throw Error("ACCOUNT_ENGINE_REQUIRED");
      return new ReadingWindowMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyWindow,
      ).restoreCoverage(id, coverage, actor);
    },
    windowMaintenanceResetInitial(account, id, attachment, actor) {
      const e = engines.get(account);
      if (!e) throw Error("ACCOUNT_ENGINE_REQUIRED");
      return new ReadingWindowMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyWindow,
      ).resetInitial(id, attachment, actor);
    },
    reconcileWindowState(account, id, request, actor) {
      const e = engines.get(account);
      if (!e) throw Error("ACCOUNT_ENGINE_REQUIRED");
      return new ReadingWindowMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyWindow,
      ).reconcile(id, request, actor);
    },
    checkpointMaintenanceReview(account, id, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCheckpointMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyCheckpoint,
      ).preview(id, actor);
    },
    reconcileRootCheckpoint(account, id, request, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCheckpointMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyCheckpoint,
      ).reconcile(id, request, actor);
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
    costMaintenanceReview(account, id, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCostMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyCost,
      ).preview(id, actor);
    },
    reconcileCallCost(account, id, request, actor) {
      const e = engines.get(account);
      if (!e) throw Error("MAINTENANCE_ACCOUNT_NOT_ATTACHED");
      return new ReadingCostMaintenance(
        e,
        maintenanceAuthorize,
        maintenanceVerifyCost,
      ).reconcile(id, request, actor);
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
      if (
        ["/api/v4/cards/merge", "/api/v4/cards/undo"].includes(url.pathname) &&
        method === "POST"
      ) {
        if (
          value.contractVersion !== 1 ||
          value.epoch !== store.epoch ||
          !/^[\w-]{1,80}$/.test(value.operationId || "") ||
          !Array.isArray(value.targets) ||
          value.targets.length < 1 ||
          value.targets.length > 20 ||
          value.targets.some(
            (t) =>
              !t ||
              typeof t.packetId !== "string" ||
              typeof t.itemId !== "string" ||
              !Number.isSafeInteger(t.baseVersion),
          ) ||
          (url.pathname.endsWith("/merge") &&
            (typeof value.title !== "string" ||
              typeof value.itemId !== "string"))
        )
          fail(422, "INVALID_CARD_OPERATION");
        if (!store.safety) fail(503, "SAFETY_RECONCILIATION");
        return store.safety.transaction(() => {
          const prior = store.db
            .prepare(
              "SELECT fingerprint FROM sync_operations WHERE device_id=? AND op_id=?",
            )
            .get(device, value.operationId + "_receipt");
          const identity = JSON.stringify(value);
          if (prior) {
            const receipt = store.record(value.receiptPacketId)?.data
              ?.cardOperations?.[value.operationId];
            if (!receipt || receipt !== identity)
              fail(409, "IDEMPOTENCY_CONFLICT");
            return { accepted: true };
          }
          const records = store.db
            .prepare(
              "SELECT id FROM sync_records WHERE deleted_at IS NULL AND purged=0",
            )
            .all()
            .map((r) => store.record(r.id));
          for (const target of value.targets) {
            const r = records.find((r) => r.id === target.packetId);
            if (!r || r.version !== target.baseVersion)
              fail(409, "REVISION_CONFLICT");
          }
          const packets = records.map((r) => r.data);
          let changes;
          try {
            changes = url.pathname.endsWith("/merge")
              ? mergeCards(packets, value.targets, value.itemId, value.title)
              : undoCardMerge(
                  packets,
                  value.targets[0],
                  value.preserveEdited === true,
                );
          } catch (error) {
            if (error instanceof CardOperationError)
              throw new SyncError(409, "CARD_OPERATION_CHANGED", error.message);
            throw error;
          }
          // All source membership and main-card changes commit in one tenant
          // safety transaction; no attachments are copied or re-uploaded.
          for (const [i, p] of changes.entries()) {
            const data = { ...p };
            delete data.remote;
            delete data.remoteDirty;
            delete data.deletedAt;
            delete data.syncVersion;
            store.apply(
              device,
              {
                opId: value.operationId + "_" + i,
                id: p.id,
                type: "put",
                baseVersion: store.record(p.id).version,
                data,
              },
              store.epoch,
            );
          }
          const receipt = store.record(value.receiptPacketId);
          if (!receipt || !changes.some((p) => p.id === receipt.id))
            fail(422, "INVALID_CARD_OPERATION");
          store.apply(
            device,
            {
              opId: value.operationId + "_receipt",
              id: receipt.id,
              type: "put",
              baseVersion: receipt.version,
              data: {
                cardOperations: {
                  ...receipt.data.cardOperations,
                  [value.operationId]: identity,
                },
              },
            },
            store.epoch,
          );
          return { accepted: true };
        });
      }
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
        if (
          value.contractVersion !== 1 ||
          !["organize", "chat"].includes(value.kind)
        )
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
          (value.expectedCostOperation ?? null) !==
            ledger.recoveryOperation(account)
        )
          fail(409, "STALE_COST_REVIEW");
        if (!prior && ledger.wallet(account).pausedReason)
          fail(503, ledger.wallet(account).pausedReason);
        if (
          !prior &&
          store.record(value.packetId)?.version !== value.baseVersion
        )
          fail(409, "REVISION_CONFLICT");
        const task = e.enqueue({
          id: value.id,
          packetId: value.packetId,
          deviceId: device,
          expectedCostOperation: value.expectedCostOperation ?? null,
          ...(value.kind === "chat"
            ? {
                chat: {
                  itemId: value.itemId,
                  instruction: value.instruction,
                  scope: value.scope,
                  groupId: value.groupId,
                  targets: value.targets,
                  readAttachments: value.readAttachments,
                  baseVersion: value.baseVersion,
                  epoch: value.epoch,
                },
              }
            : {}),
        });
        if (task.state === "queued") schedule(e, task.id);
        return view(e, task);
      }
      const match =
        /^\/api\/v4\/tasks\/([\w-]{1,90})(?:\/(stop|continue|purge|accept-partial|remaining|preview))?$/.exec(
          url.pathname,
        );
      if (!match) fail(404, "NOT_FOUND");
      const task = e.get(match[1]);
      if (!task) fail(404, "TASK_NOT_FOUND");
      if (method === "GET" && match[2] === "preview") {
        const offset = url.searchParams.get("offset") || "0";
        if (!/^\d+$/.test(offset)) fail(400, "INVALID_PREVIEW_OFFSET");
        return e.preview(task.id, Number(offset));
      }
      if (method === "GET" && !match[2]) return view(e, task);
      if (method !== "POST" || !match[2]) fail(404, "NOT_FOUND");
      if (value.contractVersion !== 1) fail(426, "CLIENT_UPGRADE_REQUIRED");
      if (match[2] === "remaining") {
        if (!enabled()) fail(503, "AI_DISABLED");
        const wallet = ledger.wallet(account),
          root = e.roots.stats(task.id);
        if (wallet.pausedReason) fail(503, wallet.pausedReason);
        if (root.reason) fail(409, root.reason);
        if (root.activeMs >= e.executionLimit(task.id))
          fail(409, "EXECUTION_LIMIT");
        const child = e.enqueue({
          id: value.operationId,
          packetId: task.packet,
          deviceId: device,
          expectedCostOperation: value.expectedCostOperation ?? null,
          remainingOf: task.id,
          remainingReview: {
            expectedGeneration: value.expectedGeneration,
            expectedRevision: value.expectedRevision,
            expectedMaintenanceOperation:
              value.expectedMaintenanceOperation ?? null,
          },
        });
        if (child.state === "queued") schedule(e, child.id);
        return view(e, child);
      }
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
    snapshot: () => ({
      ...scheduler.snapshot(),
      waitingUser: closed
        ? 0
        : [...engines.values()].reduce(
            (n, e) =>
              n +
              e.db
                .prepare(
                  "SELECT COUNT(*) n FROM reading_tasks WHERE state IN ('paused','interrupted','error')",
                )
                .get().n,
            0,
          ),
      failures: closed
        ? []
        : [...engines.values()].flatMap((e) =>
            e.db
              .prepare(
                "SELECT reason,COUNT(*) count FROM reading_tasks WHERE state IN ('paused','error','interrupted') AND updated_at>=? AND reason IN ('READING_TASK_FAILED','NO_READABLE_MATERIAL','READING_TIMEOUT','SHUTDOWN_TIMEOUT') GROUP BY reason",
              )
              .all(ledger.now() - 10 * 60000)
              .map((r) => ({ account: e.account, ...r })),
          ),
    }),
  };
}
