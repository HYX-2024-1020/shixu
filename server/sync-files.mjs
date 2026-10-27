import { createHash } from "node:crypto";
import { SyncError } from "./sync-store.mjs";

const isId = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-]{1,120}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
export const DEFAULT_FILE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxFilesPerPacket: 20,
  maxWorkspaceBytes: 128 * 1024 * 1024,
};
const textExtension =
  /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|c|cpp|h|rs|go|sql|log)$/i;

export function createAttachmentStore(store, limits = {}) {
  limits = { ...DEFAULT_FILE_LIMITS, ...limits };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("附件容量配置必须为正整数");
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS sync_blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,body BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_attachments(packet_id TEXT NOT NULL REFERENCES sync_records(id),id TEXT NOT NULL,hash TEXT NOT NULL REFERENCES sync_blobs(hash),name TEXT NOT NULL,type TEXT NOT NULL,PRIMARY KEY(packet_id,id));
    CREATE INDEX IF NOT EXISTS sync_attachments_hash ON sync_attachments(hash);`);
  const lookup = (packetId, id) =>
    db
      .prepare(
        "SELECT a.*,b.size FROM sync_attachments a JOIN sync_blobs b ON a.hash=b.hash WHERE a.packet_id=? AND a.id=?",
      )
      .get(packetId, id);
  const descriptor = (row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    hash: row.hash,
  });
  function validateReferences(packetId, files) {
    if (files.length > limits.maxFilesPerPacket)
      throw new SyncError(422, "TOO_MANY_FILES", "单次投递的附件数量超过限制");
    const seen = new Set();
    for (const file of files) {
      if (
        !file ||
        typeof file !== "object" ||
        !isId(file.id) ||
        seen.has(file.id) ||
        ["path", "localPath", "tempFilePath", "blob", "bytes"].some(
          (key) => key in file,
        )
      )
        throw new SyncError(
          422,
          "INVALID_ATTACHMENT",
          "附件描述无效，原件必须先上传",
        );
      seen.add(file.id);
      const stored = lookup(packetId, file.id);
      if (
        !stored ||
        ["name", "type", "size", "hash"].some(
          (key) => file[key] !== stored[key],
        )
      )
        throw new SyncError(
          422,
          "ATTACHMENT_MISSING",
          "服务器没有匹配的完整原件，请先上传再同步附件信息",
        );
    }
  }
  function active(packetId) {
    const record = store.record(packetId);
    if (!record || record.purged)
      throw new SyncError(404, "NOT_FOUND", "投递不存在或已永久删除");
    if (record.deletedAt)
      throw new SyncError(409, "DELETED", "请先恢复整次投递");
    return record;
  }
  const api = {
    limits,
    unlinked(packetId) {
      const linked = new Set(
        (store.record(packetId)?.data?.attachments || []).map((f) => f.id),
      );
      return db
        .prepare("SELECT id FROM sync_attachments WHERE packet_id=?")
        .all(packetId)
        .some((f) => !linked.has(f.id));
    },
    validateReferences,
    put(
      packetId,
      id,
      { name, type = "application/octet-stream", body, epoch },
    ) {
      if (epoch !== store.epoch)
        throw new SyncError(
          409,
          "RESET_REQUIRED",
          "服务资料版本已变化，原件仍保留在本机",
        );
      if (
        !isId(packetId) ||
        !isId(id) ||
        id === "input" ||
        id.length > 100 ||
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 200 ||
        /[\x00-\x1f\x7f\\/]/.test(name) ||
        typeof type !== "string" ||
        !/^[\w.+-]+\/[\w.+-]+$/.test(type) ||
        type.length > 160
      )
        throw new SyncError(
          400,
          "INVALID_ATTACHMENT",
          "附件名称、类型或 ID 无效",
        );
      const bytes = Buffer.from(body);
      if (!bytes.length || bytes.length > limits.maxFileBytes)
        throw new SyncError(
          413,
          "FILE_TOO_LARGE",
          "原件为空或超过单文件容量限制",
        );
      const hash = createHash("sha256").update(bytes).digest("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        active(packetId);
        store.validateOriginalMutation?.(packetId);
        const existing = lookup(packetId, id);
        if (existing) {
          if (
            existing.hash !== hash ||
            existing.name !== name ||
            existing.type !== type
          )
            throw new SyncError(
              409,
              "ATTACHMENT_ID_REUSED",
              "同一附件 ID 不能替换成不同原件",
            );
          db.exec("COMMIT");
          return descriptor(existing);
        }
        if (
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM sync_attachments WHERE packet_id=?",
            )
            .get(packetId).n >= limits.maxFilesPerPacket
        )
          throw new SyncError(
            422,
            "TOO_MANY_FILES",
            "单次投递的附件数量超过限制",
          );
        const blob = db
          .prepare("SELECT hash FROM sync_blobs WHERE hash=?")
          .get(hash);
        if (!blob) {
          store.validateBlobStorage?.(bytes.length);
          const used = db
            .prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM sync_blobs")
            .get().bytes;
          if (used + bytes.length > limits.maxWorkspaceBytes)
            throw new SyncError(
              413,
              "FILE_QUOTA",
              "服务端原件空间已满，请保留本机原件",
            );
          db.prepare(
            "INSERT INTO sync_blobs(hash,size,body) VALUES(?,?,?)",
          ).run(hash, bytes.length, bytes);
        }
        db.prepare(
          "INSERT INTO sync_attachments(packet_id,id,hash,name,type) VALUES(?,?,?,?,?)",
        ).run(packetId, id, hash, name, type);
        db.exec("COMMIT");
        return { id, name, type, size: bytes.length, hash };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    get(packetId, id, { linked = true } = {}) {
      if (!isId(packetId) || !isId(id))
        throw new SyncError(400, "INVALID_ATTACHMENT", "附件 ID 无效");
      const record = active(packetId),
        file = lookup(packetId, id);
      if (
        !file ||
        (linked &&
          !(record.data.attachments || []).some(
            (f) => f.id === id && !f.deletedAt,
          ))
      )
        throw new SyncError(404, "NOT_FOUND", "原件不存在或尚未关联到投递");
      const body = Buffer.from(
        db.prepare("SELECT body FROM sync_blobs WHERE hash=?").get(file.hash)
          .body,
      );
      if (
        body.length !== file.size ||
        createHash("sha256").update(body).digest("hex") !== file.hash
      )
        throw new SyncError(
          500,
          "FILE_INTEGRITY",
          "原件校验失败，请保留本机原件并核对备份",
        );
      return { ...descriptor(file), body };
    },
    readText(packetId, id) {
      const file = api.get(packetId, id, { linked: false });
      if (!textExtension.test(file.name))
        return {
          state: "unsupported",
          reason: "此格式已保存原件，服务端暂未读取内容",
        };
      if (file.body.length > 400000)
        return {
          state: "unsupported",
          reason: "文字附件超过读取上限，原件完整保留",
        };
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          file.body,
        );
        if (!text.trim() || text.includes("\u0000") || text.length > 60000)
          return {
            state: "unsupported",
            reason: "不是受支持的 UTF-8 文字或内容超过读取上限，原件完整保留",
          };
        return {
          state: "read",
          source: { id: file.id, name: file.name, text },
        };
      } catch {
        return {
          state: "unsupported",
          reason: "暂不支持该文字编码，原件完整保留",
        };
      }
    },
    // Called inside the same transaction as the permanent record tombstone.
    purge(packetId) {
      db.prepare("DELETE FROM sync_attachments WHERE packet_id=?").run(
        packetId,
      );
      db.exec(
        "DELETE FROM sync_blobs WHERE hash NOT IN (SELECT hash FROM sync_attachments)",
      );
    },
  };
  store.files = api;
  return api;
}
