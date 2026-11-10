import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const SCHEME = "scrypt:131072:8:1:64";
const HASH_PATTERN = /^scrypt:131072:8:1:64:[a-f0-9]{32}:[a-f0-9]{128}$/;
const COOKIE = "shixu_admin_session";
const MAX_BODY = 8192;
const digest = (value) => createHash("sha256").update(value).digest();
const key = () => randomBytes(32).toString("base64url");
const failure = (status, code, message, retryable = false) =>
  Object.assign(new Error(message), { status, code, retryable });

async function passwordKey(password, salt) {
  return derive(password, salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
}

// Provisioning helper. Passwords are never accepted through CLI arguments.
export async function hashAdminPassword(password) {
  if (typeof password !== "string" || [...password].length < 12 || [...password].length > 128)
    throw Error("ADMIN_PASSWORD_POLICY");
  const salt = randomBytes(16).toString("hex");
  return `${SCHEME}:${salt}:${(await passwordKey(password, salt)).toString("hex")}`;
}

function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? ""))
    throw failure(415, "JSON_REQUIRED", "请使用 JSON 请求");
  return new Promise((done, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      if (bytes > MAX_BODY) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        chunks.length = 0;
        reject(failure(413, "REQUEST_TOO_LARGE", "请求内容过大"));
      } else chunks.push(chunk);
    });
    req.once("end", () => {
      if (bytes > MAX_BODY) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
        done(value);
      } catch {
        reject(failure(400, "INVALID_JSON", "请求内容无效"));
      }
    });
    req.once("error", reject);
    req.once("aborted", () =>
      reject(failure(400, "REQUEST_ABORTED", "请求已中断")),
    );
  });
}

function sessionCookie(req) {
  const values = (req.headers.cookie ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  // Ambiguous cookies cannot choose an authenticated identity.
  return values.length === 1 ? values[0].slice(COOKIE.length + 1) : "";
}

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.origin !== value || url.username || url.password)
    throw Error("INVALID_ADMIN_ORIGIN");
  return value;
}

const MIME = {
  js: "text/javascript",
  css: "text/css",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
  svg: "image/svg+xml",
};

