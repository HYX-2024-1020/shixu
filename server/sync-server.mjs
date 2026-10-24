import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SyncStore, SyncError } from "./sync-store.mjs";

function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(JSON.stringify(value));
}
async function readJSON(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new SyncError(415, "JSON_REQUIRED", "请使用 JSON 请求");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1000000)
      throw new SyncError(413, "TOO_LARGE", "同步请求超过大小限制");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new SyncError(400, "INVALID_JSON", "同步请求不是有效的 JSON 对象");
  }
}
const digest = (value) => createHash("sha256").update(value).digest();

export function createSyncService({
  database,
  password,
  origin = "http://127.0.0.1:8788",
  appId = "wx03d8b4c63a26177c",
}) {
  if (typeof password !== "string" || password.length < 12)
    throw new Error("独立同步服务需要至少 12 位的 SYNC_PASSWORD");
  const parsedOrigin = new URL(origin);
  if (
    origin !== parsedOrigin.origin ||
    !["http:", "https:"].includes(parsedOrigin.protocol)
  )
    throw new Error("SYNC_ORIGIN 必须是无路径的 HTTP 或 HTTPS 来源");
  const store = new SyncStore(database);
  const failures = new Map();
  const passwordHash = digest(password);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      // Device tokens, rather than browser cookies, authorize this API. Requests
      // from native clients need not send Origin; browsers must use the origin.
      if (req.headers.origin && req.headers.origin !== origin)
        throw new SyncError(403, "UNTRUSTED_ORIGIN", "请求来源不受信任");
      if (url.pathname === "/api/v2/status" && req.method === "GET") {
        json(res, 200, {
          application: "shixu-sync",
          version: "0.1.0",
          protocolVersion: 2,
          schemaVersion: 1,
          appId,
          epoch: store.epoch,
          capabilities: {
            textSync: true,
            aiOrganize: false,
            attachments: false,
            wechatLogin: false,
          },
        });
        return;
      }
      if (url.pathname === "/api/v2/devices" && req.method === "POST") {
        const address = req.socket.remoteAddress || "local";
        const now = Date.now(),
          windowMs = 15 * 60 * 1000;
        for (const [key, entry] of failures)
          if (now - entry.at > windowMs) failures.delete(key);
        if (failures.get(address)?.count >= 8 || failures.size >= 2048)
          throw new SyncError(429, "LOGIN_LIMIT", "尝试次数较多，请稍后再试");
        const value = await readJSON(req);
        if (
          typeof value.password !== "string" ||
          !timingSafeEqual(digest(value.password), passwordHash)
        ) {
          const previous = failures.get(address);
          failures.set(address, { count: (previous?.count || 0) + 1, at: now });
          throw new SyncError(401, "BAD_PASSWORD", "访问口令不正确");
        }
        failures.delete(address);
        json(res, 201, store.createDevice(value.name));
        return;
      }
      if (!url.pathname.startsWith("/api/v2/"))
        throw new SyncError(404, "NOT_FOUND", "没有这个接口");
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      const device = store.authenticate(token);
      if (!device)
        throw new SyncError(
          401,
          "UNAUTHORIZED",
          "设备授权已失效，请重新连接，未同步内容仍保存在本机",
        );
      if (url.pathname === "/api/v2/changes" && req.method === "GET") {
        const cursor = url.searchParams.get("cursor");
        if (cursor !== null && !/^\d+$/.test(cursor))
          throw new SyncError(400, "INVALID_CURSOR", "同步游标无效");
        json(
          res,
          200,
          store.pull({
            cursor: Number(cursor || 0),
            epoch: url.searchParams.get("epoch"),
            limit: url.searchParams.has("limit")
              ? Number(url.searchParams.get("limit"))
              : 100,
          }),
        );
        return;
      }
      if (url.pathname === "/api/v2/operations" && req.method === "POST") {
        const { epoch, operation } = await readJSON(req);
        json(res, 200, store.apply(device.id, operation, epoch));
        return;
      }
      if (url.pathname === "/api/v2/device" && req.method === "DELETE") {
        store.revokeDevice(device.id);
        json(res, 200, { ok: true });
        return;
      }
      throw new SyncError(404, "NOT_FOUND", "没有这个接口或请求方法");
    } catch (error) {
      if (error instanceof SyncError)
        json(res, error.status, {
          error: error.message,
          code: error.code,
          ...error.details,
        });
      else
        json(res, 500, {
          error: "同步服务暂时无法完成请求，请保留本机内容后重试",
          code: "INTERNAL_ERROR",
        });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => store.close());
  return { server, store };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.umask(0o077);
  const host = process.env.SYNC_HOST || "127.0.0.1";
  const port = Number(process.env.SYNC_PORT || 8788);
  const origin = process.env.SYNC_ORIGIN || `http://127.0.0.1:${port}`;
  if (
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    !origin.startsWith("https://")
  )
    throw new Error("公网同步服务必须通过 HTTPS 正式域名访问");
  const { server } = createSyncService({
    database: join(
      resolve(process.env.SYNC_DATA_DIR || "data/sync-v2"),
      "workspace.sqlite",
    ),
    password: process.env.SYNC_PASSWORD,
    origin,
    appId: process.env.WECHAT_APP_ID || "wx03d8b4c63a26177c",
  });
  server.listen(port, host, () =>
    console.log(`拾序独立同步服务已启动：${origin}`),
  );
  const stop = () => server.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
