import { createHash } from "node:crypto";
import { SyncError } from "./sync-store.mjs";

const day = 86400000;
const digest = (v) => createHash("sha256").update(v).digest("hex");
const validId = (v) =>
  typeof v === "string" &&
  /^[\w-]{1,100}$/.test(v) &&
  !["input", "__proto__", "constructor", "prototype"].includes(v);
const fail = (status, code, message) => {
  throw new SyncError(status, code, message);
};
const descriptor = (f) => ({
  id: f.id,
  name: f.name,
  type: f.type,
  size: f.size,
  hash: f.hash,
});

// Shared across tenants, separate from logical original quota. Bodies are never
// serialized; process exit discards all uncommitted and temporary originals.
export function originalMemoryPool(limit = 64 * 1024 * 1024) {
  let used = 0;
  return {
    reserve(n) {
      if (used + n > limit)
        fail(503, "ORIGINAL_MEMORY_BUSY", "临时原件空间繁忙，请稍后重试");
      used += n;
    },
    release(n) {
      used -= n;
    },
    get used() {
      return used;
    },
  };
}

export class OriginalStore {
  constructor(
    store,
    {
      quota = 500 * 1024 * 1024,
      now = Date.now,
      pool = originalMemoryPool(),
      stagingMs = 15 * 60000,
    } = {},
  ) {
    Object.assign(this, { store, db: store.db, quota, now, pool, stagingMs });
    this.buffers = new Map();
    const version = this.db
      .prepare("SELECT value FROM sync_meta WHERE key='originals_v4'")
      .get()?.value;
    if (version && version !== "1") throw Error("ORIGINALS_SCHEMA_UNSUPPORTED");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS original_submissions(id TEXT PRIMARY KEY,packet TEXT NOT NULL,fingerprint TEXT NOT NULL,manifest TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,until_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS original_files(packet TEXT NOT NULL,id TEXT NOT NULL,hash TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER,cleanup INTEGER,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(packet,id));
      CREATE TABLE IF NOT EXISTS original_actions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS original_commits(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS original_file_submissions(packet TEXT NOT NULL,id TEXT NOT NULL,submission TEXT NOT NULL,PRIMARY KEY(packet,id));
      CREATE TABLE IF NOT EXISTS original_trash(packet TEXT PRIMARY KEY,cleanup INTEGER NOT NULL);`);
    this.db
      .prepare("INSERT OR IGNORE INTO sync_meta VALUES('originals_v4','1')")
      .run();
    this.db
      .exec(`INSERT OR IGNORE INTO original_files(packet,id,hash,name,type,size,mode,state)
      SELECT a.packet_id,a.id,a.hash,a.name,a.type,b.size,'retained','legacy_pending_notice' FROM sync_attachments a JOIN sync_blobs b ON a.hash=b.hash;`);
    const files = store.files;
    const get = files.get.bind(files),
      validate = files.validateReferences.bind(files),
      purge = files.purge.bind(files);
    files.put = () =>
      fail(426, "CLIENT_UPGRADE_REQUIRED", "请更新客户端，按整次清单上传原件");
    files.unlinked = (packet) =>
      !!this.db
        .prepare(
          "SELECT 1 FROM original_submissions WHERE packet=? AND state='uploading'",
        )
        .get(packet);
    files.validateReferences = (packet, entries) => {
      if (!Array.isArray(entries) || entries.length > 20)
        fail(422, "INVALID_MANIFEST", "附件清单无效");
      const seen = new Set();
      for (const f of entries) {
        if (!f || typeof f !== "object" || !validId(f.id))
          fail(422, "INVALID_MANIFEST", "附件描述无效");
        const row = this.file(packet, f.id);
        if (!row) {
          validate(packet, [f]);
          continue;
        }
        if (
          seen.has(f.id) ||
          Object.keys(f).some((k) =>
            ["path", "localPath", "tempFilePath", "bytes", "blob"].includes(k),
          ) ||
          Object.keys(descriptor(row)).some((k) => row[k] !== f[k])
        )
          fail(422, "ATTACHMENT_MISSING", "原件清单与已校验版本不一致");
        seen.add(f.id);
      }
    };
    files.get = (packet, id, options = {}) => {
      this.sweep();
      this.active(packet);
      const f = this.file(packet, id);
      if (!f) return get(packet, id, options);
      if (
        options.linked !== false &&
        !(store.record(packet).data.attachments || []).some(
          (a) => a.id === id && !a.deletedAt,
        )
      )
        fail(404, "NOT_FOUND", "原件未关联到投递");
      if (
        ["deleted", "cleaned"].includes(f.state) ||
        (f.mode === "retained" && f.cleanup !== null && f.cleanup <= this.now())
      )
        fail(409, "REUPLOAD_REQUIRED", "云端原件已清除，请重新上传核对后继续");
      if (f.mode === "retained") return get(packet, id, options);
      const bytes = this.buffers.get(this.key(packet, id))?.body;
      if (!bytes)
        fail(409, "REUPLOAD_REQUIRED", "临时原件已清理，请重新上传核对后继续");
      this.verify(f, bytes);
      this.buffers.get(this.key(packet, id)).until = this.now() + 30 * 60000;
      return { ...descriptor(f), body: Buffer.from(bytes) };
    };
    files.releaseWindow = (packet) => this.releaseWindow(packet);
    files.purge = (packet) => {
      purge(packet);
      this.releaseWindow(packet);
      this.db
        .prepare(
          "UPDATE original_files SET state='deleted',version=version+1 WHERE packet=? AND state NOT IN ('deleted','cleaned')",
        )
        .run(packet);
      this.db
        .prepare(
          "UPDATE original_submissions SET reserved=0,state='expired' WHERE packet=?",
        )
        .run(packet);
    };
    store.originals = this;
    const previousGuard = store.validateOperation,
      previousAfter = store.afterOperation;
    store.validateOperation = (op, internal) => {
      previousGuard?.(op, internal);
      if (
        op.type === "restore" &&
        this.db
          .prepare("SELECT 1 FROM original_trash WHERE packet=? AND cleanup<=?")
          .get(op.id, this.now())
      )
        fail(409, "TRASH_EXPIRED", "投递回收期7天已结束，无法恢复");
    };
    store.afterOperation = (op, response) => {
      previousAfter?.(op, response);
      if (op.type === "delete")
        this.db
          .prepare("INSERT OR IGNORE INTO original_trash VALUES(?,?)")
          .run(op.id, this.now() + 7 * day);
      if (["restore", "purge"].includes(op.type))
        this.db.prepare("DELETE FROM original_trash WHERE packet=?").run(op.id);
    };
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch {
        /* service owns database lifetime */
      }
    }, 60000);
    this.timer.unref();
  }
  key(packet, id) {
    return packet + ":" + id;
  }
  file(packet, id) {
    return this.db
      .prepare("SELECT * FROM original_files WHERE packet=? AND id=?")
      .get(packet, id);
  }
  active(packet) {
    const r = this.store.record(packet);
    if (!r || r.purged) fail(404, "NOT_FOUND", "投递不存在或已清除");
    if (r.deletedAt) fail(409, "DELETED", "请先恢复投递");
    return r;
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  release(key) {
    const b = this.buffers.get(key);
    if (b) {
      this.pool.release(b.body.length);
      b.body.fill(0);
      this.buffers.delete(key);
    }
  }
  releaseWindow(packet) {
    for (const key of this.buffers.keys())
      if (key.startsWith(packet + ":")) this.release(key);
  }
  verify(f, bytes) {
    if (bytes.length !== f.size || digest(bytes) !== f.hash)
      fail(422, "FILE_INTEGRITY", "原件长度或SHA-256不匹配，请重传");
  }
  manifest(entries) {
    if (!Array.isArray(entries) || entries.length > 20)
      fail(422, "INVALID_MANIFEST", "每次最多20份原件");
    const seen = new Set();
    const files = entries.map((f) => {
      if (
        !f ||
        !validId(f.id) ||
        seen.has(f.id) ||
        typeof f.name !== "string" ||
        !f.name.trim() ||
        f.name.length > 200 ||
        /[\x00-\x1f\x7f\\/]/.test(f.name) ||
        typeof f.type !== "string" ||
        f.type.length > 160 ||
        !/^[\w.+-]+\/[\w.+-]+$/.test(f.type) ||
        !Number.isSafeInteger(f.size) ||
        f.size < 1 ||
        f.size > 10 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(f.hash)
      )
        fail(422, "INVALID_MANIFEST", "原件清单缺少有效名称、字节数或SHA-256");
      seen.add(f.id);
      return descriptor(f);
    });
    if (files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024)
      fail(413, "UPLOAD_LIMIT", "整次原件不能超过20MiB");
    return files;
  }
  begin({
    submissionId,
    packetId,
    manifest,
    storageIntent = "retained",
    epoch,
  }) {
    if (epoch !== this.store.epoch)
      fail(409, "RESET_REQUIRED", "资料版本已变化，请先同步核对");
    if (
      !validId(submissionId) ||
      !validId(packetId) ||
      !["retained", "temporary"].includes(storageIntent)
    )
      fail(422, "INVALID_SUBMISSION", "提交编号或保存模式无效");
    manifest = this.manifest(manifest);
    this.sweep();
    const fingerprint = digest(
      JSON.stringify({ packetId, manifest, storageIntent }),
    );
    return this.transaction(() => {
      this.active(packetId);
      const old = this.db
        .prepare("SELECT * FROM original_submissions WHERE id=?")
        .get(submissionId);
      if (old) {
        if (old.fingerprint !== fingerprint)
          fail(409, "IDEMPOTENCY_CONFLICT", "同一提交编号不能替换清单");
        if (old.state !== "expired") return this.view(old);
      }
      this.store.validateOriginalMutation?.(packetId);
      const known = manifest.map((f) => this.file(packetId, f.id));
      for (let i = 0; i < known.length; i++)
        if (
          known[i] &&
          (Object.keys(manifest[i]).some(
            (k) => known[i][k] !== manifest[i][k],
          ) ||
            ["deleted", "cleaned"].includes(known[i].state))
        )
          fail(
            409,
            "ATTACHMENT_ID_REUSED",
            "已删除或不同的原件不能复用附件编号",
          );
      if (
        this.db
          .prepare(
            "SELECT 1 FROM original_submissions WHERE packet=? AND state='uploading'",
          )
          .get(packetId)
      )
        fail(409, "SUBMISSION_BUSY", "这次投递仍有上传，请先完成或取消");
      const extra = manifest.reduce(
        (n, f, i) => n + (known[i] ? 0 : f.size),
        0,
      );
      const used = this.usage();
      const mode =
        known.length && known.every(Boolean)
          ? known[0].mode
          : storageIntent === "retained" &&
              used.usedBytes + used.reservedBytes + extra <= this.quota
            ? "retained"
            : "temporary";
      if (known.some((f) => f && f.mode !== mode))
        fail(
          409,
          "STORAGE_MODE_CONFLICT",
          "已有原件的保存模式不能隐式改变，请另建投递",
        );
      this.db
        .prepare(
          "INSERT INTO original_submissions VALUES(?,?,?,?,?,'uploading',?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,state='uploading',reserved=excluded.reserved,until_at=excluded.until_at",
        )
        .run(
          submissionId,
          packetId,
          fingerprint,
          JSON.stringify(manifest),
          mode,
          mode === "retained" ? extra : 0,
          this.now() + this.stagingMs,
        );
      return this.view(
        this.db
          .prepare("SELECT * FROM original_submissions WHERE id=?")
          .get(submissionId),
      );
    });
  }
  view(s) {
    return {
      contractVersion: 1,
      submissionId: s.id,
      packetId: s.packet,
      mode: s.mode,
      state: s.state,
      manifestHash: digest(s.manifest),
      manifest: JSON.parse(s.manifest),
      expiresAt: s.until_at,
      warning:
        s.mode === "temporary"
          ? "本次全部原件仅临时整理，不保存云端；停止或退出执行窗口后清理，继续需重传"
          : "云端原件保存30天，到期后7天待清理；提前7天提醒",
    };
  }
  put(id, fileId, body) {
    this.sweep();
    const s = this.db
      .prepare("SELECT * FROM original_submissions WHERE id=?")
      .get(id);
    if (!s || s.state === "expired")
      fail(409, "SUBMISSION_EXPIRED", "上传不存在或已到期，请重新提交清单");
    this.active(s.packet);
    const f = JSON.parse(s.manifest).find((f) => f.id === fileId);
    if (!f) fail(404, "NOT_FOUND", "文件不在本次清单中");
    const bytes = Buffer.from(body);
    this.verify(f, bytes);
    const old = this.file(s.packet, fileId);
    if (old && ["deleted", "cleaned"].includes(old.state))
      fail(409, "ORIGINAL_DELETED", "已清除原件不能通过旧上传恢复");
    if (s.state === "committed" && s.mode === "retained")
      return { file: descriptor(f) };
    // Exact replay may be acknowledged under the input lock; new material cannot.
    const key = this.key(s.packet, fileId);
    if (!this.buffers.has(key)) {
      this.store.validateOriginalMutation?.(s.packet);
      if (
        [...this.buffers.values()].reduce((n, b) => n + b.body.length, 0) +
          bytes.length >
        40 * 1024 * 1024
      )
        fail(503, "ORIGINAL_MEMORY_BUSY", "账号临时原件空间繁忙，请稍后重试");
      this.pool.reserve(bytes.length);
      this.buffers.set(key, {
        body: bytes,
        until: this.now() + this.stagingMs,
      });
    }
    return { file: descriptor(f) };
  }
  commit(id, { manifestHash, operation, epoch }, device) {
    this.sweep();
    const s = this.db
      .prepare("SELECT * FROM original_submissions WHERE id=?")
      .get(id);
    if (!s || s.state === "expired")
      fail(409, "SUBMISSION_EXPIRED", "上传预留已过期，请重新提交");
    if (
      digest(s.manifest) !== manifestHash ||
      !operation ||
      operation.id !== s.packet ||
      operation.type !== "put" ||
      JSON.stringify((operation.data?.attachments || []).map(descriptor)) !==
        s.manifest
    )
      fail(409, "MANIFEST_CONFLICT", "提交内容与整次原件清单不一致");
    const fingerprint = digest(
      JSON.stringify({ manifestHash, operation, epoch, device }),
    );
    const committed = this.db
      .prepare("SELECT fingerprint FROM original_commits WHERE id=?")
      .get(id);
    if (committed && committed.fingerprint !== fingerprint)
      fail(409, "IDEMPOTENCY_CONFLICT", "同一提交不能更换资料修订或操作编号");
    const manifest = JSON.parse(s.manifest);
    if (s.state !== "committed")
      for (const f of manifest) {
        if (
          !this.file(s.packet, f.id) &&
          !this.buffers.has(this.key(s.packet, f.id))
        )
          fail(409, "UPLOAD_INCOMPLETE", "还有原件未完整上传，未提交任何附件");
      }
    const result = this.store.apply(device, operation, epoch, {
      beforeValidate: () => {
        for (const f of manifest) {
          if (this.file(s.packet, f.id)) continue;
          const b = this.buffers.get(this.key(s.packet, f.id))?.body;
          if (!b) fail(409, "UPLOAD_INCOMPLETE", "原件尚未完整上传");
          this.verify(f, b);
          if (s.mode === "retained") {
            this.db
              .prepare("INSERT OR IGNORE INTO sync_blobs VALUES(?,?,?)")
              .run(f.hash, f.size, b);
            this.db
              .prepare("INSERT INTO sync_attachments VALUES(?,?,?,?,?)")
              .run(s.packet, f.id, f.hash, f.name, f.type);
          }
          this.db
            .prepare(
              "INSERT INTO original_files VALUES(?,?,?,?,?,?,?,'available',?,?,1)",
            )
            .run(
              s.packet,
              f.id,
              f.hash,
              f.name,
              f.type,
              f.size,
              s.mode,
              this.now() + 30 * day,
              this.now() + 37 * day,
            );
          this.db
            .prepare("INSERT INTO original_file_submissions VALUES(?,?,?)")
            .run(s.packet, f.id, s.id);
        }
      },
      beforeCommit: () => {
        this.db
          .prepare(
            "UPDATE original_submissions SET state='committed',reserved=0 WHERE id=?",
          )
          .run(id);
        this.db
          .prepare("INSERT INTO original_commits VALUES(?,?)")
          .run(id, fingerprint);
      },
    });
    if (s.mode === "retained") this.releaseWindow(s.packet);
    return { ...result, storage: this.view({ ...s, state: "committed" }) };
  }
  usage() {
    return {
      limitBytes: this.quota,
      usedBytes: this.db
        .prepare(
          "SELECT COALESCE(SUM(size),0) n FROM original_files WHERE mode='retained' AND state NOT IN ('deleted','cleaned')",
        )
        .get().n,
      reservedBytes: this.db
        .prepare(
          "SELECT COALESCE(SUM(reserved),0) n FROM original_submissions WHERE state='uploading'",
        )
        .get().n,
    };
  }
  list({ cursor = 0, packetId } = {}) {
    this.sweep();
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      (packetId !== undefined && !validId(packetId))
    )
      fail(400, "INVALID_CURSOR", "原件分页参数无效");
    const ids =
      packetId === undefined
        ? []
        : (this.store.record(packetId)?.data?.attachments || [])
            .filter((f) => !f.deletedAt)
            .map((f) => f.id);
    const rows = this.db
      .prepare(
        `SELECT f.rowid AS cursor,f.*,s.submission FROM original_files f LEFT JOIN original_file_submissions s ON s.packet=f.packet AND s.id=f.id WHERE f.rowid>? ${packetId === undefined ? "" : `AND f.packet=? AND f.id IN (${ids.length ? ids.map(() => "?").join(",") : "NULL"})`} ORDER BY f.rowid LIMIT 101`,
      )
      .all(...(packetId === undefined ? [cursor] : [cursor, packetId, ...ids]));
    const hasMore = rows.length > 100,
      page = rows.slice(0, 100);
    return {
      contractVersion: 1,
      ...this.usage(),
      hasMore,
      nextCursor: hasMore ? page.at(-1).cursor : null,
      trash: this.db
        .prepare(
          "SELECT packet AS packetId,cleanup AS cleanupAt FROM original_trash",
        )
        .all(),
      originals: page.map((f) => ({
        ...descriptor(f),
        packetId: f.packet,
        submissionId: f.submission || undefined,
        mode: f.mode,
        state: f.state,
        version: f.version,
        expiresAt: f.expires,
        cleanupAt: f.cleanup,
        remind:
          f.state === "legacy_pending_notice" ||
          (f.mode === "retained" &&
            !["deleted", "cleaned"].includes(f.state) &&
            this.now() >= f.expires - 7 * day),
        available:
          f.mode === "temporary"
            ? this.buffers.has(this.key(f.packet, f.id))
            : !["deleted", "cleaned"].includes(f.state),
      })),
    };
  }
  action(kind, { operationId, ids, stopTask = false }, stop) {
    this.sweep();
    if (
      !validId(operationId) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 20 ||
      ids.some(
        (f) =>
          !f ||
          !validId(f.packetId) ||
          !validId(f.id) ||
          !Number.isSafeInteger(f.expectedVersion),
      )
    )
      fail(422, "INVALID_ORIGINAL_ACTION", "请选择原件及其当前版本");
    const fingerprint = digest(JSON.stringify({ kind, ids, stopTask }));
    const prior = this.db
      .prepare("SELECT * FROM original_actions WHERE id=?")
      .get(operationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        fail(409, "IDEMPOTENCY_CONFLICT", "操作编号已用于其他内容");
      return JSON.parse(prior.response);
    }
    for (const packet of kind === "delete"
      ? new Set(
          ids
            .filter((v) => {
              const f = this.file(v.packetId, v.id);
              return (
                f &&
                f.version === v.expectedVersion &&
                !["deleted", "cleaned"].includes(f.state)
              );
            })
            .map((f) => f.packetId),
        )
      : []) {
      try {
        this.store.validateOriginalMutation?.(packet);
      } catch (e) {
        if (!stopTask)
          fail(
            409,
            "CONFIRM_STOP_REQUIRED",
            "原件正在处理，请明确停止任务后删除",
          );
        stop?.(packet);
        this.store.validateOriginalMutation?.(packet);
      }
    }
    return this.transaction(() => {
      const results = ids.map((v) => {
        const f = this.file(v.packetId, v.id);
        if (!f) return { ...v, code: "NOT_FOUND" };
        if (f.version !== v.expectedVersion)
          return { ...v, code: "REVISION_CONFLICT" };
        if (["deleted", "cleaned"].includes(f.state))
          return { ...v, code: "ORIGINAL_DELETED" };
        if (kind === "renew") {
          if (f.mode !== "retained")
            return { ...v, code: "TEMPORARY_ORIGINAL" };
          this.db
            .prepare(
              "UPDATE original_files SET state='available',expires=?,cleanup=?,version=version+1 WHERE packet=? AND id=?",
            )
            .run(this.now() + 30 * day, this.now() + 37 * day, f.packet, f.id);
        } else this.remove(f, "deleted");
        return {
          id: f.id,
          packetId: f.packet,
          version: f.version + 1,
          code: "OK",
        };
      });
      const response = { contractVersion: 1, results };
      this.db
        .prepare("INSERT INTO original_actions VALUES(?,?,?)")
        .run(operationId, fingerprint, JSON.stringify(response));
      return response;
    });
  }
  remove(f, state) {
    this.db
      .prepare("DELETE FROM sync_attachments WHERE packet_id=? AND id=?")
      .run(f.packet, f.id);
    this.db
      .prepare(
        "UPDATE original_files SET state=?,version=version+1 WHERE packet=? AND id=?",
      )
      .run(state, f.packet, f.id);
    this.release(this.key(f.packet, f.id));
    this.db.exec(
      "DELETE FROM sync_blobs WHERE hash NOT IN (SELECT hash FROM sync_attachments)",
    );
  }
  sweep() {
    if (this.db.isTransaction) return;
    const now = this.now();
    for (const [key, b] of this.buffers) if (b.until <= now) this.release(key);
    this.db
      .prepare(
        "UPDATE original_submissions SET state='expired',reserved=0 WHERE state='uploading' AND until_at<=?",
      )
      .run(now);
    this.db
      .prepare(
        "UPDATE original_files SET state='pending_cleanup',version=version+1 WHERE mode='retained' AND state='available' AND expires<=?",
      )
      .run(now);
    for (const t of this.db
      .prepare("SELECT packet FROM original_trash WHERE cleanup<=?")
      .all(now))
      this.transaction(() => {
        this.store.files.purge(t.packet);
        const version = this.store.sequence + 1;
        this.db
          .prepare(
            "UPDATE sync_records SET data=NULL,purged=1,version=? WHERE id=?",
          )
          .run(version, t.packet);
        this.db
          .prepare("UPDATE sync_meta SET value=? WHERE key='sequence'")
          .run(String(version));
        this.db
          .prepare("DELETE FROM original_trash WHERE packet=?")
          .run(t.packet);
      });
    for (const f of this.db
      .prepare(
        "SELECT * FROM original_files WHERE mode='retained' AND state='pending_cleanup' AND cleanup<=?",
      )
      .all(now)) {
      try {
        this.store.validateOriginalMutation?.(f.packet);
      } catch {
        continue;
      }
      this.transaction(() => this.remove(f, "cleaned"));
    }
  }
  close() {
    clearInterval(this.timer);
    for (const key of this.buffers.keys()) this.release(key);
  }
}
