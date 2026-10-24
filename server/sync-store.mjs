import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const validId = /^[a-zA-Z0-9_-]{1,120}$/;
const isId = (value) =>
  typeof value === "string" &&
  validId.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export class SyncError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
const fail = (code, message, details) => {
  throw new SyncError(409, code, message, details);
};
function assertJSON(value, depth = 0) {
  if (depth > 40) throw new SyncError(400, "INVALID_DATA", "资料层级过深");
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new SyncError(400, "INVALID_DATA", "资料含无效字段");
    assertJSON(value[key], depth + 1);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function validateData(data, id) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new SyncError(400, "INVALID_DATA", "投递资料必须是对象");
  assertJSON(data);
  if (data.id !== undefined && data.id !== id)
    throw new SyncError(400, "INVALID_DATA", "投递 ID 不一致");
  if (
    "text" in data &&
    (typeof data.text !== "string" || data.text.length > 60000)
  )
    throw new SyncError(400, "INVALID_DATA", "投递文字超限或无效");
  for (const field of ["blob", "remote", "remoteDirty", "deletedAt"])
    if (field in data)
      throw new SyncError(
        400,
        "INVALID_DATA",
        "本地状态或删除状态不能作为投递字段上传",
      );
  if (
    "attachments" in data &&
    (!Array.isArray(data.attachments) || data.attachments.length)
  )
    throw new SyncError(
      422,
      "ATTACHMENTS_NOT_READY",
      "此阶段尚未接入附件上传，请保留原件",
    );
  if (
    "itemState" in data &&
    (!data.itemState ||
      typeof data.itemState !== "object" ||
      Array.isArray(data.itemState))
  )
    throw new SyncError(400, "INVALID_DATA", "事项状态无效");
  if (Buffer.byteLength(JSON.stringify(data)) > 800000)
    throw new SyncError(413, "TOO_LARGE", "单次同步资料超过限制");
}
// Partial top-level updates retain fields an older client does not understand.
// Item fields are merged independently so toggling done does not erase AI chat.
function mergeData(before, patch, id) {
  const next = { ...before, ...patch, id };
  if (patch.itemState) {
    next.itemState = { ...before?.itemState };
    for (const [itemId, changes] of Object.entries(patch.itemState)) {
      if (
        !isId(itemId) ||
        !changes ||
        typeof changes !== "object" ||
        Array.isArray(changes)
      )
        throw new SyncError(400, "INVALID_DATA", "事项修改格式无效");
      next.itemState[itemId] = { ...before?.itemState?.[itemId], ...changes };
    }
  }
  validateData(next, id);
  return next;
}

