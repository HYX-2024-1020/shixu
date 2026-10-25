import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { AccountRegistry, proofMessage } from "../../server/sync-accounts.mjs";

export async function verifyAccounts(
  base,
  registry,
  { restart, realAI = false, wechatConfig = null } = {},
) {
  const report = {
    protocol: 3,
    syntheticOnly: true,
    realAI,
    modelJobs: 0,
    reservedMicros: 0,
  };
  const invitations = registry.generate(2),
    devices = [];
  // Probe polling must not exhaust the normal friend-account rate. Only these
  // short-lived synthetic accounts receive the temporary limit.
  for (const invitation of invitations)
    registry.limits(invitation.userId, { requestsPerMinute: 600 });
  const request = async (device, method, api, input, extra = {}) => {
    const bytes = Buffer.isBuffer(input)
      ? input
      : input
        ? Buffer.from(JSON.stringify(input))
        : Buffer.alloc(0);
    const timestamp = String(Date.now()),
      nonce = randomBytes(24).toString("base64url");
    const response = await fetch(base + api, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Connection: "close",
        ...(bytes.length
          ? {
              "Content-Type": Buffer.isBuffer(input)
                ? "application/octet-stream"
                : "application/json",
            }
          : {}),
        ...extra,
        ...(device?.token ? { Authorization: `Bearer ${device.token}` } : {}),
        ...(device?.privateKey
          ? {
              "X-Shixu-Time": timestamp,
              "X-Shixu-Nonce": nonce,
              "X-Shixu-Signature": sign(
                null,
                Buffer.from(proofMessage(method, api, bytes, timestamp, nonce)),
                device.privateKey,
              ).toString("base64url"),
            }
          : {}),
      },
      ...(bytes.length ? { body: bytes } : {}),
    });
    const value = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    if (!response.ok)
      throw Object.assign(
        Error(
          "Verification request failed: " + (value.code || response.status),
        ),
        { code: value.code, status: response.status },
      );
    return value;
  };
  const pull = (device) => request(device, "GET", "/api/v3/changes?cursor=0");
  const operate = (device, record, type, data, opId = randomUUID()) =>
    request(device, "POST", "/api/v3/operations", {
      epoch: device.epoch,
      operation: {
        id: record.id,
        type,
        baseVersion: record.version || 0,
        opId,
        ...(data ? { data } : {}),
      },
    });
  async function cleanup() {
    let ok = true;
    for (const device of devices) {
      try {
        for (let row of (await pull(device)).records) {
          if (row.purged) continue;
          if (!row.deletedAt)
            row = (await operate(device, row, "delete")).record;
          await operate(device, row, "purge");
        }
      } catch {
        ok = false;
      }
    }
    return ok;
  }
  try {
    assert.equal(
      (await request(null, "GET", "/api/v3/status")).protocolVersion,
      3,
    );
    await assert.rejects(
      request(null, "GET", "/api/v3/changes"),
      (e) => e.status === 401,
    );
    await assert.rejects(
      request(null, "GET", "/api/v2/changes"),
      (e) => e.status === 404,
    );
    for (const invitation of invitations) {
      const pair = generateKeyPairSync("ed25519"),
        publicKey = pair.publicKey
          .export({ format: "pem", type: "spki" })
          .toString();
      const device = { privateKey: pair.privateKey };
      const enrolled = await request(
        device,
        "POST",
        "/api/v3/activate/windows",
        { invite: invitation.invite, publicKey },
      );
      const repeated = await request(
        device,
        "POST",
        "/api/v3/activate/windows",
        { invite: invitation.invite, publicKey },
      );
      assert.equal(enrolled.token, repeated.token);
      devices.push({ ...device, ...enrolled });
    }
    const [a, b] = devices,
      id = "deployment-probe-" + randomUUID();
    let row = { id, version: 0 };
    const data = {
      id,
      text: "合成验收：2026年10月30日15:00提交测试报告。",
      captureDate: "2026-10-25",
      capturedAt: new Date().toISOString(),
      sources: [
        {
          id: "input",
          name: "合成输入",
          text: "合成验收：2026年10月30日15:00提交测试报告。",
        },
      ],
      attachments: [],
      status: "pending",
      result: null,
      itemState: {},
      doneIds: [],
    };
    const opId = randomUUID();
    row = (await operate(a, row, "put", data, opId)).record;
    const replay = await operate(a, { id, version: 0 }, "put", data, opId);
    assert.equal(replay.replayed, true);
    assert.equal((await pull(b)).records.length, 0);
    await assert.rejects(
      operate(b, row, "delete"),
      (e) => e.code === "REVISION_CONFLICT",
    );
    const filePath = (device) =>
      `/api/v3/attachments/${id}/original?epoch=${device.epoch}`;
    const uploaded = await request(
      a,
      "PUT",
      filePath(a),
      Buffer.from("合成原件，不含个人资料"),
      { "X-Shixu-File-Name": "fixture.txt", "X-Shixu-File-Type": "text/plain" },
    );
    row = (await operate(a, row, "put", { attachments: [uploaded.file] }))
      .record;
    assert.equal(
      (await request(a, "GET", filePath(a))).toString(),
      "合成原件，不含个人资料",
    );
    await assert.rejects(
      request(b, "GET", filePath(b)),
      (e) => e.status === 404,
    );
    if (restart) {
      await restart();
      assert.equal((await pull(a)).records[0].data.text, data.text);
      report.restartPersistence = true;
    }
    row = (await operate(a, row, "delete")).record;
    row = (await operate(a, row, "restore")).record;
    if (realAI) {
      const job = {
        id: "probe-job-" + randomUUID(),
        kind: "organize",
        packetId: id,
        epoch: a.epoch,
        baseVersion: row.version,
      };
      const waitJob = async (requestData) => {
        await request(a, "POST", "/api/v3/jobs", requestData);
        report.modelJobs++;
        const deadline = Date.now() + 240000;
        for (;;) {
          const status = await request(
            a,
            "GET",
            "/api/v3/jobs/" + requestData.id,
          );
          if (status.state === "done") return status;
          if (["error", "conflict", "interrupted"].includes(status.state))
            throw Error(
              "Model verification job did not complete: " + status.state,
            );
          if (Date.now() > deadline)
            throw Error(
              "Model verification timed out; never automatically resubmit",
            );
          await new Promise((done) => setTimeout(done, 750));
        }
      };
      await waitJob(job);
      await request(a, "POST", "/api/v3/jobs", job); // Lost-response replay must not reserve again.
      await assert.rejects(
        request(b, "GET", "/api/v3/jobs/" + job.id),
        (e) => e.status === 404,
      );
      row = (await pull(a)).records.find((r) => r.id === id);
      assert.ok(row.data.result.items.length > 0);
      const itemId = row.data.itemIds[0];
      await waitJob({
        id: "probe-chat-" + randomUUID(),
        kind: "chat",
        packetId: id,
        itemId,
        instruction: "给这条测试事项加上星标，其他内容不改。",
        baseVersion: row.version,
        epoch: a.epoch,
      });
      row = (await pull(a)).records.find((r) => r.id === id);
      assert.equal(row.data.itemState[itemId].starred, true);
      const usage = registry.usage(a.userId);
      report.reservedMicros = usage.reduce(
        (sum, day) => sum + day.reservedMicros,
        0,
      );
      assert.equal(
        usage.reduce((sum, day) => sum + day.requests, 0),
        2,
      );
      assert.ok(report.reservedMicros <= 500000);
      report.organizeAndChat = true;
    }
    if (wechatConfig) {
      const response = await fetch(
        "https://api.weixin.qq.com/cgi-bin/stable_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
          body: JSON.stringify({
            grant_type: "client_credential",
            appid: wechatConfig.appId,
            secret: wechatConfig.secret,
            force_refresh: false,
          }),
        },
      );
      const value = await response.json();
      report.wechatCredentialCheck =
        response.ok && typeof value.access_token === "string"
          ? "valid"
          : "rejected";
      if (value.errcode) report.wechatErrorCode = value.errcode;
    }
    report.cleanedSyntheticRecords = await cleanup();
    assert.equal(report.cleanedSyntheticRecords, true);
    registry.revoke(a.userId, "windows");
    await assert.rejects(pull(a), (e) => e.status === 401);
    await pull(b);
    Object.assign(report, {
      isolatedAccounts: true,
      idempotentActivation: true,
      idempotentWrites: true,
      attachmentIsolation: true,
      deleteRestore: true,
      revokedCredentialsRejected: true,
    });
    return report;
  } finally {
    // Registry retains audit/budget totals, but every fixture account is disabled.
    if (!report.cleanedSyntheticRecords) await cleanup();
    for (const invitation of invitations)
      registry.enable(invitation.userId, false);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.env.SYNC_ACCOUNT_DIR || !process.env.SYNC_ACCOUNT_SECRET)
    throw Error("Account environment required");
  const registry = new AccountRegistry(
    process.env.SYNC_ACCOUNT_DIR,
    process.env.SYNC_ACCOUNT_SECRET,
  );
  try {
    const report = await verifyAccounts(
      process.argv[2] || "http://127.0.0.1:8788",
      registry,
      {
        realAI: process.argv.includes("--real-ai"),
        restart: process.argv.includes("--restart-service")
          ? async () => {
              execFileSync("systemctl", ["restart", "shixu-sync.service"], {
                stdio: "pipe",
              });
            }
          : undefined,
        wechatConfig: process.argv.includes("--wechat-config")
          ? {
              appId: process.env.WECHAT_APP_ID,
              secret: process.env.WECHAT_APP_SECRET,
            }
          : null,
      },
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    registry.close();
  }
}
