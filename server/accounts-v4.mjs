import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { SyncError } from "./sync-store.mjs";
import { digest } from "./sync-accounts.mjs";
const derive = promisify(scrypt);
const params = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const scheme = "scrypt:131072:8:1:64";
const messages = {
  UNAUTHORIZED: "认证失败，请核对账号、密码或设备；连续失败后请稍候重试",
  INVALID_USERNAME: "账号名需3至20个字符，可用文字、数字、下划线、点和短横线",
  INVALID_PASSWORD: "密码需8至128个字符，且不能超过1024 UTF-8字节",
  DEVICE_SLOTS_FULL: "设备槽位已满，请选择要替换的设备",
  CLAIM_REQUIRED: "旧账号需要在原有效设备上补设账号密码",
  ALREADY_CLAIMED: "此账号已设置密码，请使用账号密码登录",
  USERNAME_UNAVAILABLE: "账号名称已被使用，请换一个",
  REGISTRATION_FULL: "内测账号名额已满",
  INVALID_DEVICE: "设备名称无效，请修改后重试",
  STALE_DEVICE: "设备列表已变化，请刷新后重新选择",
  DEVICE_NOT_FOUND: "设备已不存在，请刷新列表",
  LOGIN_RATE_LIMIT: "登录尝试较多，请一分钟后重试",
  LOGIN_BUSY: "登录服务正在处理请求，请稍后重试",
  PASSWORD_SCHEME_UNAVAILABLE: "账号暂时无法登录，请联系维护者核对",
  STALE_CREDENTIALS: "账号凭据已变化，请重新登录",
  IDEMPOTENCY_CONFLICT: "这次操作的信息已变化，请重新发起",
  INVALID_OPERATION: "这次操作无效，请刷新后重试",
};
const fail = (code = "UNAUTHORIZED", status = 401, details = {}) => {
  throw new SyncError(
    status,
    code,
    messages[code] || "账号操作暂时无法完成，请稍后重试",
    details,
  );
};
const validId = (value) =>
  typeof value === "string" && /^[\w-]{1,90}$/.test(value);
export function usernameKey(value) {
  if (typeof value !== "string") fail();
  const key = value.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (
    [...key].length < 3 ||
    [...key].length > 20 ||
    !/^[\p{L}\p{N}_.-]+$/u.test(key)
  )
    fail("INVALID_USERNAME", 400);
  return key;
}
function password(value) {
  if (
    typeof value !== "string" ||
    [...value].length < 8 ||
    [...value].length > 128 ||
    Buffer.byteLength(value) > 1024
  )
    fail("INVALID_PASSWORD", 400);
  return value;
}

