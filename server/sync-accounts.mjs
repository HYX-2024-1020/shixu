import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SyncError } from "./sync-store.mjs";

export const digest = (v) => createHash("sha256").update(v).digest("hex");
const reject = (status, code, message) => {
  throw new SyncError(status, code, message);
};
export const DEFAULT_ACCOUNT_LIMITS = Object.freeze({
  dailyJobs: 10,
  requestsPerMinute: 60,
  storageBytes: 32 * 1024 * 1024,
});
export class AccountRegistry {
  constructor(directory, secret) {
    if (typeof secret !== "string" || secret.length < 32)
      throw Error("SYNC_ACCOUNT_SECRET requires at least 32 characters");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.secret = secret;
    this.db = new DatabaseSync(join(directory, "accounts.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS account_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,
        invite_hash TEXT UNIQUE NOT NULL,limits TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),
        kind TEXT NOT NULL CHECK(kind IN ('windows','wechat')),identity TEXT NOT NULL,public_key TEXT,
        revoked INTEGER NOT NULL DEFAULT 0,expires INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_identity ON bindings(kind,identity) WHERE revoked=0;
      CREATE TABLE IF NOT EXISTS nonces(binding_id TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL,
        PRIMARY KEY(binding_id,nonce));
      CREATE TABLE IF NOT EXISTS request_rates(key TEXT PRIMARY KEY,window INTEGER NOT NULL,n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT NOT NULL,job_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
        day TEXT NOT NULL,reserved_micros INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(user_id,job_id));`);
    if (
      !this.db.prepare("SELECT 1 FROM account_meta WHERE key='auth_v4'").get()
    )
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS active_slot ON bindings(user_id,kind) WHERE revoked=0",
      );
    const check = digest(secret);
    const previous = this.db
      .prepare("SELECT value FROM account_meta WHERE key='secret_check'")
      .get();
    if (previous && previous.value !== check) {
      this.db.close();
      throw Error("Account secret changed; restore the original secret");
    }
    this.db
      .prepare("INSERT OR IGNORE INTO account_meta VALUES('secret_check',?)")
      .run(check);
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  generate(count = 1) {
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw Error("count must be 1..100");
    return this.transaction(() =>
      Array.from({ length: count }, () => {
        const invite = "sx_" + randomBytes(24).toString("base64url"),
          userId = randomUUID();
        this.db
          .prepare(
            "INSERT INTO accounts(id,invite_hash,limits,created_at) VALUES(?,?,?,?)",
          )
          .run(
            userId,
            digest(invite),
            JSON.stringify(DEFAULT_ACCOUNT_LIMITS),
            Date.now(),
          );
        return { userId, invite };
      }),
    );
  }
  account(id) {
    const row = this.db
      .prepare("SELECT id,enabled,limits FROM accounts WHERE id=?")
      .get(id);
    if (!row || !row.enabled)
      reject(401, "ACCOUNT_DISABLED", "账号不可用，请联系管理员");
    return { id: row.id, limits: JSON.parse(row.limits) };
  }
  token(binding) {
    return (
      "sx3_" +
      binding.id +
      "." +
      createHmac("sha256", this.secret).update(binding.id).digest("base64url")
    );
  }
  bind(invite, kind, identity, publicKey = null) {
    if (this.db.prepare("SELECT 1 FROM account_meta WHERE key='auth_v4'").get())
      reject(426, "CLIENT_UPGRADE_REQUIRED", "请使用账号密码注册或登录");
    if (typeof invite !== "string" || invite.length > 100)
      reject(401, "INVALID_INVITE", "邀请码无效");
    return this.transaction(() => {
      const account = this.db
        .prepare("SELECT id,enabled FROM accounts WHERE invite_hash=?")
        .get(digest(invite.trim()));
      if (!account || !account.enabled)
        reject(401, "INVALID_INVITE", "邀请码无效或账号已停用");
      const current = this.db
        .prepare(
          "SELECT * FROM bindings WHERE user_id=? AND kind=? AND revoked=0",
        )
        .get(account.id, kind);
      if (current && current.identity !== identity)
        reject(409, "DEVICE_BOUND", "此端已绑定，请联系管理员重置后换机");
      if (current && current.expires <= Date.now())
        reject(401, "DEVICE_EXPIRED", "设备凭证已到期，请联系管理员重置");
      if (current) return { ...current, token: this.token(current) };
      if (
        this.db
          .prepare(
            "SELECT id FROM bindings WHERE kind=? AND identity=? AND revoked=0",
          )
          .get(kind, identity)
      )
        reject(409, "IDENTITY_BOUND", "此身份已绑定其他账号");
      const binding = {
        id: randomUUID(),
        user_id: account.id,
        kind,
        identity,
        public_key: publicKey,
        expires: Date.now() + 365 * 86400000,
      };
      this.db
        .prepare(
          "INSERT INTO bindings(id,user_id,kind,identity,public_key,expires) VALUES(?,?,?,?,?,?)",
        )
        .run(
          binding.id,
          binding.user_id,
          kind,
          identity,
          publicKey,
          binding.expires,
        );
      return { ...binding, token: this.token(binding) };
    });
  }
  authenticate(token) {
    if (typeof token !== "string" || token.length > 150)
      reject(401, "UNAUTHORIZED", "请激活或恢复设备授权，本地资料仍保留");
    const id = token.slice(4).split(".")[0];
    const binding = this.db
      .prepare("SELECT * FROM bindings WHERE id=? AND revoked=0 AND expires>?")
      .get(id, Date.now());
    // Compare fixed-length digests; never compare a secret signature with variable-time equality.
    if (!binding || !safeEqual(token, this.token(binding)))
      reject(401, "UNAUTHORIZED", "设备授权已撤销或失效，本地资料仍保留");
    this.account(binding.user_id);
    if (this.db.prepare("SELECT 1 FROM account_meta WHERE key='auth_v4'").get())
      this.db
        .prepare(
          "UPDATE account_device_slots SET last_seen=? WHERE binding=? AND last_seen<?",
        )
        .run(Date.now(), binding.id, Date.now() - 60000);
    return binding;
  }
  proof(binding, method, path, body, headers) {
    verifyWindowsProof(binding.public_key, method, path, body, headers);
    const nonce = headers["x-shixu-nonce"];
    this.db.prepare("DELETE FROM nonces WHERE expires<?").run(Date.now());
    try {
      this.db
        .prepare("INSERT INTO nonces VALUES(?,?,?)")
        .run(binding.id, nonce, Date.now() + 120000);
    } catch {
      reject(401, "REPLAYED_REQUEST", "请求已使用，请重新发起");
    }
  }
  rate(key, max, now = Date.now()) {
    const window = Math.floor(now / 60000);
    this.db.prepare("DELETE FROM request_rates WHERE window<?").run(window - 1);
    this.db
      .prepare(
        `INSERT INTO request_rates VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET
      n=CASE WHEN window=excluded.window THEN n+1 ELSE 1 END,window=excluded.window`,
      )
      .run(key, window);
    if (
      this.db.prepare("SELECT n FROM request_rates WHERE key=?").get(key).n >
      max
    )
      reject(429, "RATE_LIMIT", "请求较多，请稍后重试");
  }
  revoke(userId, kind) {
    this.account(userId);
    if (!["windows", "wechat"].includes(kind))
      throw Error("kind must be windows or wechat");
    this.db
      .prepare("UPDATE bindings SET revoked=1 WHERE user_id=? AND kind=?")
      .run(userId, kind);
  }
  enable(userId, enabled) {
    const result = this.db
      .prepare("UPDATE accounts SET enabled=? WHERE id=?")
      .run(enabled ? 1 : 0, userId);
    if (!result.changes) throw Error("Unknown account");
  }
  limits(userId, changes) {
    const account = this.account(userId);
    for (const [key, value] of Object.entries(changes))
      if (
        !(key in DEFAULT_ACCOUNT_LIMITS) ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 1024 * 1024 * 1024
      )
        throw Error("Invalid account limit");
    this.db
      .prepare("UPDATE accounts SET limits=? WHERE id=?")
      .run(JSON.stringify({ ...account.limits, ...changes }), userId);
  }
  usage(userId) {
    return this.db
      .prepare(
        "SELECT day,COUNT(*) AS requests,SUM(reserved_micros) AS reservedMicros FROM ai_usage WHERE user_id=? GROUP BY day ORDER BY day DESC",
      )
      .all(userId);
  }
  aiPaused() {
    return (
      this.db
        .prepare("SELECT value FROM account_meta WHERE key='ai_paused'")
        .get()?.value === "true"
    );
  }
  pauseAI(paused) {
    this.db
      .prepare(
        "INSERT INTO account_meta VALUES('ai_paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(paused));
  }
  reserve(userId, jobId, fingerprint, limits) {
    return this.transaction(() => {
      const old = this.db
        .prepare(
          "SELECT fingerprint FROM ai_usage WHERE user_id=? AND job_id=?",
        )
        .get(userId, jobId);
      if (old) {
        if (old.fingerprint !== fingerprint)
          reject(409, "JOB_ID_REUSED", "任务 ID 已用于其他请求");
        return false;
      }
      const account = this.account(userId),
        day = new Date().toISOString().slice(0, 10);
      const daily = this.db
        .prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id=? AND day=?")
        .get(userId, day).n;
      const pending = this.db
        .prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE state='pending'")
        .get().n;
      const ownPending = this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_usage WHERE user_id=? AND state='pending'",
        )
        .get(userId).n;
      const total = this.db
        .prepare(
          "SELECT COALESCE(SUM(reserved_micros),0) AS n FROM ai_usage WHERE day=?",
        )
        .get(day).n;
      if (daily >= account.limits.dailyJobs)
        reject(429, "AI_QUOTA", "今日 AI 额度已用完，本地记录和同步仍可使用");
      if (ownPending >= 1 || pending >= limits.queueLength)
        reject(429, "QUEUE_FULL", "AI 队列已满，请稍后再试");
      if (
        this.aiPaused() ||
        !limits.enabled ||
        limits.taskBudgetMicros < 1 ||
        total + limits.taskBudgetMicros > limits.dailyBudgetMicros
      )
        reject(503, "AI_BUDGET", "服务端 AI 暂停，记录和同步仍可使用");
      this.db
        .prepare("INSERT INTO ai_usage VALUES(?,?,?,?,?,'pending')")
        .run(userId, jobId, fingerprint, day, limits.taskBudgetMicros);
      return true;
    });
  }
  release(userId, jobId) {
    this.db
      .prepare(
        "DELETE FROM ai_usage WHERE user_id=? AND job_id=? AND state='pending'",
      )
      .run(userId, jobId);
  }
  finish(userId, jobId, state) {
    this.db
      .prepare("UPDATE ai_usage SET state=? WHERE user_id=? AND job_id=?")
      .run(state, userId, jobId);
  }
}
import { timingSafeEqual } from "node:crypto";
function safeEqual(a, b) {
  return timingSafeEqual(
    Buffer.from(digest(a), "hex"),
    Buffer.from(digest(b), "hex"),
  );
}
export function proofMessage(method, path, body, timestamp, nonce) {
  return ["shixu-v3", method, path, digest(body), timestamp, nonce].join("\n");
}
export function verifyWindowsProof(publicKey, method, path, body, headers) {
  const timestamp = headers["x-shixu-time"],
    nonce = headers["x-shixu-nonce"],
    signature = headers["x-shixu-signature"];
  if (
    !/^\d{13}$/.test(timestamp || "") ||
    Math.abs(Date.now() - Number(timestamp)) > 60000 ||
    !/^[a-zA-Z0-9_-]{20,100}$/.test(nonce || "") ||
    typeof signature !== "string" ||
    signature.length > 200
  )
    reject(401, "INVALID_PROOF", "设备签名无效，请重新请求");
  try {
    const key = createPublicKey(publicKey);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(proofMessage(method, path, body, timestamp, nonce)),
        key,
        Buffer.from(signature, "base64url"),
      )
    )
      throw Error();
  } catch {
    reject(401, "INVALID_PROOF", "设备签名无效");
  }
}
