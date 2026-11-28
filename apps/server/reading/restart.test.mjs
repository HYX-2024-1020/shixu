import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { readMaterial } from "./material.mjs";

test("restart restores queued account scheduling and input guards before any v4 client request, then drains before DB close", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-v4-restart-")),
    directory = join(root, "server");
  const ledger = new ReadingLedger(join(root, "ledger.sqlite"));
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
  let release, enter;
  const entered = new Promise((done) => {
      enter = done;
    }),
    held = new Promise((done) => {
      release = done;
    });
  const options = {
    directory,
    secret: "synthetic-restart-service-secret-32-characters",
    wechat: async (code) => code,
    reading: {
      enabled: true,
      ledger,
      reader: async (f) => readMaterial(f),
      priceId: "fixture",
      modelVersion: "fixture",
      provider: async (sources) => {
        enter();
        await held;
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: {
            summary: "合成",
            warnings: [],
            items: [
              {
                kind: "note",
                title: "合成",
                summary: "合成",
                facts: [],
                nextSteps: [],
                uncertainties: [],
                due: null,
                evidence: [{ sourceId: sources[0].id, quote: sources[0].text }],
              },
            ],
          },
        };
      },
    },
  };
  let service = createMultiUserService(options),
    base;
  const listen = async () => {
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${service.server.address().port}`;
  };
  const stop = async () => {
    await new Promise((done) => service.server.close(done));
    await service.drained();
  };
  const request = async (binding, path, value) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(binding ? { Authorization: "Bearer " + binding.token } : {}),
      },
      body: JSON.stringify(value),
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    await listen();
    const invitation = service.registry.generate(1)[0];
    ledger.grantInitial(invitation.userId);
    const binding = (
      await request(null, "/api/v3/activate/wechat", {
        invite: invitation.invite,
        code: "synthetic",
      })
    ).value;
    const operation = {
      opId: "initial",
      id: "packet",
      type: "put",
      baseVersion: 0,
      data: { text: "合成原始材料", captureDate: "2026-10-28" },
    };
    const saved = await request(binding, "/api/v3/operations", {
      epoch: binding.epoch,
      operation,
    });
    assert.equal(saved.status, 200);
    await stop();
    const store = new SyncStore(
      join(directory, "users", binding.userId, "workspace.sqlite"),
    );
    createAttachmentStore(store);
    const tasks = new ReadingTasks({
      ...options.reading,
      store,
      account: binding.userId,
      authorize() {},
    });
    tasks.enqueue({
      id: "persisted",
      packetId: "packet",
      deviceId: binding.deviceId,
    });
    // A crash leaves queued work durable; graceful close instead interrupts it.
    store.close();
    service = createMultiUserService(options);
    await listen();
    await entered;
    const changed = await request(binding, "/api/v3/operations", {
      epoch: binding.epoch,
      operation: {
        ...operation,
        opId: "offline-write",
        baseVersion: saved.value.acceptedVersion,
        data: { text: "旧端离线修改" },
      },
    });
    assert.equal(changed.value.code, "INPUT_LOCKED");
    release();
    while (service.readingRoutes.snapshot().accounts)
      await new Promise((done) => setTimeout(done, 5));
    const response = await fetch(base + "/api/v4/tasks/persisted", {
      headers: { Authorization: "Bearer " + binding.token },
    });
    assert.equal((await response.json()).state, "done");
    assert.equal(ledger.audit().valid, true);
  } finally {
    release();
    if (service.server.listening) await stop();
    ledger.close();
    await rm(root, { recursive: true, force: true });
  }
});
