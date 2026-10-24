import { createHash } from "node:crypto";
import { SyncError } from "./sync-store.mjs";

const validId = (v) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,120}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
function withFileSources(store, packet) {
  if (store.files?.unlinked(packet.id))
    throw new SyncError(
      409,
      "ATTACHMENTS_PENDING",
      "原件尚未完成关联，请先完成原件同步再整理",
    );
  const attachments = (packet.attachments || []).filter((f) => !f.deletedAt);
  if (!attachments.length) return packet;
  const reading = attachments.map((file) => ({
    file,
    ...store.files.readText(packet.id, file.id),
  }));
  if (reading.some((r) => r.state !== "read"))
    throw new SyncError(
      422,
      "ATTACHMENT_READING_NOT_READY",
      "部分原件尚未支持读取，已完整保存；请先手动记录事项，避免 AI 忽略附件内容",
    );
  const ids = new Set(attachments.map((f) => f.id));
  return {
    ...packet,
    sources: [
      ...(packet.sources || []).filter(
        (s) => !ids.has(s.id) && typeof s.text === "string" && s.text.trim(),
      ),
      ...reading.map((r) => r.source),
    ],
    coverage: reading.map((r) => ({
      attachmentId: r.file.id,
      name: r.file.name,
      state: "read",
      detail: "已从服务端 UTF-8 原件读取",
      sourceIds: [r.source.id],
    })),
  };
}
export function createJobQueue(store, ai) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS sync_jobs(
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES sync_devices(id), record_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL, output TEXT, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`);
  // A provider may already have charged for an interrupted request. Never repeat it automatically.
  db.prepare(
    "UPDATE sync_jobs SET state='interrupted', error='服务重启中断了任务，请核对后手动重试' WHERE state='running'",
  ).run();
  db.prepare(
    "UPDATE sync_jobs SET state='conflict', error='服务重启时结果尚未确认，请核对保留的结果' WHERE state='applying'",
  ).run();
  db.prepare(
    "DELETE FROM sync_jobs WHERE record_id IN (SELECT id FROM sync_records WHERE purged=1)",
  ).run();
  let running = false,
    stopped = false,
    timer = null;
  const controller = new AbortController();
  const publicJob = (row) =>
    row
      ? {
          id: row.id,
          packetId: row.record_id,
          state: row.state,
          error: row.error,
          updatedAt: row.updated_at,
          output: row.output ? JSON.parse(row.output) : null,
        }
      : null;
  const update = (id, state, output = null, error = "") =>
    db
      .prepare(
        "UPDATE sync_jobs SET state=?, output=?, error=?, updated_at=? WHERE id=?",
      )
      .run(
        state,
        output ? JSON.stringify(output) : null,
        error,
        new Date().toISOString(),
        id,
      );
  const get = (id) => db.prepare("SELECT * FROM sync_jobs WHERE id=?").get(id);
  async function drain() {
    if (running || stopped || !ai) return;
    running = true;
    try {
      for (;;) {
        if (stopped) return;
        const job = db
          .prepare(
            "SELECT * FROM sync_jobs WHERE state='queued' ORDER BY updated_at,id LIMIT 1",
          )
          .get();
        if (!job) return;
        const input = JSON.parse(job.request),
          record = store.record(job.record_id);
        const authorized = db
          .prepare("SELECT revoked,expires FROM sync_devices WHERE id=?")
          .get(job.device_id);
        if (
          !authorized ||
          authorized.revoked ||
          authorized.expires <= Date.now()
        ) {
          update(job.id, "error", null, "设备授权已失效，请重新连接");
          continue;
        }
        if (
          !record ||
          record.deletedAt ||
          record.purged ||
          record.version !== input.baseVersion
        ) {
          update(
            job.id,
            "conflict",
            null,
            "投递已变化，未调用模型，请核对后重试",
          );
          continue;
        }
        update(job.id, "running");
        try {
          const packet = withFileSources(store, record.data),
            signal = AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(240000),
            ]);
          const output =
            input.kind === "organize"
              ? await ai.organize(packet, signal)
              : await ai.chat(packet, input.itemId, input.instruction, signal);
          if (stopped) return;
          if (!get(job.id)) continue;
          // Durably retain a paid result before attempting an optimistic record update.
          update(job.id, "applying", output);
          const current = store.record(packet.id);
          if (
            !current ||
            current.purged ||
            current.deletedAt ||
            current.version !== record.version
          ) {
            update(
              job.id,
              "conflict",
              output,
              "模型已返回，但投递已修改；结果另行保留，未覆盖当前内容",
            );
            continue;
          }
          let patch;
          if (input.kind === "organize") {
            const ids = output.result.items.map(
              (_, index) => `${job.id.slice(0, 85)}_item_${index}`,
            );
            patch = {
              result: output.result,
              itemIds: ids,
              status: "ready",
              error: "",
              organizedSourceIds: (packet.sources || []).map((s) => s.id),
              sources: packet.sources,
              ...(packet.coverage ? { coverage: packet.coverage } : {}),
              updatedAt: new Date().toISOString(),
            };
          } else {
            const index = (packet.itemIds || []).indexOf(input.itemId);
            const result = structuredClone(packet.result),
              meta = packet.itemState?.[input.itemId] || {},
              changes = { ...output.patch };
            for (const key of ["title", "summary", "facts", "kind", "due"])
              if (key in changes) {
                result.items[index][key] = changes[key];
                delete changes[key];
              }
            const at = new Date().toISOString(),
              done = new Set(packet.doneIds || []);
            if (changes.status === "done") done.add(index);
            else if (changes.status) done.delete(index);
            patch = {
              result,
              doneIds: [...done],
              updatedAt: at,
              itemState: {
                [input.itemId]: {
                  ...changes,
                  chat: [
                    ...(meta.chat || []),
                    {
                      id: job.id + "_user",
                      role: "user",
                      text: input.instruction,
                      at,
                    },
                    {
                      id: job.id + "_assistant",
                      role: "assistant",
                      text: output.reply,
                      at,
                    },
                  ],
                  history: [
                    ...(meta.history || []),
                    ...Object.keys(output.patch).map((field) => ({
                      at,
                      field,
                      before:
                        JSON.stringify(
                          field in meta
                            ? meta[field]
                            : packet.result.items[index][field],
                        ) || "",
                      after: JSON.stringify(output.patch[field]),
                      source: "AI 对话",
                    })),
                  ],
                },
              },
            };
          }
          store.apply(
            job.device_id,
            {
              opId: `job_${job.id}`.slice(0, 120),
              id: packet.id,
              type: "put",
              baseVersion: record.version,
              data: patch,
            },
            store.epoch,
          );
          update(job.id, "done", null);
        } catch (error) {
          if (stopped) return;
          const existing = get(job.id);
          if (!existing) continue; // A purge can remove the job while its provider rejects.
          update(
            job.id,
            existing.state === "applying" ? "conflict" : "error",
            existing.output ? JSON.parse(existing.output) : null,
            error instanceof SyncError
              ? error.message
              : "模型任务未完成，原文保留；请核对配置后重试",
          );
        }
      }
    } finally {
      running = false;
    }
  }
  const kick = () => {
    if (!stopped && !timer)
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, 0);
  };
  return {
    start: kick,
    stop() {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    },
    redact(packetId) {
      db.prepare("DELETE FROM sync_jobs WHERE record_id=?").run(packetId);
    },
    get(id) {
      if (!validId(id)) throw new SyncError(400, "INVALID_JOB", "任务 ID 无效");
      return publicJob(get(id));
    },
    enqueue(deviceId, input) {
      if (!ai)
        throw new SyncError(
          503,
          "AI_NOT_READY",
          "服务尚未配置 AI，文字和事项仍可保存",
        );
      if (
        !input ||
        !validId(input.id) ||
        input.id.length > 100 ||
        !validId(input.packetId) ||
        !["organize", "chat"].includes(input.kind) ||
        !Number.isSafeInteger(input.baseVersion) ||
        input.baseVersion < 1
      )
        throw new SyncError(400, "INVALID_JOB", "任务参数无效");
      if (
        (input.kind === "organize" && !ai.organize) ||
        (input.kind === "chat" && !ai.chat)
      )
        throw new SyncError(503, "AI_NOT_READY", "服务尚未配置此模型能力");
      if (input.epoch !== store.epoch)
        throw new SyncError(409, "RESET_REQUIRED", "服务资料版本已变化");
      const request = {
        id: input.id,
        packetId: input.packetId,
        kind: input.kind,
        baseVersion: input.baseVersion,
        epoch: input.epoch,
        ...(input.kind === "chat"
          ? { itemId: input.itemId, instruction: input.instruction }
          : {}),
      };
      if (
        request.kind === "chat" &&
        (!validId(request.itemId) ||
          typeof request.instruction !== "string" ||
          !request.instruction.trim() ||
          request.instruction.length > 4000)
      )
        throw new SyncError(
          400,
          "INVALID_JOB",
          "请填写 1 至 4000 字的当前事项指令",
        );
      const fingerprint = createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
        previous = get(request.id);
      if (previous) {
        if (
          previous.fingerprint !== fingerprint ||
          previous.device_id !== deviceId
        )
          throw new SyncError(409, "JOB_ID_REUSED", "任务 ID 已用于其他请求");
        return publicJob(previous);
      }
      const record = store.record(request.packetId);
      if (!record || record.purged || record.deletedAt)
        throw new SyncError(404, "NOT_FOUND", "投递不存在或已删除");
      if (record.version !== request.baseVersion)
        throw new SyncError(
          409,
          "REVISION_CONFLICT",
          "投递已更新，请同步后重试",
        );
      withFileSources(store, record.data); // Reject unsupported originals before scheduling a paid call.
      if (
        request.kind === "organize" &&
        (record.data.result?.items?.length ||
          Object.keys(record.data.itemState || {}).length)
      )
        throw new SyncError(
          409,
          "ALREADY_ORGANIZED",
          "投递已有事项，请通过事项对话或编辑修改，避免覆盖已有管理状态",
        );
      if (request.kind === "chat") {
        const index = (record.data.itemIds || []).indexOf(request.itemId),
          meta = record.data.itemState?.[request.itemId];
        if (
          index < 0 ||
          !record.data.result?.items[index] ||
          meta?.deletedAt ||
          meta?.purgedAt
        )
          throw new SyncError(404, "NOT_FOUND", "事项不存在或已删除");
      }
      if (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM sync_jobs WHERE state IN ('queued','running','applying')",
          )
          .get().n >= 20
      )
        throw new SyncError(429, "QUEUE_FULL", "整理队列已满，请稍后再试");
      if (
        db
          .prepare(
            "SELECT id FROM sync_jobs WHERE record_id=? AND state IN ('queued','running','applying')",
          )
          .get(request.packetId)
      )
        throw new SyncError(409, "JOB_RUNNING", "这次投递已有任务正在处理");
      db.prepare(
        "INSERT INTO sync_jobs(id,device_id,record_id,fingerprint,request,state,updated_at) VALUES(?,?,?,?,?,'queued',?)",
      ).run(
        request.id,
        deviceId,
        request.packetId,
        fingerprint,
        JSON.stringify(request),
        new Date().toISOString(),
      );
      kick();
      return publicJob(get(request.id));
    },
  };
}