export class SyncStore {
  constructor(path) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_records(
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT,
        deleted_at TEXT, purged INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS sync_records_version ON sync_records(version);
      CREATE TABLE IF NOT EXISTS sync_devices(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
        expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_operations(
        device_id TEXT NOT NULL REFERENCES sync_devices(id), op_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL,
        PRIMARY KEY(device_id, op_id)
      );
    `);
    const schema = this.meta("schema");
    if (schema && schema !== "1") {
      this.db.close();
      throw new Error("同步数据库版本不兼容，请使用匹配版本的服务");
    }
    this.db
      .prepare("INSERT OR IGNORE INTO sync_meta VALUES(?,?)")
      .run("schema", "1");
    this.db
      .prepare("INSERT OR IGNORE INTO sync_meta VALUES(?,?)")
      .run("epoch", randomUUID());
    this.db
      .prepare("INSERT OR IGNORE INTO sync_meta VALUES(?,?)")
      .run("sequence", "0");
    this.epoch = this.meta("epoch");
  }
  meta(key) {
    return this.db.prepare("SELECT value FROM sync_meta WHERE key=?").get(key)
      ?.value;
  }
  get sequence() {
    return Number(this.meta("sequence"));
  }
  close() {
    this.db.close();
  }
  createDevice(name = "个人设备", now = Date.now()) {
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      throw new SyncError(400, "INVALID_DEVICE", "设备名称应为 1 至 80 个字符");
    const id = randomUUID(),
      token = "shixu_" + randomBytes(32).toString("base64url");
    const expiresAt = now + 30 * 86400000;
    this.db
      .prepare(
        "INSERT INTO sync_devices(id,name,token_hash,expires) VALUES(?,?,?,?)",
      )
      .run(id, name.trim(), hash(token), expiresAt);
    return { deviceId: id, token, expiresAt, epoch: this.epoch };
  }
  authenticate(token, now = Date.now()) {
    if (typeof token !== "string" || token.length > 100) return null;
    return (
      this.db
        .prepare(
          "SELECT id,name,expires FROM sync_devices WHERE token_hash=? AND revoked=0 AND expires>?",
        )
        .get(hash(token), now) || null
    );
  }
  revokeDevice(id) {
    this.db.prepare("UPDATE sync_devices SET revoked=1 WHERE id=?").run(id);
  }
  record(id) {
    const row = this.db
      .prepare("SELECT * FROM sync_records WHERE id=?")
      .get(id);
    return row
      ? {
          id: row.id,
          version: row.version,
          data: row.data ? JSON.parse(row.data) : null,
          deletedAt: row.deleted_at,
          purged: !!row.purged,
        }
      : null;
  }
  pull({ cursor = 0, epoch, limit = 100 } = {}) {
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200
    )
      throw new SyncError(400, "INVALID_CURSOR", "同步游标或分页大小无效");
    if (
      (epoch && epoch !== this.epoch) ||
      (!epoch && cursor > 0) ||
      cursor > this.sequence
    )
      fail(
        "RESET_REQUIRED",
        "服务器资料版本已变化，本地未同步资料已保留，请重新配对并核对",
        { epoch: this.epoch },
      );
    const rows = this.db
      .prepare(
        "SELECT id,version FROM sync_records WHERE version>? ORDER BY version LIMIT ?",
      )
      .all(cursor, limit + 1);
    const more = rows.length > limit;
    const selected = rows.slice(0, limit);
    return {
      epoch: this.epoch,
      cursor: more ? selected.at(-1).version : this.sequence,
      more,
      records: selected.map((row) => this.record(row.id)),
    };
  }
  apply(deviceId, operation, epoch) {
    if (epoch !== this.epoch)
      fail("RESET_REQUIRED", "服务器资料版本已变化，请先核对本地资料", {
        epoch: this.epoch,
      });
    if (!operation || typeof operation !== "object" || Array.isArray(operation))
      throw new SyncError(400, "INVALID_OPERATION", "同步操作无效");
    const { opId, id, baseVersion, type, data } = operation;
    if (
      !isId(opId) ||
      !isId(id) ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      !["put", "delete", "restore", "purge"].includes(type)
    )
      throw new SyncError(
        400,
        "INVALID_OPERATION",
        "同步操作 ID、类型或基准版本无效",
      );
    if (type === "put") validateData(data, id);
    else if (data !== undefined)
      throw new SyncError(
        400,
        "INVALID_OPERATION",
        "删除与恢复操作不能修改投递内容",
      );
    const fingerprint = hash(
      JSON.stringify(
        canonical({
          opId,
          id,
          baseVersion,
          type,
          ...(data === undefined ? {} : { data }),
        }),
      ),
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const saved = this.db
        .prepare("SELECT * FROM sync_operations WHERE device_id=? AND op_id=?")
        .get(deviceId, opId);
      if (saved) {
        if (saved.fingerprint !== fingerprint)
          fail("OP_ID_REUSED", "同一操作 ID 不能提交不同内容");
        const response = {
          opId,
          acceptedVersion: saved.version,
          record: this.record(saved.record_id),
          replayed: true,
        };
        this.db.exec("COMMIT");
        return response;
      }
      const current = this.record(id);
      if ((current?.version || 0) !== baseVersion)
        fail("REVISION_CONFLICT", "另一台设备已修改这次投递，本机修改已保留", {
          current,
        });
      if (current?.purged)
        fail("PURGED", "这次投递已永久删除，可以将本机内容另存为新投递", {
          current,
        });
      if (type !== "put" && !current)
        throw new SyncError(404, "NOT_FOUND", "投递不存在");
      if (type === "put" && current?.deletedAt)
        fail("DELETED", "这次投递已删除，请先恢复或另存本机内容", { current });
      if (type === "purge" && !current.deletedAt)
        fail("NOT_DELETED", "请先移入最近删除", { current });
      if (type === "restore" && !current.deletedAt)
        fail("NOT_DELETED", "投递当前不在最近删除中", { current });
      const version = this.sequence + 1;
      const nextData =
        type === "put" ? mergeData(current?.data, data, id) : current.data;
      if (type === "put" && typeof nextData.text !== "string")
        throw new SyncError(400, "INVALID_DATA", "新投递缺少文字");
      const deletedAt =
        type === "delete"
          ? new Date().toISOString()
          : type === "restore" || type === "put"
            ? null
            : current.deletedAt;
      this.db
        .prepare(
          "INSERT INTO sync_records(id,version,data,deleted_at,purged) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data,deleted_at=excluded.deleted_at,purged=excluded.purged",
        )
        .run(
          id,
          version,
          type === "purge" ? null : JSON.stringify(nextData),
          deletedAt,
          type === "purge" ? 1 : 0,
        );
      this.db
        .prepare("UPDATE sync_meta SET value=? WHERE key='sequence'")
        .run(String(version));
      this.db
        .prepare("INSERT INTO sync_operations VALUES(?,?,?,?,?)")
        .run(deviceId, opId, fingerprint, id, version);
      const response = {
        opId,
        acceptedVersion: version,
        record: this.record(id),
        replayed: false,
      };
      this.db.exec("COMMIT");
      return response;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
