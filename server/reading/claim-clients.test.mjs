import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { readMaterial } from "./material.mjs";
const require = createRequire(import.meta.url),
  { AccountWorkspace } = require("../../desktop/accounts.cjs"),
  { DesktopStore } = require("../../desktop/storage.cjs");
test("real legacy signed client claims password in place without refund, new grant or lost records; v3-only startup refuses migrated auth schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-claim-clients-")),
    directory = join(root, "server"),
    secret = "synthetic-claim-client-secret-32-characters",
    ledger = new ReadingLedger(join(root, "ledger.sqlite"));
  ledger.freezePrice({
    id: "fixture",
    model: "fixture",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  let service = createMultiUserService({ directory, secret }),
    base;
  const listen = async () => {
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${service.server.address().port}`;
  };
  const stop = async () => {
    await new Promise((done) => service.server.close(done));
    await service.drained();
  };
  const client = async () => {
    const cloud = new AccountWorkspace({
      root: join(root, "windows"),
      local: new DesktopStore(join(root, "local")),
      serviceOrigin: base,
      seal: async (s) => Buffer.from(s),
      unseal: async (b) => b.toString(),
    });
    await cloud.init();
    return cloud;
  };
  try {
    await listen();
    const invitation = service.registry.generate(1)[0];
    let cloud = await client();
    await cloud.action("activate", { invite: invitation.invite });
    const old = cloud.config.devices[cloud.config.active];
    await cloud.call(
      "savePackets",
      [
        {
          id: "legacy",
          text: "旧账号合成资料",
          sources: [],
          attachments: [],
          captureDate: "2026-10-28",
          doneIds: [],
          status: "pending",
          result: null,
        },
      ],
      cloud.config.active,
    );
    await cloud.action("sync");
    service.registry.db
      .prepare("INSERT INTO ai_usage VALUES(?,?,?,?,?,?)")
      .run(
        old.userId,
        "old-call",
        "synthetic-fingerprint",
        "2026-10-28",
        100,
        "done",
      );
    await stop();
    service = createMultiUserService({
      directory,
      secret,
      reading: {
        credentials: true,
        enabled: false,
        ledger,
        priceId: "fixture",
        modelVersion: "fixture",
        reader: async (f) => readMaterial(f),
        provider: async () => {
          throw Error("unexpected provider call");
        },
      },
    });
    await listen();
    cloud = await client();
    await cloud.action("sync");
    assert.equal(cloud.status().account.authentication.claimed, false);
    await cloud.action("claim", {
      username: "legacy-owner",
      password: "synthetic-password",
    });
    assert.equal(cloud.status().account.authentication.claimed, true);
    await cloud.action("login", {
      username: "legacy-owner",
      password: "synthetic-password",
    });
    assert.equal(cloud.status().devices.length, 1);
    assert.equal(
      cloud.config.devices[cloud.config.active].deviceId,
      old.deviceId,
    );
    assert.equal(cloud.config.devices[cloud.config.active].userId, old.userId);
    assert.equal((await cloud.packets())[0].text, "旧账号合成资料");
    assert.equal(
      cloud.status().account.wallet.pausedReason,
      "RECONCILIATION_REQUIRED",
    );
    await assert.rejects(
      cloud.request(cloud.config.active, "GET", "/api/v4/wallet"),
      (e) => e.code === "RECONCILIATION_REQUIRED" && e.status === 503,
    );
    assert.equal(
      ledger.db.prepare("SELECT COUNT(*) n FROM reading_events").get().n,
      0,
    );
    assert.equal(
      service.registry.db.prepare("SELECT COUNT(*) n FROM ai_usage").get().n,
      1,
    );
    await stop();
    assert.throws(
      () => createMultiUserService({ directory, secret }),
      /AUTH_V4_REQUIRED/,
    );
  } finally {
    if (service.server.listening) await stop();
    ledger.close();
    await rm(root, { recursive: true, force: true });
  }
});
