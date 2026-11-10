import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminService, hashAdminPassword } from "./admin-service.mjs";
import { createConsoleGateway } from "./console-gateway.mjs";

test("installed assets proxy real authentication, CSRF, controls and failure without exposing another origin", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "shixu-console-gateway-"));
  await mkdir(join(root, "admin"));
  await mkdir(join(root, "assets"));
  await writeFile(
    join(root, "admin/index.html"),
    "<html>synthetic installed console</html>",
  );
  await writeFile(join(root, "assets/a.js"), "// synthetic asset");
  let writes = 0;
  const password = "synthetic-admin-password",
    service = createAdminService({
      username: "test-admin",
      passwordHash: await hashAdminPassword(password),
      audit: () => {},
      backend: {
        overview: () => ({ source: "synthetic-upstream" }),
        control: () => {
          writes++;
          return { paused: true };
        },
      },
    });
  const upstream = await service.listen(0),
    gateway = createConsoleGateway({
      staticDirectory: root,
      upstreamOrigin: upstream,
      release: "synthetic",
    }),
    origin = await gateway.listen(0);
  t.after(async () => {
    await gateway.close();
    await service.close();
    await rm(root, { recursive: true, force: true });
  });
  const post = (path, body, headers = {}) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await fetch(origin + "/admin/", { redirect: "manual" })).status,
    302,
  );
  assert.match(
    await (await fetch(origin + "/assets/a.js")).text(),
    /synthetic asset/,
  );
  assert.equal(
    (
      await post(
        "/admin/v1/login",
        { username: "test-admin", password },
        { Origin: "https://untrusted.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await post("/admin/v1/login", { password: "x".repeat(9000) })).status,
    413,
  );
  const login = await post("/admin/v1/login", {
    username: "test-admin",
    password,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0],
    session = await login.json();
  const overview = await fetch(origin + "/admin/v1/overview", {
    headers: { Cookie: cookie },
  });
  assert.deepEqual(await overview.json(), { source: "synthetic-upstream" });
  assert.equal(
    (await post("/admin/v1/site/ai-pause", {}, { Cookie: cookie })).status,
    403,
  );
  assert.equal(writes, 0);
  assert.equal(
    (
      await post(
        "/admin/v1/site/ai-pause",
        {},
        {
          Cookie: cookie,
          "X-CSRF-Token": session.csrfToken,
          "X-Operation-Id": "synthetic-operation",
        },
      )
    ).status,
    200,
  );
  assert.equal(writes, 1);
  assert.equal((await fetch(origin + "/.private/config")).status, 404);
  await service.close();
  const unavailable = await fetch(origin + "/admin/v1/session");
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "CLOUD_UNAVAILABLE");
});
