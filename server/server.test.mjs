import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const port = 19878,
  origin = `http://127.0.0.1:${port}`,
  data = resolve(".private/server-tests/" + Date.now());
mkdirSync(data, { recursive: true });
let child;
async function start() {
  child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_ORIGIN: origin,
      APP_PASSWORD: "fixture-personal-passphrase",
      DEEPSEEK_API_KEY: "",
      DATA_DIR: data,
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Test server did not start");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
}
test("personal API requires auth and origin; preserves files and queue across restart", async () => {
  await start();
  try {
    assert.equal((await fetch(origin + "/api/packets")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/login", {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: "fixture-personal-passphrase" }),
        })
      ).status,
      403,
    );
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "fixture-personal-passphrase" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
    const packet = {
      id: "fixture-packet",
      text: "明天交报告",
      sources: [
        { id: "input", name: "随手输入", text: "明天交报告" },
        { id: "fixture-file", name: "teacher.txt", text: "报告不少于2000字" },
      ],
      attachments: [{ id: "fixture-file", name: "teacher.txt" }],
      capturedAt: new Date().toISOString(),
      captureDate: "2026-10-22",
    };
    const form = new FormData();
    form.append("packet", JSON.stringify(packet));
    form.append(
      "file:fixture-file",
      new Blob(["报告不少于2000字"]),
      "teacher.txt",
    );
    const created = await fetch(origin + "/api/packets", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
    assert.equal(created.status, 202);
    assert.equal((await created.json()).packet.status, "pending");
    assert.equal(
      (await fetch(origin + "/api/attachments/fixture-file")).status,
      401,
    );
    const attachment = await fetch(origin + "/api/attachments/fixture-file", {
      headers: { Cookie: cookie },
    });
    assert.equal(await attachment.text(), "报告不少于2000字");
    assert.equal(
      attachment.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.equal((await fetch(origin + "/.env")).status, 404);
    await stop();
    await start();
    const stored = await (
      await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(stored.packets.length, 1);
    assert.equal(stored.packets[0].sources[1].text, "报告不少于2000字");
    assert.equal(stored.packets[0].status, "pending");
    assert.ok(!JSON.stringify(stored).includes("fixture-personal-passphrase"));
    const removed = await fetch(origin + "/api/packets/fixture-packet", {
      method: "DELETE",
      headers: { Origin: origin, Cookie: cookie },
    });
    assert.equal(removed.status, 200);
    const tombstone = (await removed.json()).packet;
    assert.ok(tombstone.deletedAt);
    assert.equal(tombstone.text, "");
    assert.deepEqual(tombstone.attachments, []);
    assert.equal(
      (
        await fetch(origin + "/api/attachments/fixture-file", {
          headers: { Cookie: cookie },
        })
      ).status,
      404,
    );
  } finally {
    await stop();
  }
});
