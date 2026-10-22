import http from "node:http";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  createReadStream,
  statSync,
} from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  organizePacket,
  checkSources,
  DEFAULT_MODEL,
} from "../shared/bucket-engine.mjs";
process.umask(0o077);

const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 8787),
  dataDir = resolve(process.env.DATA_DIR || "data"),
  dist = resolve("dist");
const password = process.env.APP_PASSWORD || "",
  origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  (password.length < 12 ||
    !process.env.APP_ORIGIN ||
    !origin.startsWith("https://"))
)
  throw new Error("公网部署必须设置至少12位APP_PASSWORD和HTTPS的APP_ORIGIN");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const secretPath = join(dataDir, "session.secret");
if (!existsSync(secretPath))
  writeFileSync(secretPath, randomBytes(32), { mode: 0o600 });
const secret = readFileSync(secretPath),
  db = new DatabaseSync(join(dataDir, "bucket.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS packets(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,packet_id TEXT NOT NULL REFERENCES packets(id) ON DELETE CASCADE,name TEXT NOT NULL,body BLOB NOT NULL); CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT NOT NULL)",
);
const getSetting = (id) =>
  db.prepare("SELECT value FROM settings WHERE id=?").get(id)?.value || "";
const setSetting = (id, value) =>
  db
    .prepare(
      "INSERT INTO settings(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .run(id, value);
const apiKey = () => process.env.DEEPSEEK_API_KEY || getSetting("deepseek-key");
const model = () =>
  getSetting("model") || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
const readPacket = (id) => {
  const row = db.prepare("SELECT payload FROM packets WHERE id=?").get(id);
  return row ? JSON.parse(row.payload) : null;
};
const savePacket = (p) =>
  db
    .prepare(
      "INSERT INTO packets(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    )
    .run(p.id, JSON.stringify(p));
const allPackets = () =>
  db
    .prepare("SELECT payload FROM packets")
    .all()
    .map((row) => JSON.parse(row.payload));
for (const p of allPackets())
  if (p.status === "processing") {
    p.status = "pending";
    savePacket(p);
  }
let draining = false;
async function drain() {
  if (draining || !apiKey()) return;
  draining = true;
  try {
    for (;;) {
      const packet = allPackets().find(
        (p) => p.status === "pending" && !p.deletedAt,
      );
      if (!packet) break;
      packet.status = "processing";
      packet.updatedAt = new Date().toISOString();
      savePacket(packet);
      try {
        const result = await organizePacket(packet.sources, {
          apiKey: apiKey(),
          model: model(),
          captureDate: packet.captureDate,
          signal: AbortSignal.timeout(240000),
        });
        const current = readPacket(packet.id);
        if (current && !current.deletedAt) {
          current.result = result;
          current.status = "ready";
          current.error = "";
          current.updatedAt = new Date().toISOString();
          savePacket(current);
        }
      } catch (error) {
        const current = readPacket(packet.id);
        if (current && !current.deletedAt) {
          current.status = "error";
          current.error =
            error.name === "TimeoutError"
              ? "整理超时，内容已保留，可以重试"
              : error.message;
          current.updatedAt = new Date().toISOString();
          savePacket(current);
        }
      }
    }
  } finally {
    draining = false;
  }
}
const signature = (value) =>
  createHmac("sha256", secret).update(value).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function authorized(req) {
  if (!password) return true;
  const cookie =
    req.headers.cookie?.match(/(?:^|;\s*)shixu_session=([^;]+)/)?.[1] || "";
  const [expires, nonce, mac] = cookie.split(".");
  return (
    !!expires &&
    !!nonce &&
    !!mac &&
    Number(expires) > Date.now() &&
    safeEqual(signature(expires + "." + nonce), mac)
  );
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(value));
}
async function body(req, max = 34 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("请求超过大小限制");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  return JSON.parse((await body(req, 200000)).toString("utf8"));
}
const loginFailures = new Map();
const mimes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const url = new URL(req.url, origin);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.headers.origin !== origin) {
        json(res, 403, { error: "来源不受信任，请从个人服务的正式地址打开" });
        return;
      }
      if (url.pathname === "/api/health") {
        json(res, 200, {
          application: "shixu-bucket",
          authenticated: authorized(req),
          needsPassword: !!password,
          modelReady: authorized(req) && !!apiKey(),
          model: authorized(req) ? model() : "",
        });
        return;
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "",
          last = loginFailures.get(ip);
        if (last && last.count >= 8 && Date.now() - last.at < 15 * 60 * 1000) {
          json(res, 429, { error: "尝试次数较多，请15分钟后再试" });
          return;
        }
        const value = await jsonBody(req);
        if (
          password &&
          !safeEqual(
            createHash("sha256")
              .update(String(value.password || ""))
              .digest("hex"),
            createHash("sha256").update(password).digest("hex"),
          )
        ) {
          loginFailures.set(ip, {
            count:
              (last && Date.now() - last.at < 15 * 60 * 1000 ? last.count : 0) +
              1,
            at: Date.now(),
          });
          json(res, 401, { error: "访问口令不正确" });
          return;
        }
        loginFailures.delete(ip);
        const expires = String(Date.now() + 30 * 24 * 60 * 60 * 1000),
          nonce = randomBytes(20).toString("hex"),
          token =
            expires + "." + nonce + "." + signature(expires + "." + nonce);
        json(
          res,
          200,
          { ok: true },
          {
            "Set-Cookie": `shixu_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${origin.startsWith("https:") ? "; Secure" : ""}`,
          },
        );
        return;
      }
      if (!authorized(req)) {
        json(res, 401, { error: "请先输入个人服务的访问口令" });
        return;
      }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        json(
          res,
          200,
          { ok: true },
          {
            "Set-Cookie":
              "shixu_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        );
        return;
      }
      if (url.pathname === "/api/settings" && req.method === "POST") {
        const value = await jsonBody(req);
        let selected =
          typeof value.model === "string" && value.model.length < 100
            ? value.model
            : model();
        if (value.apiKey) {
          if (typeof value.apiKey !== "string" || value.apiKey.length > 300)
            throw new Error("密钥格式不正确");
          const r = await fetch("https://api.deepseek.com/models", {
            headers: { Authorization: `Bearer ${value.apiKey}` },
            signal: AbortSignal.timeout(20000),
          });
          if (!r.ok) {
            json(res, r.status === 401 ? 401 : 502, {
              error: "DeepSeek 密钥校验失败，请检查密钥与网络",
            });
            return;
          }
          const payload = await r.json();
          const available = Array.isArray(payload.data)
            ? payload.data
                .map((m) => m.id)
                .filter((id) => typeof id === "string")
            : [];
          if (available.length && !available.includes(selected))
            selected = available.includes(DEFAULT_MODEL)
              ? DEFAULT_MODEL
              : available.includes("deepseek-chat")
                ? "deepseek-chat"
                : available[0];
          setSetting("deepseek-key", value.apiKey.trim());
        }
        setSetting("model", selected);
        json(res, 200, { ok: true, modelReady: !!apiKey(), model: model() });
        void drain();
        return;
      }
      if (url.pathname === "/api/packets" && req.method === "GET") {
        json(res, 200, {
          packets: allPackets().sort((a, b) =>
            b.capturedAt.localeCompare(a.capturedAt),
          ),
        });
        return;
      }
      if (url.pathname === "/api/packets" && req.method === "POST") {
        const buffer = await body(req);
        const request = new Request(origin + url.pathname, {
          method: "POST",
          headers: { "Content-Type": req.headers["content-type"] || "" },
          body: buffer,
        });
        const form = await request.formData(),
          raw = form.get("packet");
        if (typeof raw !== "string") throw new Error("缺少投递内容");
        const p = JSON.parse(raw);
        if (
          !/^[a-zA-Z0-9-]{1,100}$/.test(p.id) ||
          typeof p.text !== "string" ||
          p.text.length > 60000 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(p.captureDate) ||
          Number.isNaN(Date.parse(p.capturedAt))
        )
          throw new Error("投递格式不正确");
        checkSources(p.sources);
        const existing = readPacket(p.id);
        if (existing) {
          json(res, 200, { packet: existing });
          return;
        }
        if (!Array.isArray(p.attachments) || p.attachments.length > 8)
          throw new Error("附件数量不正确");
        const fileRows = [];
        let total = 0;
        for (const a of p.attachments) {
          const f = form.get("file:" + a.id);
          if (
            !/^[a-zA-Z0-9-]{1,100}$/.test(a.id) ||
            !f ||
            typeof f === "string" ||
            f.size > 15 * 1024 * 1024 ||
            typeof a.name !== "string" ||
            a.name.length > 200
          )
            throw new Error("附件格式不正确");
          total += f.size;
          if (total > 24 * 1024 * 1024) throw new Error("附件合计不能超过24MB");
          fileRows.push({
            id: a.id,
            name: a.name,
            size: f.size,
            type: f.type,
            bytes: Buffer.from(await f.arrayBuffer()),
          });
        }
        const packet = {
          id: p.id,
          text: p.text,
          sources: p.sources,
          attachments: fileRows.map(({ bytes, ...a }) => a),
          capturedAt: p.capturedAt,
          captureDate: p.captureDate,
          status: "pending",
          result: null,
          error: "",
          doneIds: [],
          updatedAt: new Date().toISOString(),
          remote: true,
        };
        db.exec("BEGIN");
        try {
          savePacket(packet);
          for (const f of fileRows)
            db.prepare(
              "INSERT INTO files(id,packet_id,name,body) VALUES(?,?,?,?)",
            ).run(f.id, p.id, f.name, f.bytes);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        json(res, 202, { packet });
        void drain();
        return;
      }
      const packetRoute = url.pathname.match(
        /^\/api\/packets\/([a-zA-Z0-9-]{1,100})(?:\/(retry|done))?$/,
      );
      if (packetRoute) {
        const p = readPacket(packetRoute[1]);
        if (!p) {
          json(res, 404, { error: "没有找到这次投递" });
          return;
        }
        if (req.method === "POST" && packetRoute[2] === "retry") {
          if (p.status === "error") {
            p.status = "pending";
            p.error = "";
            p.updatedAt = new Date().toISOString();
            savePacket(p);
            void drain();
          }
          json(res, 200, { packet: p });
          return;
        }
        if (req.method === "POST" && packetRoute[2] === "done") {
          const value = await jsonBody(req);
          p.doneIds = Array.isArray(value.doneIds)
            ? value.doneIds.filter(
                (i) =>
                  Number.isInteger(i) &&
                  i >= 0 &&
                  i < (p.result?.items.length || 0),
              )
            : [];
          p.updatedAt = new Date().toISOString();
          savePacket(p);
          json(res, 200, { packet: p });
          return;
        }
        if (req.method === "DELETE") {
          const at = new Date().toISOString(),
            tombstone = {
              id: p.id,
              text: "",
              sources: [],
              attachments: [],
              capturedAt: p.capturedAt,
              captureDate: p.captureDate,
              status: "ready",
              result: null,
              error: "",
              doneIds: [],
              updatedAt: at,
              deletedAt: at,
              remote: true,
            };
          db.exec("BEGIN");
          try {
            db.prepare("DELETE FROM files WHERE packet_id=?").run(p.id);
            savePacket(tombstone);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
          json(res, 200, { packet: tombstone });
          return;
        }
      }
      const fileRoute = url.pathname.match(
        /^\/api\/attachments\/([a-zA-Z0-9-]{1,100})$/,
      );
      if (fileRoute && req.method === "GET") {
        const file = db
          .prepare("SELECT name,body FROM files WHERE id=?")
          .get(fileRoute[1]);
        if (!file) {
          json(res, 404, { error: "没有找到原文件" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "Cache-Control": "no-store",
        });
        res.end(Buffer.from(file.body));
        return;
      }
      json(res, 404, { error: "没有这个接口" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    if (
      pathname.split("/").some((part) => part.startsWith(".")) ||
      pathname.includes("\0")
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    let file = resolve(dist, "." + pathname);
    if (!file.startsWith(dist + sep) && file !== dist) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile())
      file = join(dist, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503);
      res.end("请先运行 npm run build");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimes[extname(file)] || "application/octet-stream",
      "Cache-Control":
        file.endsWith("sw.js") || file.endsWith("index.html")
          ? "no-cache"
          : url.pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : "请求失败",
    });
  }
});
server.requestTimeout = 300000;
server.listen(port, host, () =>
  console.log(`拾序个人服务已启动：${origin}（数据目录不纳入Git）`),
);
setInterval(() => {
  void drain();
}, 10000).unref();
void drain();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
