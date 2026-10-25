import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  createMultiUserService,
  wechatCodeExchange,
} from "./sync-multi-user.mjs";
import { AccountRegistry, proofMessage } from "./sync-accounts.mjs";
import { runAdmin } from "./sync-admin.mjs";
import { createRequire } from "node:module";
const { createSyncClient } = createRequire(import.meta.url)(
  "../miniprogram/lib/sync-client.js",
);

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-accounts-test-"));
  let service, base;
  const config = {
    directory,
    secret: "synthetic-test-registry-secret-32-characters",
    ...options,
  };
  async function start() {
    service = createMultiUserService(config);
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${service.server.address().port}`;
  }
  const stop = () => new Promise((done) => service.server.close(done));
  await start();
  t.after(async () => {
    await stop();
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
        directory.includes("shixu-accounts-test-"),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  async function request(device, method, path, value, extra = {}) {
    const bytes = Buffer.isBuffer(value)
      ? value
      : value
        ? Buffer.from(JSON.stringify(value))
        : Buffer.alloc(0);
    const headers = {
      ...(value
        ? {
            "Content-Type": Buffer.isBuffer(value)
              ? "application/octet-stream"
              : "application/json",
          }
        : {}),
      ...(device?.token ? { Authorization: `Bearer ${device.token}` } : {}),
      ...extra,
    };
    if (device?.privateKey) {
      headers["x-shixu-time"] = String(Date.now());
      headers["x-shixu-nonce"] = randomBytes(24).toString("base64url");
      headers["x-shixu-signature"] = sign(
        null,
        Buffer.from(
          proofMessage(
            method,
            path,
            bytes,
            headers["x-shixu-time"],
            headers["x-shixu-nonce"],
          ),
        ),
        device.privateKey,
      ).toString("base64url");
    }
    const response = await fetch(base + path, {
      method,
      headers,
      ...(bytes.length ? { body: bytes } : {}),
    });
    const body = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    if (!response.ok)
      throw Object.assign(Error(body.error), body, { status: response.status });
    return body;
  }
  async function windows(invite, keys = generateKeyPairSync("ed25519")) {
    const publicKey = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const device = await request(keys, "POST", "/api/v3/activate/windows", {
      invite,
      publicKey,
    });
    return { ...device, ...keys };
  }
  async function put(
    device,
    id,
    data = { text: "合成资料" },
    version = 0,
    opId = "put_" + id,
  ) {
    return request(device, "POST", "/api/v3/operations", {
      epoch: device.epoch,
      operation: {
        opId,
        id,
        type: "put",
        baseVersion: version,
        data: { id, ...data },
      },
    });
  }
  return {
    directory,
    request,
    windows,
    put,
    registry: () => service.registry,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
const denied = (code) => (e) => e.code === code;

test("invites create separate accounts; enrollment retry is stable; platform labels cannot claim slots", async (t) => {
  const f = await fixture(t, {
    wechat: async (code) =>
      code === "wx-proof-a" ? "server-openid-a" : "server-openid-b",
  });
  const [a, b] = f.registry().generate(2),
    wa = await f.windows(a.invite),
    wb = await f.windows(b.invite);
  const replay = await f.windows(a.invite, wa);
  assert.equal(replay.token, wa.token);
  assert.equal(replay.deviceId, wa.deviceId);
  assert.notEqual(wa.userId, wb.userId);
  assert.notEqual(wa.epoch, wb.epoch);
  await assert.rejects(f.windows(a.invite), denied("DEVICE_BOUND"));
  await assert.rejects(
    f.request(null, "POST", "/api/v3/activate/windows", {
      invite: a.invite,
      platform: "windows",
      publicKey: wa.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    }),
    denied("INVALID_PROOF"),
  );
  const wx = await f.request(null, "POST", "/api/v3/activate/wechat", {
    invite: a.invite,
    code: "wx-proof-a",
    openid: "ignored",
  });
  assert.equal(wx.userId, wa.userId);
  await assert.rejects(
    f.request(null, "POST", "/api/v3/activate/wechat", {
      invite: b.invite,
      code: "wx-proof-a",
    }),
    denied("IDENTITY_BOUND"),
  );
  await assert.rejects(
    f.request(null, "POST", "/api/v3/activate/wechat", {
      invite: a.invite,
      code: "wx-proof-b",
    }),
    denied("DEVICE_BOUND"),
  );
  await assert.rejects(
    f.request(null, "POST", "/api/v2/devices", { password: "anything" }),
    denied("NOT_FOUND"),
  );
  await assert.rejects(
    f.request(wa, "POST", "/api/v3/devices", { password: "anything" }),
    denied("NOT_FOUND"),
  );
  await assert.rejects(
    f.request({ token: wa.token }, "GET", "/api/v3/account"),
    denied("INVALID_PROOF"),
  );
});

test("all record operations, DDL fields, cursors, conflicts and operation IDs are account isolated", async (t) => {
  const f = await fixture(t),
    [a, b] = f.registry().generate(2),
    wa = await f.windows(a.invite),
    wb = await f.windows(b.invite);
  await f.put(wa, "same-id", {
    text: "A的原文",
    itemState: { task: { due: "2026-12-01", chat: [{ text: "A的对话" }] } },
  });
  let pull = await f.request(wb, "GET", "/api/v3/changes?cursor=0");
  assert.equal(pull.records.length, 0);
  assert.equal(pull.cursor, 0);
  await f.put(wb, "same-id", { text: "B的原文" }); // Same record and op ID are legal in another account.
  await assert.rejects(
    f.put(wb, "same-id", { text: "stale" }, 0, "stale-op"),
    (e) => {
      assert.equal(e.code, "REVISION_CONFLICT");
      assert.ok(!JSON.stringify(e).includes("A的"));
      return true;
    },
  );
  await assert.rejects(
    f.request(wb, "GET", "/api/v3/changes?cursor=0&epoch=" + wa.epoch),
    denied("RESET_REQUIRED"),
  );
  for (const [type, version] of [
    ["delete", 1],
    ["restore", 2],
    ["delete", 3],
    ["purge", 4],
  ]) {
    await f.request(wa, "POST", "/api/v3/operations", {
      epoch: wa.epoch,
      operation: {
        id: "same-id",
        opId: type + version,
        type,
        baseVersion: version,
      },
    });
    pull = await f.request(wb, "GET", "/api/v3/changes?cursor=0");
    assert.equal(pull.records[0].data.text, "B的原文");
    assert.equal(pull.records[0].version, 1);
  }
  await f.restart();
  assert.equal(
    (await f.request(wb, "GET", "/api/v3/changes?cursor=0")).records[0].data
      .text,
    "B的原文",
  );
});

test("guessed attachment IDs and original references cannot cross accounts; quotas remain independent", async (t) => {
  const f = await fixture(t),
    [a, b] = f.registry().generate(2),
    wa = await f.windows(a.invite),
    wb = await f.windows(b.invite);
  await f.put(wa, "packet");
  await f.put(wb, "packet");
  const path = "/api/v3/attachments/packet/original?epoch=" + wa.epoch;
  const file = await f.request(wa, "PUT", path, Buffer.from("secret A"), {
    "X-Shixu-File-Name": "fixture.txt",
  });
  await f.put(wa, "packet", { attachments: [file.file] }, 1, "link-original");
  const bpath = "/api/v3/attachments/packet/original?epoch=" + wb.epoch;
  await assert.rejects(f.request(wb, "GET", bpath), denied("NOT_FOUND"));
  await assert.rejects(
    f.put(wb, "packet", { attachments: [file.file] }, 1, "forged"),
    denied("ATTACHMENT_MISSING"),
  );
  f.registry().limits(b.userId, { storageBytes: 2 });
  await assert.rejects(
    f.request(wb, "PUT", bpath, Buffer.from("secret B"), {
      "X-Shixu-File-Name": "fixture.txt",
    }),
    (e) => e.status === 413,
  );
  assert.equal((await f.request(wa, "GET", path)).toString(), "secret A");
  await f.restart();
  assert.equal((await f.request(wa, "GET", path)).toString(), "secret A");
});

test("revoke resets only the chosen slot and immediately invalidates old credentials; disable survives restart", async (t) => {
  const f = await fixture(t),
    [a] = f.registry().generate(),
    old = await f.windows(a.invite);
  await f.put(old, "record");
  runAdmin(f.registry(), ["revoke", a.userId, "windows"]);
  await assert.rejects(
    f.request(old, "GET", "/api/v3/account"),
    denied("UNAUTHORIZED"),
  );
  const replacement = await f.windows(a.invite);
  assert.notEqual(replacement.token, old.token);
  assert.equal(
    (await f.request(replacement, "GET", "/api/v3/changes?cursor=0")).records
      .length,
    1,
  );
  runAdmin(f.registry(), ["disable", a.userId]);
  await f.restart();
  await assert.rejects(
    f.request(replacement, "GET", "/api/v3/account"),
    denied("ACCOUNT_DISABLED"),
  );
  runAdmin(f.registry(), ["enable", a.userId]);
  assert.equal(
    (await f.request(replacement, "GET", "/api/v3/account")).activation,
    "active",
  );
});

test("legacy workspace is not opened or assigned automatically", async (t) => {
  const f = await fixture(t);
  const legacy = join(f.directory, "workspace.sqlite");
  writeFileSync(legacy, "do not open or migrate");
  const [a] = f.registry().generate(),
    device = await f.windows(a.invite);
  assert.equal(
    (await f.request(device, "GET", "/api/v3/changes?cursor=0")).records.length,
    0,
  );
  assert.equal(readFileSync(legacy, "utf8"), "do not open or migrate");
});

test("AI jobs, results, deduplication and conservative daily budget are account scoped", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    ai: {
      organize: async () => {
        calls++;
        return { result: { items: [{ title: "合成结果" }] } };
      },
    },
    aiLimits: { enabled: true, dailyBudgetMicros: 200, taskBudgetMicros: 100 },
  });
  const [a, b] = f.registry().generate(2),
    wa = await f.windows(a.invite),
    wb = await f.windows(b.invite);
  await f.put(wa, "packet");
  await f.put(wb, "other");
  const request = {
    id: "paid-job",
    packetId: "packet",
    kind: "organize",
    baseVersion: 1,
    epoch: wa.epoch,
  };
  await f.request(wa, "POST", "/api/v3/jobs", request);
  await f.request(wa, "POST", "/api/v3/jobs", request);
  await assert.rejects(
    f.request(wb, "GET", "/api/v3/jobs/paid-job"),
    denied("NOT_FOUND"),
  );
  await assert.rejects(
    f.request(wb, "POST", "/api/v3/jobs", { ...request, epoch: wb.epoch }),
    denied("NOT_FOUND"),
  );
  for (let i = 0; i < 50; i++) {
    if ((await f.request(wa, "GET", "/api/v3/jobs/paid-job")).state === "done")
      break;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(calls, 1);
  assert.equal(f.registry().usage(a.userId)[0].requests, 1);
  assert.equal(f.registry().usage(b.userId).length, 0);
  f.registry().limits(b.userId, { dailyJobs: 0 });
  await assert.rejects(
    f.request(wb, "POST", "/api/v3/jobs", {
      ...request,
      id: "new-job",
      packetId: "other",
      epoch: wb.epoch,
    }),
    denied("AI_QUOTA"),
  );
  assert.equal(
    (await f.request(wb, "GET", "/api/v3/changes?cursor=0")).records.length,
    1,
  );
  await f.restart();
  await f.request(wa, "POST", "/api/v3/jobs", request);
  assert.equal(calls, 1);
  assert.equal(f.registry().usage(a.userId)[0].requests, 1);
});

test("WeChat exchange never accepts client openid or leaks provider errors", async () => {
  let observed;
  const exchange = wechatCodeExchange(
    "fixture-app",
    "fixture-secret",
    async (url) => {
      observed = url;
      return {
        ok: true,
        json: async () => ({
          openid: "verified-openid",
          session_key: "not-returned",
        }),
      };
    },
  );
  assert.equal(await exchange("fixture-code"), "verified-openid");
  assert.equal(observed.origin, "https://api.weixin.qq.com");
  assert.equal(observed.searchParams.get("grant_type"), "authorization_code");
  await assert.rejects(
    wechatCodeExchange("app", "secret", async () => {
      throw Error("secret-in-upstream-url");
    })("code"),
    (e) => e.code === "INVALID_LOGIN" && !e.message.includes("secret"),
  );
});

test("Windows proofs bind method, path, body and nonce; replay and account rate limits fail closed", async (t) => {
  const f = await fixture(t),
    [a] = f.registry().generate(),
    device = await f.windows(a.invite);
  const path = "/api/v3/account",
    timestamp = String(Date.now()),
    nonce = randomBytes(24).toString("base64url");
  const headers = {
    "x-shixu-time": timestamp,
    "x-shixu-nonce": nonce,
    "x-shixu-signature": sign(
      null,
      Buffer.from(proofMessage("GET", path, Buffer.alloc(0), timestamp, nonce)),
      device.privateKey,
    ).toString("base64url"),
  };
  await f.request({ token: device.token }, "GET", path, null, headers);
  await assert.rejects(
    f.request({ token: device.token }, "GET", path, null, headers),
    denied("REPLAYED_REQUEST"),
  );
  await assert.rejects(
    f.request({ token: device.token }, "GET", "/api/v3/changes", null, headers),
    denied("INVALID_PROOF"),
  );
  f.registry().limits(a.userId, { requestsPerMinute: 0 });
  await assert.rejects(f.request(device, "GET", path), denied("RATE_LIMIT"));
});

test("global concurrency is two, per account one, and queue length and budget are enforced durably", async (t) => {
  let running = 0,
    maximum = 0,
    finish;
  const gate = new Promise((done) => {
    finish = done;
  });
  const f = await fixture(t, {
    ai: {
      organize: async () => {
        running++;
        maximum = Math.max(maximum, running);
        await gate;
        running--;
        return { result: { items: [{ title: "合成结果" }] } };
      },
    },
    aiLimits: {
      enabled: true,
      queueLength: 3,
      taskBudgetMicros: 100,
      dailyBudgetMicros: 300,
    },
  });
  t.after(() => finish());
  const users = [];
  for (const invite of f.registry().generate(4)) {
    const device = await f.windows(invite.invite);
    await f.put(device, "packet");
    users.push(device);
  }
  const job = (device, id = "job") =>
    f.request(device, "POST", "/api/v3/jobs", {
      id,
      packetId: "packet",
      kind: "organize",
      baseVersion: 1,
      epoch: device.epoch,
    });
  for (const device of users.slice(0, 3)) await job(device);
  for (let i = 0; running < 2 && i < 50; i++)
    await new Promise((done) => setTimeout(done, 5));
  assert.equal(running, 2);
  assert.equal(maximum, 2);
  await f.put(users[0], "second");
  await assert.rejects(
    f.request(users[0], "POST", "/api/v3/jobs", {
      id: "second-job",
      packetId: "second",
      kind: "organize",
      baseVersion: 2,
      epoch: users[0].epoch,
    }),
    denied("QUEUE_FULL"),
  );
  await assert.rejects(job(users[3]), denied("QUEUE_FULL"));
  finish();
  for (let i = 0; i < 100; i++) {
    if ((await f.request(users[2], "GET", "/api/v3/jobs/job")).state === "done")
      break;
    await new Promise((done) => setTimeout(done, 5));
  }
  assert.equal(maximum, 2);
  await assert.rejects(job(users[3]), denied("AI_BUDGET"));
  await f.restart();
  await assert.rejects(job(users[3]), denied("AI_BUDGET"));
});

test("global pause blocks AI only; invalid inputs do not spend quota; opening admin does not reset active reservations", async (t) => {
  const f = await fixture(t, {
    ai: { organize: async () => ({ result: { items: [] } }) },
    aiLimits: {
      enabled: true,
      maxInputBytes: 50,
      taskBudgetMicros: 10,
      dailyBudgetMicros: 100,
    },
  });
  const [a] = f.registry().generate(),
    device = await f.windows(a.invite);
  await f.put(device, "packet", { text: "合成".repeat(100) });
  const job = {
    id: "job",
    packetId: "packet",
    kind: "organize",
    baseVersion: 1,
    epoch: device.epoch,
  };
  await assert.rejects(
    f.request(device, "POST", "/api/v3/jobs", job),
    denied("AI_INPUT_LIMIT"),
  );
  assert.equal(f.registry().usage(a.userId).length, 0);
  f.registry().reserve(a.userId, "synthetic-reservation", "fingerprint", {
    enabled: true,
    queueLength: 20,
    taskBudgetMicros: 10,
    dailyBudgetMicros: 100,
  });
  const admin = new AccountRegistry(
    f.directory,
    "synthetic-test-registry-secret-32-characters",
  );
  try {
    assert.equal(
      admin.db
        .prepare(
          "SELECT state FROM ai_usage WHERE job_id='synthetic-reservation'",
        )
        .get().state,
      "pending",
    );
  } finally {
    admin.close();
  }
  runAdmin(f.registry(), ["ai-pause"]);
  assert.equal(
    (await f.request(device, "GET", "/api/v3/account")).ai.enabled,
    false,
  );
  assert.equal(
    (await f.request(device, "GET", "/api/v3/changes?cursor=0")).records.length,
    1,
  );
  await f.restart();
  assert.equal(
    (await f.request(device, "GET", "/api/v3/account")).ai.enabled,
    false,
  );
});

test("the real shared queue syncs Windows and verified WeChat within one account without mixing another account", async (t) => {
  const f = await fixture(t, {
    wechat: async () => "fixture-verified-wechat-identity",
  });
  const [a, b] = f.registry().generate(2),
    windows = await f.windows(a.invite),
    other = await f.windows(b.invite);
  const wechat = await f.request(null, "POST", "/api/v3/activate/wechat", {
    invite: a.invite,
    code: "fixture-code",
  });
  const client = (device) => {
    let stored = null;
    return createSyncClient({
      protocolVersion: 3,
      read: () => stored,
      write: (value) => {
        stored = structuredClone(value);
      },
      makeId: () => randomBytes(16).toString("hex"),
      request: (method, path, data) =>
        f.request(device, method, path.replace("/api/v2/", "/api/v3/"), data),
    });
  };
  const desktop = client(windows),
    mini = client(wechat),
    isolated = client(other);
  await desktop.sync();
  await mini.sync();
  await isolated.sync();
  desktop.put("capture", {
    id: "capture",
    text: "合成跨端事项",
    itemState: { task: { due: "2026-11-01", starred: true } },
  });
  await desktop.sync();
  await mini.sync();
  await isolated.sync();
  assert.equal(mini.records()[0].data.itemState.task.starred, true);
  assert.equal(isolated.records().length, 0);
  mini.put("capture", {
    itemState: { task: { starred: false, notes: "微信补充" } },
  });
  await mini.sync();
  await desktop.sync();
  assert.equal(desktop.records()[0].data.itemState.task.notes, "微信补充");
  assert.equal(desktop.records()[0].data.itemState.task.due, "2026-11-01");
});

test("an in-flight model interruption keeps the reservation and never bills again after restart", async (t) => {
  let finish,
    calls = 0;
  const gate = new Promise((done) => {
    finish = done;
  });
  const f = await fixture(t, {
    ai: {
      organize: async () => {
        calls++;
        await gate;
        return { result: { items: [] } };
      },
    },
    aiLimits: { enabled: true, taskBudgetMicros: 10, dailyBudgetMicros: 100 },
  });
  t.after(() => finish());
  const [a] = f.registry().generate(),
    device = await f.windows(a.invite);
  await f.put(device, "packet");
  const job = {
    id: "paid-job",
    packetId: "packet",
    kind: "organize",
    baseVersion: 1,
    epoch: device.epoch,
  };
  await f.request(device, "POST", "/api/v3/jobs", job);
  for (let i = 0; calls === 0 && i < 50; i++)
    await new Promise((done) => setTimeout(done, 5));
  assert.equal(calls, 1);
  await f.restart();
  assert.equal(
    (await f.request(device, "POST", "/api/v3/jobs", job)).state,
    "interrupted",
  );
  assert.equal(f.registry().usage(a.userId)[0].reservedMicros, 10);
  assert.equal(calls, 1);
  finish();
});

test("revoking a device while it waits for a global worker prevents its provider call", async (t) => {
  let calls = 0,
    finish;
  const gate = new Promise((done) => {
    finish = done;
  });
  const f = await fixture(t, {
    ai: {
      organize: async () => {
        calls++;
        await gate;
        return { result: { items: [] } };
      },
    },
    aiLimits: { enabled: true, taskBudgetMicros: 10, dailyBudgetMicros: 100 },
  });
  t.after(() => finish());
  const devices = [];
  for (const invitation of f.registry().generate(3)) {
    const device = await f.windows(invitation.invite);
    await f.put(device, "packet");
    devices.push(device);
    await f.request(device, "POST", "/api/v3/jobs", {
      id: "job",
      packetId: "packet",
      kind: "organize",
      baseVersion: 1,
      epoch: device.epoch,
    });
  }
  for (let i = 0; calls < 2 && i < 50; i++)
    await new Promise((done) => setTimeout(done, 5));
  assert.equal(calls, 2);
  f.registry().revoke(devices[2].userId, "windows");
  finish();
  let state;
  for (let i = 0; i < 100; i++) {
    state = f
      .registry()
      .db.prepare("SELECT state FROM ai_usage WHERE user_id=? AND job_id='job'")
      .get(devices[2].userId).state;
    if (state === "error") break;
    await new Promise((done) => setTimeout(done, 5));
  }
  assert.equal(state, "error");
  assert.equal(calls, 2);
});