// Opt-in account migration. Never called by the default v3 entry point.
// All slot/credential changes and append-only security receipts share the
// registry transaction. Independent safety-watermark replay remains an E gate.
export class AccountsV4 {
  constructor(registry, { now = Date.now } = {}) {
    this.registry = registry;
    this.db = registry.db;
    this.now = now;
    this.hashing = false;
    this.closed = false;
    registry.transaction(() => {
      const version = this.db
        .prepare("SELECT value FROM account_meta WHERE key='auth_v4'")
        .get();
      if (version && version.value !== "1") throw Error("UNKNOWN_AUTH_SCHEMA");
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS account_credentials(user_id TEXT PRIMARY KEY REFERENCES accounts(id),username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,scheme TEXT NOT NULL DEFAULT 'scrypt:131072:8:1:64' CHECK(scheme='scrypt:131072:8:1:64'),version INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS account_device_slots(binding TEXT PRIMARY KEY REFERENCES bindings(id),user_id TEXT NOT NULL REFERENCES accounts(id),kind TEXT NOT NULL,slot INTEGER NOT NULL,name TEXT NOT NULL,last_seen INTEGER NOT NULL,CHECK((kind='windows' AND slot BETWEEN 1 AND 3) OR (kind='wechat' AND slot=1)),UNIQUE(user_id,kind,slot));
        CREATE TABLE IF NOT EXISTS account_v4_operations(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_v4_events(seq INTEGER PRIMARY KEY,operation TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,account TEXT NOT NULL,binding TEXT,at INTEGER NOT NULL);
        CREATE TRIGGER IF NOT EXISTS account_v4_events_no_update BEFORE UPDATE ON account_v4_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        CREATE TRIGGER IF NOT EXISTS account_v4_events_no_delete BEFORE DELETE ON account_v4_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
        CREATE TABLE IF NOT EXISTS account_login_attempts(key TEXT NOT NULL,at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS account_login_window ON account_login_attempts(key,at);
        CREATE TABLE IF NOT EXISTS account_login_failures(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,locked_until INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS account_grant_intents(account TEXT PRIMARY KEY REFERENCES accounts(id),operation TEXT UNIQUE NOT NULL);`);
      if (
        this.db
          .prepare("PRAGMA table_info(account_credentials)")
          .all()
          .map((row) => row.name)
          .join(",") !== "user_id,username,salt,hash,scheme,version"
      )
        throw Error("UNKNOWN_CREDENTIAL_SCHEMA");
      if (
        !this.db.prepare("SELECT 1 FROM account_meta WHERE key='auth_v4'").get()
      ) {
        for (const binding of this.db
          .prepare("SELECT * FROM bindings WHERE revoked=0")
          .all())
          this.db
            .prepare("INSERT INTO account_device_slots VALUES(?,?,?,?,?,?)")
            .run(
              binding.id,
              binding.user_id,
              binding.kind,
              1,
              "升级前设备",
              this.now(),
            );
        this.db.exec(
          "DROP INDEX active_slot; INSERT INTO account_meta VALUES('auth_v4','1')",
        );
        this.event("auth-v4-migration", "migration", "system");
      }
      const missing = this.db
        .prepare(
          "SELECT COUNT(*) n FROM bindings b LEFT JOIN account_device_slots s ON s.binding=b.id WHERE b.revoked=0 AND s.binding IS NULL",
        )
        .get().n;
      if (missing) throw Error("DEVICE_MIGRATION_INCOMPLETE");
      if (
        this.db
          .prepare(
            "SELECT 1 FROM account_device_slots s JOIN bindings b ON b.id=s.binding WHERE s.user_id!=b.user_id OR s.kind!=b.kind",
          )
          .get()
      )
        throw Error("DEVICE_MIGRATION_INCOMPLETE");
    });
  }
  close() {
    this.closed = true;
  }
  assertOpen() {
    if (this.closed)
      throw new SyncError(503, "SERVICE_CLOSING", "服务正在关闭，请稍后重试");
  }
  fingerprint(value) {
    this.assertOpen();
    return createHmac("sha256", this.registry.secret)
      .update(JSON.stringify(value))
      .digest("hex");
  }
  receipt(id, fingerprint) {
    if (!validId(id)) fail("INVALID_OPERATION", 400);
    const prior = this.db
      .prepare("SELECT * FROM account_v4_operations WHERE id=?")
      .get(id);
    if (prior && prior.fingerprint !== fingerprint)
      fail("IDEMPOTENCY_CONFLICT", 409);
    return prior ? JSON.parse(prior.response) : null;
  }
  save(id, fingerprint, response) {
    this.db
      .prepare("INSERT INTO account_v4_operations VALUES(?,?,?)")
      .run(id, fingerprint, JSON.stringify(response));
    return response;
  }
  event(operation, kind, account, binding = null) {
    this.db
      .prepare(
        "INSERT INTO account_v4_events(operation,kind,account,binding,at) VALUES(?,?,?,?,?)",
      )
      .run(operation, kind, account, binding, this.now());
  }
  rate(key, ip) {
    this.assertOpen();
    const accountKey = digest(key),
      ipKey = digest("ip:" + ip),
      at = this.now();
    const outcome = this.registry.transaction(() => {
      this.db
        .prepare("DELETE FROM account_login_attempts WHERE at<=?")
        .run(at - 60000);
      for (const bucket of [accountKey, ipKey])
        if (
          this.db
            .prepare(
              "SELECT COUNT(*) n FROM account_login_attempts WHERE key=?",
            )
            .get(bucket).n >= 5
        )
          return "rate";
      for (const bucket of [accountKey, ipKey])
        this.db
          .prepare("INSERT INTO account_login_attempts VALUES(?,?)")
          .run(bucket, at);
      const previous = this.db
        .prepare("SELECT * FROM account_login_failures WHERE key=?")
        .get(accountKey);
      if (previous?.locked_until > at) return "locked";
      if (previous?.locked_until && previous.locked_until <= at)
        this.db
          .prepare(
            "UPDATE account_login_failures SET failures=0,locked_until=0 WHERE key=?",
          )
          .run(accountKey);
      return "ok";
    });
    if (outcome === "rate") fail("LOGIN_RATE_LIMIT", 429);
    if (outcome === "locked") fail();
    return accountKey;
  }
  failed(key) {
    this.registry.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO account_login_failures VALUES(?,1,0) ON CONFLICT(key) DO UPDATE SET failures=failures+1",
        )
        .run(key);
      this.db
        .prepare(
          "UPDATE account_login_failures SET locked_until=? WHERE key=? AND failures>=10 AND locked_until=0",
        )
        .run(this.now() + 15 * 60000, key);
    });
  }
  async hash(value, salt) {
    this.assertOpen();
    if (this.hashing) fail("LOGIN_BUSY", 429);
    this.hashing = true;
    try {
      const bytes = await derive(value, Buffer.from(salt, "hex"), 64, params);
      this.assertOpen();
      return bytes.toString("hex");
    } finally {
      this.hashing = false;
    }
  }
  async verify(username, value, ip) {
    const key = usernameKey(username),
      rate = this.rate(key, ip);
    if (typeof value !== "string" || Buffer.byteLength(value) > 1024) fail();
    const row = this.db
      .prepare("SELECT * FROM account_credentials WHERE username=?")
      .get(key);
    if (row && row.scheme !== scheme) fail("PASSWORD_SCHEME_UNAVAILABLE", 503);
    const actual = await this.hash(value, row?.salt || "00".repeat(32));
    const expected = row?.hash || "00".repeat(64);
    if (
      !row ||
      !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
    ) {
      this.failed(rate);
      fail();
    }
    const current = this.db
      .prepare("SELECT * FROM account_credentials WHERE user_id=?")
      .get(row.user_id);
    if (current?.version !== row.version || current.hash !== row.hash) fail();
    this.registry.account(row.user_id);
    this.db.prepare("DELETE FROM account_login_failures WHERE key=?").run(rate);
    return row;
  }
  devices(account) {
    return this.db
      .prepare(
        "SELECT b.id,b.kind,s.slot,s.name,s.last_seen lastSeen,b.expires FROM bindings b JOIN account_device_slots s ON s.binding=b.id WHERE b.user_id=? AND b.revoked=0 ORDER BY b.kind,s.slot",
      )
      .all(account);
  }
  binding(account, identity, replaceId) {
    const {
      kind,
      identity: identityHash,
      publicKey = null,
      name = "新设备",
    } = identity;
    if (
      !["windows", "wechat"].includes(kind) ||
      typeof identityHash !== "string" ||
      !identityHash ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80
    )
      fail("INVALID_DEVICE", 400);
    this.db
      .prepare(
        "DELETE FROM account_device_slots WHERE binding IN (SELECT id FROM bindings WHERE revoked=1)",
      )
      .run();
    const existing = this.db
      .prepare(
        "SELECT * FROM bindings WHERE kind=? AND identity=? AND revoked=0",
      )
      .get(kind, identityHash);
    if (existing) {
      if (existing.user_id !== account) fail("IDENTITY_BOUND", 409);
      if (existing.expires <= this.now()) {
        existing.expires = this.now() + 365 * 86400000;
        this.db
          .prepare("UPDATE bindings SET expires=? WHERE id=?")
          .run(existing.expires, existing.id);
      }
      this.db
        .prepare("UPDATE account_device_slots SET last_seen=? WHERE binding=?")
        .run(this.now(), existing.id);
      return { ...existing, token: this.registry.token(existing) };
    }
    if (replaceId) {
      const target = this.db
        .prepare(
          "SELECT * FROM bindings WHERE id=? AND user_id=? AND kind=? AND revoked=0",
        )
        .get(replaceId, account, kind);
      if (!target) fail("STALE_DEVICE", 409);
      this.db
        .prepare("UPDATE bindings SET revoked=1 WHERE id=?")
        .run(replaceId);
      this.db
        .prepare("DELETE FROM account_device_slots WHERE binding=?")
        .run(replaceId);
    }
    const devices = this.devices(account),
      slots = new Set(
        devices.filter((d) => d.kind === kind).map((d) => d.slot),
      );
    const slot = (kind === "windows" ? [1, 2, 3] : [1]).find(
      (s) => !slots.has(s),
    );
    if (!slot) fail("DEVICE_SLOTS_FULL", 409, { devices });
    const binding = {
      id: randomUUID(),
      user_id: account,
      kind,
      identity: identityHash,
      public_key: publicKey,
      expires: this.now() + 365 * 86400000,
    };
    this.db
      .prepare(
        "INSERT INTO bindings(id,user_id,kind,identity,public_key,expires) VALUES(?,?,?,?,?,?)",
      )
      .run(binding.id, account, kind, identityHash, publicKey, binding.expires);
    this.db
      .prepare("INSERT INTO account_device_slots VALUES(?,?,?,?,?,?)")
      .run(binding.id, account, kind, slot, name.trim(), this.now());
    return {
      ...binding,
      token: this.registry.token(binding),
      ...(replaceId ? { replacedBindingId: replaceId } : {}),
    };
  }
  async register(value, identity, ip) {
    const username = usernameKey(value.username);
    password(value.password);
    const fingerprint = this.fingerprint([
      "register",
      username,
      value.password,
      value.invite,
      identity,
    ]);
    const prior = this.receipt(value.operationId, fingerprint);
    if (prior) return prior;
    this.rate(username, ip);
    const salt = randomBytes(32).toString("hex"),
      hash = await this.hash(value.password, salt);
    return this.registry.transaction(() => {
      const replay = this.receipt(value.operationId, fingerprint);
      if (replay) return replay;
      const account =
        typeof value.invite === "string" &&
        this.db
          .prepare("SELECT * FROM accounts WHERE invite_hash=? AND enabled=1")
          .get(digest(value.invite.trim()));
      if (!account) fail();
      if (
        this.db
          .prepare(
            "SELECT 1 FROM bindings WHERE user_id=? UNION SELECT 1 FROM ai_usage WHERE user_id=? UNION SELECT 1 FROM account_credentials WHERE user_id=?",
          )
          .get(account.id, account.id, account.id)
      )
        fail("CLAIM_REQUIRED", 409);
      const registered = this.db
        .prepare(
          "SELECT COUNT(*) n FROM accounts a WHERE EXISTS(SELECT 1 FROM bindings b WHERE b.user_id=a.id) OR EXISTS(SELECT 1 FROM ai_usage u WHERE u.user_id=a.id) OR EXISTS(SELECT 1 FROM account_credentials c WHERE c.user_id=a.id)",
        )
        .get().n;
      if (registered >= 10) fail("REGISTRATION_FULL", 409);
      if (
        this.db
          .prepare("SELECT 1 FROM account_credentials WHERE username=?")
          .get(username)
      )
        fail("USERNAME_UNAVAILABLE", 409);
      this.db
        .prepare(
          "INSERT INTO account_credentials(user_id,username,salt,hash) VALUES(?,?,?,?)",
        )
        .run(account.id, username, salt, hash);
      const binding = this.binding(account.id, identity);
      this.db
        .prepare("INSERT INTO account_grant_intents VALUES(?,?)")
        .run(account.id, value.operationId);
      this.event(value.operationId, "register", account.id, binding.id);
      return this.save(value.operationId, fingerprint, {
        binding,
        newAccount: true,
      });
    });
  }
  async login(value, identity, ip) {
    const credential = await this.verify(value.username, value.password, ip);
    const fingerprint = this.fingerprint([
      "login",
      credential.user_id,
      credential.version,
      identity,
      value.replaceBindingId,
    ]);
    return this.registry.transaction(() => {
      this.registry.account(credential.user_id);
      if (
        this.db
          .prepare("SELECT version FROM account_credentials WHERE user_id=?")
          .get(credential.user_id)?.version !== credential.version
      )
        fail();
      const prior = this.receipt(value.operationId, fingerprint);
      if (prior) return prior;
      const binding = this.binding(
        credential.user_id,
        identity,
        value.replaceBindingId,
      );
      this.event(
        value.operationId,
        value.replaceBindingId ? "replace_device" : "login",
        credential.user_id,
        binding.id,
      );
      if (binding.replacedBindingId)
        this.event(
          value.operationId + ":revoke",
          "revoke",
          credential.user_id,
          binding.replacedBindingId,
        );
      return this.save(value.operationId, fingerprint, {
        binding,
        newAccount: false,
      });
    });
  }
  async claim(account, value, device, ip) {
    const username = usernameKey(value.username);
    password(value.password);
    const fingerprint = this.fingerprint([
      "claim",
      account,
      username,
      value.password,
      device,
    ]);
    const prior = this.receipt(value.operationId, fingerprint);
    if (prior) return prior;
    this.rate(username, ip);
    const salt = randomBytes(32).toString("hex"),
      hash = await this.hash(value.password, salt);
    return this.registry.transaction(() => {
      const current = this.registry.authenticate(
        this.registry.token({ id: device }),
      );
      if (current.user_id !== account) fail();
      if (
        this.db
          .prepare("SELECT 1 FROM account_credentials WHERE user_id=?")
          .get(account)
      )
        fail("ALREADY_CLAIMED", 409);
      if (
        this.db
          .prepare("SELECT 1 FROM account_credentials WHERE username=?")
          .get(username)
      )
        fail("USERNAME_UNAVAILABLE", 409);
      this.db
        .prepare(
          "INSERT INTO account_credentials(user_id,username,salt,hash) VALUES(?,?,?,?)",
        )
        .run(account, username, salt, hash);
      this.event(value.operationId, "claim", account, device);
      return this.save(value.operationId, fingerprint, {
        ok: true,
        newAccount: false,
      });
    });
  }
  wechat(identity, ip) {
    const binding = this.db
      .prepare(
        "SELECT * FROM bindings WHERE kind='wechat' AND identity=? AND revoked=0 AND expires>?",
      )
      .get(identity, this.now());
    if (!binding) fail();
    const credential = this.db
      .prepare("SELECT username FROM account_credentials WHERE user_id=?")
      .get(binding.user_id);
    this.rate(credential?.username || binding.user_id, ip);
    this.registry.account(binding.user_id);
    return {
      binding: { ...binding, token: this.registry.token(binding) },
      newAccount: false,
    };
  }
  revoke(account, id, operationId) {
    const fingerprint = this.fingerprint(["revoke", account, id]);
    return this.registry.transaction(() => {
      const prior = this.receipt(operationId, fingerprint);
      if (prior) return prior;
      if (
        !this.db
          .prepare("SELECT 1 FROM bindings WHERE id=? AND user_id=?")
          .get(id, account)
      )
        fail("DEVICE_NOT_FOUND", 404);
      this.db.prepare("UPDATE bindings SET revoked=1 WHERE id=?").run(id);
      this.db
        .prepare("DELETE FROM account_device_slots WHERE binding=?")
        .run(id);
      this.event(operationId, "revoke", account, id);
      return this.save(operationId, fingerprint, { ok: true });
    });
  }
  async changePassword(account, value, device, ip) {
    password(value.newPassword);
    if (value.revokeAll !== undefined && typeof value.revokeAll !== "boolean")
      fail("INVALID_OPERATION", 400);
    const fingerprint = this.fingerprint([
      "password",
      account,
      value.oldPassword,
      value.newPassword,
      !!value.revokeAll,
      device,
    ]);
    const prior = this.receipt(value.operationId, fingerprint);
    if (prior) return prior;
    const row = this.db
      .prepare("SELECT * FROM account_credentials WHERE user_id=?")
      .get(account);
    if (!row) fail("CLAIM_REQUIRED", 409);
    await this.verify(row.username, value.oldPassword, ip);
    const salt = randomBytes(32).toString("hex"),
      hash = await this.hash(value.newPassword, salt);
    return this.registry.transaction(() => {
      const binding = this.registry.authenticate(
        this.registry.token({ id: device }),
      );
      if (binding.user_id !== account) fail();
      const current = this.db
        .prepare("SELECT version FROM account_credentials WHERE user_id=?")
        .get(account);
      if (current.version !== row.version) fail("STALE_CREDENTIALS", 409);
      this.db
        .prepare(
          "UPDATE account_credentials SET salt=?,hash=?,version=version+1 WHERE user_id=?",
        )
        .run(salt, hash, account);
      if (value.revokeAll) {
        for (const old of this.db
          .prepare("SELECT id FROM bindings WHERE user_id=? AND revoked=0")
          .all(account))
          this.event(
            value.operationId + ":revoke:" + old.id,
            "revoke",
            account,
            old.id,
          );
        this.db
          .prepare("UPDATE bindings SET revoked=1 WHERE user_id=?")
          .run(account);
        this.db
          .prepare("DELETE FROM account_device_slots WHERE user_id=?")
          .run(account);
      }
      this.event(value.operationId, "password", account, device);
      return this.save(value.operationId, fingerprint, {
        ok: true,
        revokedAll: !!value.revokeAll,
      });
    });
  }
}