/** Independent loopback HTTP listener. No account, tenant or ledger is opened. */
export function createAdminService({
  username,
  passwordHash,
  origin,
  staticDirectory,
  sessionTtlMs = 30 * 60_000,
  now = Date.now,
  audit = (event) => console.info(JSON.stringify(event)),
  backend = null,
} = {}) {
  if (typeof username !== "string" || !/^[\w.-]{3,64}$/.test(username) ||
      typeof passwordHash !== "string" || !HASH_PATTERN.test(passwordHash) ||
      !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || sessionTtlMs > 8 * 3600_000 ||
      typeof now !== "function" || typeof audit !== "function")
    throw Error("INVALID_ADMIN_CONFIG");
  const configuredOrigin = origin === undefined ? null : localOrigin(origin);
  const root = staticDirectory ? realpathSync.native(resolve(staticDirectory)) : null;
  const [, , , , , salt, expectedHash] = passwordHash.split(":");
  const expectedUsername = digest(username);
  const sessions = new Map();
  let attempts = [],
    loginBusy = false,
    closed = false,
    closing;
  const record = (event) =>
    audit({
      event,
      actor: event === "login-failed" ? "anonymous" : username,
      at: new Date(now()).toISOString(),
    });
  const cookie = (token, seconds) =>
    `${COOKIE}=${token}; Path=/admin/v1; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
  const publicSession = (session) => ({
    username,
    expiresAt: new Date(session.expires).toISOString(),
    csrfToken: session.csrf,
  });
  const readAsset = async (path) => {
    const file = await realpath(resolve(root, path));
    const inside = relative(root, file);
    if (inside.startsWith("..") || isAbsolute(inside)) throw failure(404, "NOT_FOUND", "页面不存在");
    return readFile(file);
  };

  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    try {
      const address = server.address();
      const expectedOrigin =
        configuredOrigin ?? `http://127.0.0.1:${address.port}`;
      if (
        closed ||
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        ) ||
        req.headers.host !== new URL(expectedOrigin).host ||
        (req.headers.origin && req.headers.origin !== expectedOrigin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw failure(403, "ORIGIN_REJECTED", "管理服务仅接受指定的本机入口");
      if (!req.url.startsWith("/") || req.url.startsWith("//"))
        throw failure(404, "NOT_FOUND", "管理接口不存在");
      const url = new URL(req.url, expectedOrigin);
      const path = url.pathname;
      if (req.method === "POST" && req.headers.origin !== expectedOrigin)
        throw failure(403, "ORIGIN_REJECTED", "请求来源无效，请重新打开管理台");
      for (const [token, session] of sessions) if (session.expires <= now()) sessions.delete(token);
      const token = sessionCookie(req);
      const session = sessions.get(token);

      if (path === "/admin/v1/login" && req.method === "POST") {
        attempts = attempts.filter((at) => at > now() - 60_000);
        if (attempts.length >= 5) {
          res.setHeader("Retry-After", "60");
          throw failure(
            429,
            "LOGIN_RATE_LIMIT",
            "登录尝试较多，请一分钟后重试",
            true,
          );
        }
        attempts.push(now());
        if (loginBusy) throw failure(503, "LOGIN_BUSY", "登录服务正忙，请稍后重试", true);
        loginBusy = true;
        try {
          const body = await readJson(req);
          if (Object.keys(body).sort().join(",") !== "password,username" ||
              typeof body.username !== "string" || body.username.length > 64 ||
              typeof body.password !== "string" || Buffer.byteLength(body.password) > 1024)
            throw failure(400, "INVALID_LOGIN", "登录请求无效");
          const derived = await passwordKey(body.password, salt);
          const passwordMatches = timingSafeEqual(
            derived,
            Buffer.from(expectedHash, "hex"),
          );
          const usernameMatches = timingSafeEqual(
            digest(body.username),
            expectedUsername,
          );
          if (!passwordMatches || !usernameMatches) {
            await record("login-failed");
            throw failure(401, "UNAUTHORIZED", "账号或密码不正确");
          }
          if (closed) throw failure(503, "SERVICE_CLOSING", "管理服务正在关闭", true);
          await record("login-success");
          if (closed) throw failure(503, "SERVICE_CLOSING", "管理服务正在关闭", true);
          // Reauthentication rotates the cookie. Sessions disappear on restart.
          sessions.delete(token);
          if (sessions.size >= 8) sessions.delete(sessions.keys().next().value);
          const nextToken = key();
          const nextSession = { csrf: key(), expires: now() + sessionTtlMs };
          sessions.set(nextToken, nextSession);
          res.setHeader(
            "Set-Cookie",
            cookie(nextToken, Math.ceil(sessionTtlMs / 1000)),
          );
          json(200, publicSession(nextSession));
        } finally { loginBusy = false; }
        return;
      }
      if (path === "/admin/v1/session" && req.method === "GET") {
        json(200, session ? publicSession(session) : null);
        return;
      }
      if (path.startsWith("/admin/v1/")) {
        if (!session) throw failure(401, "SESSION_EXPIRED", "会话已过期，请重新登录");
        if (req.method === "POST" && req.headers["x-csrf-token"] !== session.csrf)
          throw failure(403, "CSRF_REJECTED", "操作凭据无效，请重新登录");
        if (path === "/admin/v1/logout" && req.method === "POST") {
          const body = await readJson(req);
          if (Object.keys(body).length) throw failure(400, "INVALID_REQUEST", "退出请求无效");
          await record("logout");
          sessions.delete(token);
          res.setHeader("Set-Cookie", cookie("", 0));
          json(204);
          return;
        }
        if (backend) {
          if (req.method === "GET" && path === "/admin/v1/operations") {
            json(200, backend.operationsStatus());
            return;
          }
          if (req.method === "POST" && path === "/admin/v1/operations") {
            const value = await readJson(req);
            if (Object.keys(value).sort().join(",") !== "args,kind")
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              202,
              await backend.requestOperation(
                value,
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/storage") {
            json(200, backend.storage());
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/budget") {
            json(200, backend.budget());
            return;
          }
          if (req.method === "POST" && path === "/admin/v1/budget") {
            const value = await readJson(req);
            if (
              Object.keys(value).sort().join(",") !==
              "dailyMicro,monthlyMicro,reason"
            )
              throw failure(400, "INVALID_BUDGET", "预算内容无效");
            json(
              200,
              await backend.changeBudget(
                value,
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/overview") {
            json(200, backend.overview());
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/users") {
            json(200, backend.users(url.searchParams));
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/alerts") {
            json(200, backend.alerts());
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/audit") {
            json(200, backend.audits());
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/audit/search") {
            json(200, backend.auditSearch(url.searchParams));
            return;
          }
          if (req.method === "GET" && path === "/admin/v1/tasks") {
            json(200, backend.tasks(url.searchParams));
            return;
          }
          const taskAction = /^\/admin\/v1\/tasks\/([\w~-]+)\/actions$/.exec(
            path,
          );
          if (req.method === "POST" && taskAction) {
            const value = await readJson(req);
            if (
              Object.keys(value).sort().join(",") !==
              "action,generation,maintenanceOperation,revision"
            )
              throw failure(400, "INVALID_ACTION", "任务操作内容无效");
            json(
              200,
              await backend.taskAction(
                taskAction[1],
                value,
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          const limit = /^\/admin\/v1\/tasks\/([\w~-]+)\/execution-limit$/.exec(
            path,
          );
          if (req.method === "POST" && limit) {
            const value = await readJson(req);
            if (
              Object.keys(value).sort().join(",") !==
              "generation,newLimitSeconds,reason,watermark"
            )
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              await backend.extendTaskLimit(
                limit[1],
                value,
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          const readAlert = /^\/admin\/v1\/alerts\/(\d{1,20})\/read$/.exec(
            path,
          );
          if (req.method === "POST" && readAlert) {
            const value = await readJson(req);
            if (Object.keys(value).length)
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              backend.markRead(
                readAlert[1],
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          const user = /^\/admin\/v1\/users\/([\w-]+)$/.exec(path);
          if (req.method === "GET" && user) {
            json(200, backend.user(user[1]));
            return;
          }
          const enabled = /^\/admin\/v1\/users\/([\w-]+)\/enabled$/.exec(path);
          if (req.method === "POST" && enabled) {
            const value = await readJson(req);
            if (Object.keys(value).sort().join(",") !== "enabled,reason")
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              await backend.setAccountEnabled(
                enabled[1],
                value.enabled,
                req.headers["x-operation-id"],
                username,
                value.reason,
              ),
            );
            return;
          }
          const topup = /^\/admin\/v1\/users\/([\w-]+)\/topup$/.exec(path);
          if (req.method === "POST" && topup) {
            const value = await readJson(req);
            if (Object.keys(value).sort().join(",") !== "amountMicro,note")
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              await backend.topup(
                topup[1],
                value.amountMicro,
                value.note,
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          const revoke =
            /^\/admin\/v1\/users\/([\w-]+)\/devices\/([\w-]+)\/revoke$/.exec(
              path,
            );
          if (req.method === "POST" && revoke) {
            if (Object.keys(await readJson(req)).length)
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              await backend.revokeDevice(
                revoke[1],
                revoke[2],
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          const reset = /^\/admin\/v1\/users\/([\w-]+)\/password-reset$/.exec(
            path,
          );
          if (req.method === "POST" && reset) {
            if (Object.keys(await readJson(req)).length)
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              await backend.resetPassword(
                reset[1],
                req.headers["x-operation-id"],
                username,
              ),
            );
            return;
          }
          const control =
            /^\/admin\/v1\/(site|users\/([\w-]+))\/(ai-pause|ai-resume)$/.exec(
              path,
            );
          if (req.method === "POST" && control) {
            const body = await readJson(req);
            if (Object.keys(body).some((k) => k !== "reason"))
              throw failure(400, "INVALID_OPERATION", "操作内容无效");
            json(
              200,
              backend.control(
                control[2] || "site",
                control[3] === "ai-pause",
                req.headers["x-operation-id"],
                username,
                body.reason || "",
              ),
            );
            return;
          }
        }
        if (
          req.method === "GET" &&
          ["/admin/v1/overview", "/admin/v1/users"].includes(path)
        )
          throw failure(
            503,
            "ADMIN_BACKEND_UNAVAILABLE",
            "管理数据接口尚未接入，请稍后重试",
            true,
          );
        throw failure(404, "NOT_FOUND", "管理接口不存在");
      }
      if (req.method === "GET" && path === "/admin/" && root) {
        if (url.searchParams.get("api") !== "http") {
          res.writeHead(302, { Location: "/admin/?api=http" });
          res.end();
          return;
        }
        const bytes = await readAsset("admin/index.html");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(bytes);
        return;
      }
      if (
        req.method === "GET" &&
        root &&
        (/^\/assets\/[\w.-]+\.(js|css|woff2?)$/.test(path) ||
          [
            "/fonts/NotoSansSC.ttf",
            "/fonts/SpaceGrotesk.ttf",
            "/desktop-icon.svg",
          ].includes(path))
      ) {
        const bytes = await readAsset(`.${path}`);
        res.writeHead(200, { "Content-Type": MIME[path.split(".").at(-1)] });
        res.end(bytes);
        return;
      }
      throw failure(404, "NOT_FOUND", "页面不存在");
    } catch (error) {
      req.resume();
      const status = error.status ?? (error.code === "ENOENT" ? 404 : 503);
      if (!res.headersSent) json(status, {
        error: error.status ? error.message : status === 404 ? "页面不存在" : "管理服务暂时不可用",
        code: error.status ? error.code : status === 404 ? "NOT_FOUND" : "ADMIN_UNAVAILABLE",
        retryable: error.retryable ?? status >= 500,
      });
      else res.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  return {
    server,
    async listen(port = 8789) {
      if (closed) throw Error("ADMIN_SERVICE_CLOSED");
      await new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); done(); });
      });
      return configuredOrigin ?? `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      return (closing ??= (async () => {
        closed = true;
        sessions.clear();
        if (server.listening)
          await new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
            server.closeIdleConnections();
          });
      })());
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = createAdminService({
    username: process.env.SHIXU_ADMIN_USERNAME,
    passwordHash: process.env.SHIXU_ADMIN_PASSWORD_HASH,
    origin: process.env.SHIXU_ADMIN_ORIGIN || undefined,
    staticDirectory: resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../dist",
    ),
  });
  await service.listen(Number(process.env.SHIXU_ADMIN_PORT || 8789));
  const stop = () => { service.close().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
