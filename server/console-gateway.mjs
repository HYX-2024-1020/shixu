import { createServer, request } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { realpathSync, readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const boundedBody = (req) =>
  new Promise((done, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      if (size > 8192) return;
      size += chunk.length;
      if (size > 8192) {
        chunks.length = 0;
        reject(Object.assign(Error("REQUEST_TOO_LARGE"), { status: 413 }));
      } else chunks.push(chunk);
    });
    req.once("end", () => {
      if (size <= 8192) done(Buffer.concat(chunks));
    });
    req.once("aborted", () => reject(Error("ABORTED")));
    req.once("error", reject);
  });

// Installed local assets, protected cloud API. This process has no administrator
// verifier, account database, billing writer or personal-content endpoint.
export function createConsoleGateway({
  staticDirectory,
  upstreamOrigin = "http://127.0.0.1:18789",
  release = "source",
} = {}) {
  const root = realpathSync.native(resolve(staticDirectory)),
    upstream = new URL(upstreamOrigin);
  if (
    upstream.origin !== upstreamOrigin ||
    upstream.protocol !== "http:" ||
    upstream.hostname !== "127.0.0.1"
  )
    throw Error("LOOPBACK_UPSTREAM_REQUIRED");
  let closing;
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const json = (status, body) => {
      req.resume();
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      if (
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        ) ||
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site" ||
        (req.method === "POST" && req.headers.origin !== origin)
      )
        return json(403, {
          error: "请求来源无效，请使用桌面控制台入口",
          code: "ORIGIN_REJECTED",
          retryable: false,
        });
      if (!req.url.startsWith("/") || req.url.startsWith("//"))
        return json(404, {
          error: "页面不存在",
          code: "NOT_FOUND",
          retryable: false,
        });
      const url = new URL(req.url, origin),
        path = url.pathname;
      if (req.method === "GET" && path === "/__shixu_console_health")
        return json(200, { application: "shixu-console-gateway", release });
      if (
        path.startsWith("/admin/v1/") &&
        ["GET", "POST"].includes(req.method)
      ) {
        const body = await boundedBody(req),
          headers = { Host: upstream.host };
        for (const key of [
          "cookie",
          "content-type",
          "x-csrf-token",
          "x-operation-id",
        ])
          if (req.headers[key]) headers[key] = req.headers[key];
        if (req.method === "POST") headers.Origin = upstreamOrigin;
        if (body.length) headers["Content-Length"] = String(body.length);
        const proxy = request(
          upstreamOrigin + req.url,
          { method: req.method, headers, timeout: 10000 },
          (response) => {
            const forwarded = {
              "Content-Type":
                response.headers["content-type"] || "application/json",
            };
            for (const key of ["set-cookie", "retry-after"])
              if (response.headers[key]) forwarded[key] = response.headers[key];
            res.writeHead(response.statusCode, forwarded);
            response.pipe(res);
          },
        );
        proxy.on("timeout", () => proxy.destroy());
        proxy.on("error", () => {
          if (!res.headersSent)
            json(503, {
              error: "云端管理连接不可用，请重新双击桌面入口后重试",
              code: "CLOUD_UNAVAILABLE",
              retryable: true,
            });
          else res.end();
        });
        res.once("close", () => {
          if (!res.writableFinished) proxy.destroy();
        });
        proxy.end(body);
        return;
      }
      let asset, type;
      if (req.method === "GET" && path === "/admin/") {
        if (url.searchParams.get("api") !== "http") {
          res.writeHead(302, { Location: "/admin/?api=http" });
          res.end();
          return;
        }
        asset = "admin/index.html";
        type = "text/html; charset=utf-8";
      } else if (
        req.method === "GET" &&
        (/^\/assets\/[\w.-]+\.(js|css|woff2?)$/.test(path) ||
          [
            "/fonts/NotoSansSC.ttf",
            "/fonts/SpaceGrotesk.ttf",
            "/desktop-icon.svg",
            "/console-icon.svg",
          ].includes(path))
      ) {
        asset = "." + path;
        type = {
          js: "text/javascript",
          css: "text/css",
          ttf: "font/ttf",
          woff: "font/woff",
          woff2: "font/woff2",
          svg: "image/svg+xml",
        }[path.split(".").at(-1)];
      } else
        return json(404, {
          error: "页面不存在",
          code: "NOT_FOUND",
          retryable: false,
        });
      const file = await realpath(resolve(root, asset)),
        inside = relative(root, file);
      if (inside.startsWith("..") || isAbsolute(inside))
        return json(404, {
          error: "页面不存在",
          code: "NOT_FOUND",
          retryable: false,
        });
      const bytes = await readFile(file);
      res.writeHead(200, { "Content-Type": type });
      res.end(bytes);
    } catch (error) {
      req.resume();
      if (!res.headersSent)
        json(error.status === 413 ? 413 : 503, {
          error:
            error.status === 413
              ? "请求内容过大"
              : "控制台暂不可用，请重开桌面入口",
          code:
            error.status === 413 ? "REQUEST_TOO_LARGE" : "CONSOLE_UNAVAILABLE",
          retryable: error.status !== 413,
        });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return {
    server,
    async listen(port = 8789) {
      await new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          done();
        });
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      return (closing ??= new Promise((done) => {
        server.close(done);
        server.closeIdleConnections();
      }));
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    file = resolve(root, "installation-manifest.json");
  const gateway = createConsoleGateway({
    staticDirectory: resolve(root, "dist"),
    release: existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8")).fingerprint
      : "source",
  });
  await gateway.listen();
  const close = () => gateway.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
