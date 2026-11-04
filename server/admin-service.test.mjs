import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { createAdminService, hashAdminPassword } from "./admin-service.mjs";

const username = "test-admin";
const password = "synthetic-admin-password";
const passwordHash = await hashAdminPassword(password);

async function start(t, options = {}) {
  const events = [];
  const service = createAdminService({ username, passwordHash, audit: (event) => events.push(event), ...options });
  const origin = await service.listen(0);
  t.after(() => service.close());
  const request = (path, { method = "GET", body, cookie, csrf, headers = {} } = {}) => fetch(origin + path, {
    method, headers: {
      ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual",
  });
  const login = async () => {
    const response = await request("/admin/v1/login", { method: "POST", body: { username, password } });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get("set-cookie").split(";")[0], session: await response.json(), response };
  };
  return { service, origin, request, login, events };
}

test("administrator credentials are explicit and loopback origins cannot be expanded", () => {
  assert.throws(() => createAdminService(), /INVALID_ADMIN_CONFIG/);
  assert.throws(() => createAdminService({ username, passwordHash: "admin-demo" }), /INVALID_ADMIN_CONFIG/);
  for (const origin of ["http://0.0.0.0:8789", "https://example.com", "http://localhost:8789/path", "http://user@localhost:8789"])
    assert.throws(() => createAdminService({ username, passwordHash, origin }), /INVALID_ADMIN_ORIGIN/);
});

test("real sign-in, CSRF rejection, logout and audit never expose credentials", async (t) => {
  const { service, request, login, events } = await start(t);
  assert.equal(service.server.address().address, "127.0.0.1");
  const anonymous = await request("/admin/v1/session");
  assert.equal(await anonymous.json(), null);
  assert.equal(anonymous.headers.has("set-cookie"), false);
  assert.equal((await request("/admin/v1/overview")).status, 401);
  const wrong = await request("/admin/v1/login", { method: "POST", body: { username, password: "wrong" } });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, "账号或密码不正确");
  const auth = await login();
  assert.match(auth.response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.match(auth.response.headers.get("set-cookie"), /Path=\/admin\/v1/);
  assert.equal(auth.response.headers.get("cache-control"), "no-store");
  assert.equal((await (await request("/admin/v1/session", { cookie: auth.cookie })).json()).csrfToken, auth.session.csrfToken);
  assert.equal((await request("/admin/v1/logout", { method: "POST", cookie: auth.cookie, body: {} })).status, 403);
  assert.equal((await request("/admin/v1/logout", {
    method: "POST", cookie: auth.cookie, csrf: auth.session.csrfToken, body: {}, headers: { Origin: "http://evil.example" },
  })).status, 403);
  assert.equal((await request("/admin/v1/logout", {
    method: "POST", cookie: auth.cookie, csrf: auth.session.csrfToken, body: {},
  })).status, 204);
  assert.equal(await (await request("/admin/v1/session", { cookie: auth.cookie })).json(), null);
  assert.equal((await request("/admin/v1/overview", { cookie: auth.cookie })).status, 401);
  assert.deepEqual(events.map((e) => e.event), ["login-failed", "login-success", "logout"]);
  const log = JSON.stringify(events);
  for (const secret of [password, passwordHash, auth.cookie, auth.session.csrfToken]) assert.equal(log.includes(secret), false);
});

test("expiry, cookie rotation and duplicate cookies cannot reuse a session", async (t) => {
  let current = Date.now();
  const { request, login } = await start(t, { now: () => current, sessionTtlMs: 1000 });
  const first = await login();
  const response = await request("/admin/v1/login", { method: "POST", cookie: first.cookie, body: { username, password } });
  assert.equal(response.status, 200);
  const second = response.headers.get("set-cookie").split(";")[0];
  assert.notEqual(second, first.cookie);
  assert.equal(await (await request("/admin/v1/session", { cookie: first.cookie })).json(), null);
  assert.equal(await (await request("/admin/v1/session", { cookie: `${second}; ${first.cookie}` })).json(), null);
  current += 1001;
  assert.equal(await (await request("/admin/v1/session", { cookie: second })).json(), null);
});

test("origin, fetch-site and Host checks apply to unauthenticated requests too", async (t) => {
  const { request, origin } = await start(t);
  for (const headers of [{ Origin: "http://evil.example" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const response = await request("/admin/v1/session", { headers });
    assert.equal(response.status, 403);
    assert.equal(response.headers.has("access-control-allow-origin"), false);
  }
  // fetch normalizes Host; use the wire-level client for the rebinding case.
  const hostStatus = await new Promise((done, reject) => {
    const req = httpRequest(origin + "/admin/v1/session", { headers: { Host: "evil.example" } }, (res) => {
      res.resume();
      res.once("end", () => done(res.statusCode));
    });
    req.once("error", reject);
    req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await request("/admin/v1/login", { method: "POST", body: { username, password }, headers: { Origin: "" } })).status, 403);
});

test("bounded login hashing and rate limit survive concurrent requests", async (t) => {
  let current = Date.now();
  const { request } = await start(t, { now: () => current });
  const submit = () => request("/admin/v1/login", { method: "POST", body: { username, password: "incorrect" } });
  const concurrent = await Promise.all([submit(), submit()]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [401, 503]);
  for (let i = 0; i < 3; i++) assert.equal((await submit()).status, 401);
  const limited = await submit();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  current += 60_001;
  assert.equal((await submit()).status, 401);
});

test("oversize and unsupported bodies fail before credential verification", async (t) => {
  const { request, origin } = await start(t);
  assert.equal((await request("/admin/v1/login", { method: "POST", body: { username, password: "x".repeat(9000) } })).status, 413);
  assert.equal((await request("/admin/v1/login", { method: "POST", body: [], headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await request("/admin/v1/login", { method: "POST", body: [] })).status, 400);
  const malformed = await fetch(origin + "/admin/v1/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
});

test("only management assets are served and data APIs remain unavailable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-admin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "admin"));
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "admin/index.html"), "<h1>Admin test</h1>");
  await writeFile(join(directory, "assets/test.js"), "console.log('synthetic')");
  await writeFile(join(directory, ".env"), "SYNTHETIC_PRIVATE_VALUE");
  const { request, login } = await start(t, { staticDirectory: directory });
  const redirect = await request("/admin/");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/admin/?api=http");
  assert.match(await (await request("/admin/?api=http")).text(), /Admin test/);
  assert.equal((await request("/assets/test.js")).status, 200);
  for (const path of ["/.env", "/assets/../.env", "/index.html", "/api/v3/usage"])
    assert.equal((await request(path)).status, 404);
  const { cookie } = await login();
  for (const path of ["/admin/v1/overview", "/admin/v1/users"])
    assert.equal((await request(path, { cookie })).status, 503);
  for (const path of ["/admin/v1/originals", "/admin/v1/export", "/admin/v1/audit/delete"])
    assert.equal((await request(path, { cookie })).status, 404);
});

test("static asset symlinks cannot escape the selected build directory", { skip: process.platform === "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-admin-link-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(directory, "private.js"), "SYNTHETIC_PRIVATE_VALUE");
  await symlink(join(directory, "private.js"), join(root, "assets/leak.js"));
  const { request } = await start(t, { staticDirectory: root });
  assert.equal((await request("/assets/leak.js")).status, 404);
});
