import http from "node:http";
import { Readable } from "node:stream";
import { createPublicKey, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AccountRegistry,
  digest,
  verifyWindowsProof,
} from "./sync-accounts.mjs";
import { createSyncService } from "./sync-server.mjs";
import { SyncError } from "./sync-store.mjs";
import { createServerAI } from "./sync-provider.mjs";

export const DEFAULT_AI_LIMITS = Object.freeze({
  enabled: false,
  concurrency: 2,
  queueLength: 20,
  maxInputBytes: 24000,
  maxOutputTokens: 1024,
  taskBudgetMicros: 0,
  dailyBudgetMicros: 0,
});
function send(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new SyncError(413, "TOO_LARGE", "请求超过大小限制");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parse(req, bytes) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new SyncError(415, "JSON_REQUIRED", "请使用 JSON");
  try {
    const value = JSON.parse(bytes);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new SyncError(400, "INVALID_JSON", "无效请求");
  }
}
// This module never opens the legacy workspace.sqlite. Each account gets its own
// SQLite file, including its records, cursors, blobs, idempotency log and jobs.
export function createMultiUserService({
  directory,
  secret,
  origin = "https://sync.shixunote.top",
  ai = null,
  aiLimits = {},
  wechat = null,
}) {
  if (new URL(origin).origin !== origin)
    throw Error("Origin must not contain a path");
  const limits = { ...DEFAULT_AI_LIMITS, ...aiLimits };
  for (const [key, value] of Object.entries(limits)) {
    if (key === "enabled") {
      if (typeof value !== "boolean") throw Error("Invalid AI enabled flag");
    } else if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000)
      throw Error("Invalid AI limit: " + key);
  }
  if (
    limits.concurrency < 1 ||
    limits.concurrency > 2 ||
    limits.queueLength < 1 ||
    limits.maxInputBytes < 1 ||
    limits.maxOutputTokens < 1
  )
    throw Error("Invalid AI queue configuration");
  const registry = new AccountRegistry(directory, secret),
    tenants = new Map();
  let running = 0,
    closed = false;
  const waiting = [];
  async function acquire(signal) {
    if (closed || signal.aborted) throw Error("Stopped");
    if (running < limits.concurrency) {
      running++;
      return;
    }
    await new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, abort: null };
      entry.abort = () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(Error("Stopped"));
      };
      signal.addEventListener("abort", entry.abort, { once: true });
      waiting.push(entry);
    });
  }
  function release() {
    const next = waiting.shift();
    if (next) {
      next.signal.removeEventListener("abort", next.abort);
      next.resolve();
    } else running--;
  }
  function tenant(userId) {
    if (tenants.has(userId)) return tenants.get(userId);
    // IDs originate exclusively from our registry, never from a URL/body.
    if (!/^[a-f0-9-]{36}$/.test(userId))
      throw Error("Invalid internal account ID");
    const account = registry.account(userId);
    const wrap =
      (fn) =>
      async (...args) => {
        const context = args.pop();
        const signal = args.at(-1);
        await acquire(signal);
        try {
          registry.account(userId);
          registry.authenticate(registry.token({ id: context.deviceId }));
          if (!limits.enabled || registry.aiPaused())
            throw new SyncError(503, "AI_DISABLED", "服务端 AI 已暂停");
          return await fn(...args, { maxOutputTokens: limits.maxOutputTokens });
        } finally {
          release();
        }
      };
    const service = createSyncService({
      database: join(directory, "users", userId, "workspace.sqlite"),
      password: randomBytes(32).toString("base64url"),
      origin,
      ai: ai
        ? {
            ...(ai.organize ? { organize: wrap(ai.organize) } : {}),
            ...(ai.chat ? { chat: wrap(ai.chat) } : {}),
          }
        : null,
      fileLimits: {
        maxWorkspaceBytes: Math.max(1, account.limits.storageBytes),
      },
      jobHooks: {
        authorize: (deviceId) =>
          registry.authenticate(registry.token({ id: deviceId })),
        reserve(id, fingerprint, packet, request) {
          const payload = JSON.stringify({
            packet,
            instruction: request.instruction,
          });
          if (Buffer.byteLength(payload) > limits.maxInputBytes)
            throw new SyncError(
              413,
              "AI_INPUT_LIMIT",
              "AI 输入超过限制，请缩减材料",
            );
          registry.reserve(userId, id, fingerprint, limits);
        },
        release: (id) => registry.release(userId, id),
        finish: (id, state) => registry.finish(userId, id, state),
      },
    });
    // Also check queued work and result application against the authoritative
    // registry, so disabling/revoking takes effect without restarting a tenant.
    const apply = service.store.apply.bind(service.store);
    service.store.apply = (deviceId, ...args) => {
      registry.authenticate(registry.token({ id: deviceId }));
      return apply(deviceId, ...args);
    };
    const storedBytes = () => {
      const db = service.store.db;
      return db
        .prepare(
          `SELECT
        (SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) FROM sync_records) +
        (SELECT COALESCE(SUM(size),0) FROM sync_blobs) +
        (SELECT COALESCE(SUM(length(CAST(request AS BLOB))+COALESCE(length(CAST(output AS BLOB)),0)),0) FROM sync_jobs) +
        (SELECT COUNT(*)*256 FROM sync_operations) AS n`,
        )
        .get().n;
    };
    function checkStorage(delta) {
      if (storedBytes() + delta > registry.account(userId).limits.storageBytes)
        throw new SyncError(
          413,
          "STORAGE_QUOTA",
          "账号存储空间已满，请保留本地资料或联系管理员",
        );
    }
    service.store.validateStorage = (next, current) =>
      checkStorage(
        Buffer.byteLength(JSON.stringify(next)) -
          Buffer.byteLength(JSON.stringify(current?.data || null)) +
          256,
      );
    service.store.validateBlobStorage = checkStorage;
    tenants.set(userId, service);
    for (const row of registry.db
      .prepare(
        "SELECT job_id FROM ai_usage WHERE user_id=? AND state='pending'",
      )
      .all(userId)) {
      const job = service.jobs.get(row.job_id);
      if (!job || !["queued", "running", "applying"].includes(job.state))
        registry.finish(userId, row.job_id, job?.state || "interrupted");
    }
    service.jobs.start();
    return service;
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.origin && req.headers.origin !== origin)
        throw new SyncError(403, "UNTRUSTED_ORIGIN", "请求来源不受信任");
      if (req.url === "/api/v3/status" && req.method === "GET") {
        send(res, 200, {
          application: "shixu-sync",
          version: "0.3.0",
          protocolVersion: 3,
          schemaVersion: 1,
          capabilities: {
            accounts: true,
            wechatLogin: !!wechat,
            attachments: true,
            aiOrganize:
              !!ai?.organize && limits.enabled && !registry.aiPaused(),
            itemChat: !!ai?.chat && limits.enabled && !registry.aiPaused(),
          },
        });
        return;
      }
      const activation =
        req.url === "/api/v3/activate/windows" ||
        req.url === "/api/v3/activate/wechat";
      if (activation && req.method === "POST") {
        // Do not trust X-Forwarded-For. The reverse proxy must preserve a trusted
        // loopback boundary; this conservative limit is shared behind a proxy.
        registry.rate("activation:" + req.socket.remoteAddress, 20);
        const bytes = await body(req, 8000),
          value = parse(req, bytes);
        let binding;
        if (req.url.endsWith("/windows")) {
          if (
            typeof value.publicKey !== "string" ||
            value.publicKey.length > 1000
          )
            throw new SyncError(400, "INVALID_KEY", "设备公钥无效");
          verifyWindowsProof(
            value.publicKey,
            req.method,
            req.url,
            bytes,
            req.headers,
          );
          const key = createPublicKey(value.publicKey)
            .export({ type: "spki", format: "pem" })
            .toString();
          binding = registry.bind(value.invite, "windows", digest(key), key);
        } else {
          if (!wechat)
            throw new SyncError(503, "WECHAT_NOT_READY", "微信登录尚未配置");
          if (
            typeof value.code !== "string" ||
            !value.code ||
            value.code.length > 256
          )
            throw new SyncError(400, "INVALID_LOGIN", "请重新微信登录");
          // The adapter must exchange wx.login's code on the server. Never accept
          // an openid, platform label or AppSecret supplied by a client.
          const openid = await wechat(value.code);
          if (typeof openid !== "string" || !openid || openid.length > 256)
            throw new SyncError(401, "INVALID_LOGIN", "微信身份验证失败");
          binding = registry.bind(value.invite, "wechat", digest(openid));
        }
        const service = tenant(binding.user_id);
        if (!service.store.authenticate(binding.token))
          service.store.createDevice(binding.kind, Date.now(), {
            id: binding.id,
            token: binding.token,
            expiresAt: binding.expires,
          });
        send(res, 201, {
          userId: binding.user_id,
          deviceId: binding.id,
          token: binding.token,
          expiresAt: binding.expires,
          epoch: service.store.epoch,
          protocolVersion: 3,
        });
        return;
      }
      // v2 enrollment and all v2 data endpoints are inaccessible in account mode.
      if (!req.url.startsWith("/api/v3/"))
        throw new SyncError(404, "NOT_FOUND", "没有这个接口");
      if (
        !/^\/api\/v3\/(account|device|changes|operations|jobs(?:\/[a-zA-Z0-9_-]{1,120})?|attachments\/[a-zA-Z0-9_-]{1,120}\/[a-zA-Z0-9_-]{1,120})$/.test(
          req.url.split("?")[0],
        )
      )
        throw new SyncError(404, "NOT_FOUND", "没有这个接口");
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      const binding = registry.authenticate(token),
        account = registry.account(binding.user_id);
      registry.rate(
        "account:" + binding.user_id,
        account.limits.requestsPerMinute,
      );
      const bytes = await body(
        req,
        req.method === "PUT" ? 10 * 1024 * 1024 : 1000000,
      );
      registry.authenticate(token); // Revocation may happen while bytes arrive.
      if (binding.kind === "windows")
        registry.proof(binding, req.method, req.url, bytes, req.headers);
      const service = tenant(binding.user_id);
      service.files.limits.maxWorkspaceBytes = Math.max(
        1,
        account.limits.storageBytes,
      );
      if (req.url === "/api/v3/account" && req.method === "GET") {
        send(res, 200, {
          userId: account.id,
          activation: "active",
          sync: "ready",
          epoch: service.store.epoch,
          ai: {
            enabled: !!ai && limits.enabled && !registry.aiPaused(),
            dailyLimit: account.limits.dailyJobs,
            usage: registry.usage(account.id),
            resetTimezone: "UTC",
          },
          limits: account.limits,
        });
        return;
      }
      if (req.url === "/api/v3/device" && req.method === "DELETE") {
        registry.revoke(binding.user_id, binding.kind);
        service.store.revokeDevice(binding.id);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "PUT" && !account.limits.storageBytes)
        throw new SyncError(413, "STORAGE_QUOTA", "附件空间已暂停");
      // Replay already bounded bytes into the existing protocol handler. Every
      // handler is reached only after account auth and routed to that account DB.
      const inner = Readable.from(bytes.length ? [bytes] : []);
      Object.assign(inner, {
        method: req.method,
        url: req.url.replace(/^\/api\/v3\//, "/api/v2/"),
        headers: req.headers,
        socket: req.socket,
      });
      // The legacy enrollment handler must never be reachable through the router.
      if (
        inner.url.split("?")[0] === "/api/v2/devices" ||
        inner.url.split("?")[0] === "/api/v2/status"
      )
        throw new SyncError(404, "NOT_FOUND", "没有这个接口");
      service.server.emit("request", inner, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      send(res, error instanceof SyncError ? error.status : 500, {
        code: error instanceof SyncError ? error.code : "INTERNAL_ERROR",
        error:
          error instanceof SyncError
            ? error.message
            : "服务暂时不可用，本地内容已保留",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  // Resume durable queued work even if a user has not opened their client yet.
  for (const row of registry.db
    .prepare("SELECT DISTINCT user_id FROM ai_usage WHERE state='pending'")
    .all()) {
    try {
      tenant(row.user_id);
    } catch {
      registry.db
        .prepare(
          "UPDATE ai_usage SET state='interrupted' WHERE user_id=? AND state='pending'",
        )
        .run(row.user_id);
    }
  }
  server.on("close", () => {
    closed = true;
    for (const service of tenants.values()) {
      service.jobs.stop();
      service.store.close();
    }
    for (const entry of waiting.splice(0)) {
      entry.signal.removeEventListener("abort", entry.abort);
      entry.reject(Error("Stopped"));
    }
    registry.close();
  });
  return { server, registry, limits };
}

export function wechatCodeExchange(appId, appSecret, fetcher = fetch) {
  return async (code) => {
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.search = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: "authorization_code",
    }).toString();
    // Do not log URL, code, session_key, openid or the upstream response.
    try {
      const response = await fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      const value = await response.json();
      if (!response.ok || value.errcode || typeof value.openid !== "string")
        throw Error();
      return value.openid;
    } catch {
      throw new SyncError(401, "INVALID_LOGIN", "微信登录验证失败，请重新登录");
    }
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.umask(0o077);
  const { server } = createMultiUserService({
    directory: resolve(process.env.SYNC_ACCOUNT_DIR || "data/accounts-v3"),
    secret: process.env.SYNC_ACCOUNT_SECRET,
    origin: process.env.SYNC_ORIGIN || "https://sync.shixunote.top",
    ai:
      process.env.SYNC_AI_ENABLED === "true" && process.env.DEEPSEEK_API_KEY
        ? createServerAI({
            apiKey: process.env.DEEPSEEK_API_KEY,
            model: process.env.DEEPSEEK_MODEL,
          })
        : null,
    aiLimits: {
      enabled: process.env.SYNC_AI_ENABLED === "true",
      concurrency: Number(process.env.SYNC_AI_CONCURRENCY || 2),
      queueLength: Number(process.env.SYNC_AI_QUEUE_LENGTH || 20),
      maxInputBytes: Number(process.env.SYNC_AI_MAX_INPUT_BYTES || 24000),
      maxOutputTokens: Number(process.env.SYNC_AI_MAX_OUTPUT_TOKENS || 1024),
      taskBudgetMicros: Number(process.env.SYNC_AI_TASK_BUDGET_MICROS || 0),
      dailyBudgetMicros: Number(process.env.SYNC_AI_DAILY_BUDGET_MICROS || 0),
    },
    wechat:
      process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET
        ? wechatCodeExchange(
            process.env.WECHAT_APP_ID,
            process.env.WECHAT_APP_SECRET,
          )
        : null,
  });
  server.listen(Number(process.env.SYNC_PORT || 8788), "127.0.0.1");
  const stop = () => server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
