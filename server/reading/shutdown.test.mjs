import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { AccountRegistry } from "../sync-accounts.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { readMaterial } from "./material.mjs";

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "shixu-shutdown-"));
  const ledger = new ReadingLedger(join(root, "ledger.sqlite"));
  ledger.freezePrice({
    id: "fixture",
    model: "fixture",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1,
    cachedMicrosPerMillion: 0,
    outputMicrosPerMillion: 1,
  });
  const config = {
    directory: join(root, "server"),
    secret: "synthetic-shutdown-secret-32-characters",
    shutdownGraceMs: 25,
    ...options,
    reading: {
      enabled: true,
      ledger,
      priceId: "fixture",
      modelVersion: "fixture",
      reader: async (f) => readMaterial(f),
      provider: async () => {
        throw Error("unexpected model call");
      },
      ...options.reading,
    },
  };
  const service = createMultiUserService(config);
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  t.after(async () => {
    if (service.server.listening)
      await new Promise((done) => service.server.close(done));
    await service.drained();
    ledger.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    service,
    ledger,
    config,
    root,
    base: `http://127.0.0.1:${service.server.address().port}`,
  };
}

for (const credentials of [false, true])
  test(
    `HTTP shutdown bounds an uncooperative WeChat exchange (credentials=${credentials}) and discards its late identity`,
    { timeout: 5000 },
    async (t) => {
      let release, entered;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const f = await fixture(t, {
        wechat: async () => {
          entered();
          return new Promise((resolve) => {
            release = resolve;
          });
        },
        reading: { credentials },
      });
      const invitation = f.service.registry.generate(1)[0];
      const request = fetch(
        f.base +
          (credentials ? "/api/v4/auth/wechat" : "/api/v3/activate/wechat"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractVersion: 1,
            code: "synthetic-code",
            invite: invitation.invite,
          }),
        },
      );
      const failed = assert.rejects(request);
      await started;
      const at = performance.now();
      await new Promise((done) => f.service.server.close(done));
      await f.service.drained();
      const closeMs = performance.now() - at;
      t.diagnostic(
        JSON.stringify({
          synthetic: true,
          case: credentials ? "v4-wechat" : "v3-wechat-in-v4",
          graceMs: 25,
          closeMs,
          realProviderCalls: 0,
        }),
      );
      assert.ok(
        closeMs < 1500,
        "close must not wait for the upstream identity exchange",
      );
      await failed;
      release("synthetic-openid-late");
      await new Promise((done) => setImmediate(() => setImmediate(done)));
      const registry = new AccountRegistry(f.config.directory, f.config.secret);
      try {
        assert.equal(
          registry.db.prepare("SELECT COUNT(*) n FROM bindings").get().n,
          0,
        );
      } finally {
        registry.close();
      }
    },
  );

test(
  "service shutdown bounds the running scheduler, persists unknown risk, and a late provider cannot access actually closed stores",
  { timeout: 5000 },
  async (t) => {
    let release, entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const f = await fixture(t, {
      reading: {
        provider: async () => {
          entered();
          await new Promise((resolve) => {
            release = resolve;
          });
          throw Error("late synthetic failure");
        },
      },
    });
    const invite = f.service.registry.generate(1)[0];
    const binding = f.service.registry.bind(
      invite.invite,
      "wechat",
      "synthetic-only",
    );
    f.ledger.grantInitial(binding.user_id);
    const store = new SyncStore(":memory:");
    createAttachmentStore(store);
    store.createDevice("synthetic", Date.now(), {
      id: binding.id,
      token: binding.token,
      expiresAt: binding.expires,
    });
    store.apply(
      binding.id,
      {
        id: "packet",
        opId: "put",
        type: "put",
        baseVersion: 0,
        data: {
          text: "合成材料",
          attachments: [],
          captureDate: "2026-10-28",
          status: "pending",
          result: null,
        },
      },
      store.epoch,
    );
    try {
      await f.service.readingRoutes.handle({
        account: binding.user_id,
        device: binding.id,
        store,
        method: "POST",
        url: new URL("http://localhost/api/v4/tasks"),
        value: {
          contractVersion: 1,
          kind: "organize",
          id: "task",
          packetId: "packet",
          epoch: store.epoch,
          baseVersion: store.record("packet").version,
        },
      });
      await started;
      const at = performance.now();
      await new Promise((done) => f.service.server.close(done));
      await f.service.drained();
      const closeMs = performance.now() - at;
      t.diagnostic(
        JSON.stringify({
          synthetic: true,
          case: "uncooperative-provider",
          graceMs: 25,
          closeMs,
          realProviderCalls: 0,
        }),
      );
      assert.ok(closeMs < 1500);
      assert.equal(
        store.db.prepare("SELECT reason FROM reading_tasks").get().reason,
        "SHUTDOWN_TIMEOUT",
      );
      assert.equal(
        f.ledger.db.prepare("SELECT state FROM reading_calls").get().state,
        "unknown",
      );
      assert.equal(store.record("packet").data.result, null);
    } finally {
      store.close();
    }
    // The external ledger is host-owned; close it too before the provider returns.
    f.ledger.close();
    f.ledger.close = () => {};
    release();
    await new Promise((done) => setImmediate(() => setImmediate(done)));
    assert.equal(f.service.readingRoutes.snapshot().running, 0);
  },
);
