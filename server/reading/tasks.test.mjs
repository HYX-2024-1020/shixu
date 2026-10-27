import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { readMaterial } from "./material.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
const result = (sources) => ({
  summary: "合成资料",
  warnings: [],
  items: [
    {
      kind: "note",
      title: "有依据的合成事项",
      summary: "合成摘要",
      facts: [],
      nextSteps: [],
      uncertainties: [],
      due: null,
      evidence: [
        { sourceId: sources[0].id, quote: sources[0].text.slice(0, 10) },
      ],
    },
  ],
});
function fixture(
  t,
  {
    text = "原件实际内容和要求",
    provider,
    reader = async (f) => readMaterial(f),
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-reading-task-"));
  const store = new SyncStore(join(directory, "tenant.sqlite"));
  createAttachmentStore(store);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.grantInitial("synthetic");
  ledger.freezePrice({
    id: "fixture",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic, not a live price",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  const windows = store.createDevice("Windows source synthetic"),
    wechat = store.createDevice("WeChat logical synthetic");
  const put = (data, internal) =>
    store.apply(
      windows.deviceId,
      {
        id: "packet",
        opId: crypto.randomUUID(),
        type: "put",
        baseVersion: store.record("packet")?.version || 0,
        data,
      },
      store.epoch,
      internal,
    );
  put({
    text: "",
    sources: [{ id: "forged", name: "伪造", text: "不要相信这个客户端正文" }],
    attachments: [],
    captureDate: "2026-10-28",
    status: "pending",
    result: null,
  });
  const attachment = store.files.put("packet", "a", {
    name: "合成.txt",
    body: Buffer.from(text),
    type: "text/plain",
    epoch: store.epoch,
  });
  put({ attachments: [attachment] });
  let calls = 0;
  const taskArgs = {
    store,
    ledger,
    account: "synthetic",
    reader,
    priceId: "fixture",
    modelVersion: "synthetic/1",
    authorize: (id) => {
      if (
        !store.db
          .prepare("SELECT 1 FROM sync_devices WHERE id=? AND revoked=0")
          .get(id)
      )
        throw Error("UNAUTHORIZED");
    },
    provider: async (sources, signal) => {
      calls++;
      return provider
        ? provider(sources, signal, calls)
        : {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: result(sources),
          };
    },
  };
  const tasks = new ReadingTasks(taskArgs);
  t.after(() => {
    tasks.close();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const enqueue = () =>
    tasks.enqueue({
      id: "task",
      packetId: "packet",
      deviceId: windows.deviceId,
    });
  const action = (action, id = "action") => {
    const current = tasks.get("task");
    return tasks.action(
      "task",
      {
        operationId: id,
        expectedGeneration: current.generation,
        expectedRevision: current.input_revision,
      },
      action,
    );
  };
  return {
    store,
    ledger,
    tasks,
    taskArgs,
    put,
    enqueue,
    action,
    windows,
    wechat,
    calls: () => calls,
  };
}
async function finish(tasks) {
  for (let i = 0; i < 12; i++) {
    const task = await tasks.run("task");
    if (task.state !== "queued") return task;
  }
  throw Error("UNEXPECTED_NO_PROGRESS");
}
test("task kernel refuses configuration without explicit device authorization", () => {
  assert.throws(
    () =>
      new ReadingTasks({
        account: "a",
        reader() {},
        provider() {},
        modelVersion: "fixture",
      }),
    /READING_CONFIGURATION_REQUIRED/,
  );
});
test("original -> reading -> ledger -> atomic publication -> both logical sync devices, without persistent full text", async (t) => {
  const f = fixture(t);
  const first = f.enqueue();
  assert.deepEqual(f.enqueue(), first);
  assert.throws(
    () => f.put({ text: "offline modification" }),
    (e) => e.code === "INPUT_LOCKED",
  );
  assert.throws(
    () =>
      f.store.files.put("packet", "b", {
        name: "b.txt",
        body: Buffer.from("xx"),
        epoch: f.store.epoch,
      }),
    (e) => e.code === "INPUT_LOCKED",
  );
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
  assert.throws(
    () => f.put({ readingCoverage: [] }),
    (e) => e.code === "SERVER_FIELD_READONLY",
  );
  const p = f.store.record("packet").data;
  assert.equal(p.sources.length, 0);
  assert.equal(p.readingCoverage[0].state, "read");
  assert.equal(p.result.items[0].evidence[0].quote, "原件实际内容和要求");
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  for (const device of [f.windows, f.wechat]) {
    assert.ok(f.store.authenticate(device.token));
    const changes = f.store.pull({ cursor: 0, epoch: f.store.epoch });
    assert.ok(
      changes.records.some(
        (r) => r.data?.readingCoverage?.[0].state === "read",
      ),
    );
    assert.ok(device.deviceId);
  }
  const task = f.tasks.get("task");
  assert.ok(!JSON.stringify(task).includes("原件实际内容"));
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_publications").get().n,
    1,
  );
});
test("stop retains completed paid block, rejects stale action, and settles but discards a late response", async (t) => {
  let release, entered;
  const started = new Promise((r) => (entered = r));
  const f = fixture(t, {
    text: "abcdefghij".repeat(20000),
    provider: async (sources, signal, n) => {
      if (n === 2) {
        entered();
        await new Promise((r) => (release = r));
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  f.enqueue();
  await f.tasks.run("task");
  assert.equal(f.calls(), 1);
  const pending = f.tasks.run("task");
  await started;
  const prior = f.tasks.get("task");
  f.action("stop", "stop");
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.throws(
    () => f.action("continue", "too-early"),
    (e) => e.code === "UNKNOWN_COST",
  );
  release();
  await pending;
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
    1,
  );
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  assert.throws(
    () =>
      f.tasks.action(
        "task",
        {
          operationId: "stale",
          expectedGeneration: prior.generation,
          expectedRevision: prior.input_revision,
        },
        "stop",
      ),
    (e) => e.code === "STALE_TASK",
  );
  f.action("continue", "continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(
    f.calls(),
    3,
    "completed first block was reused, late unfinished block was not",
  );
});
test("all unreadable material never invokes provider; partial input publishes explicit uncovered metadata", async (t) => {
  const fail = fixture(t, {
    reader: async (f) => ({
      ...readMaterial(f),
      state: "failed",
      segments: [],
      covered: [],
      uncovered: [{ kind: "file", code: "ISOLATED_READING_FAILED" }],
    }),
  });
  fail.enqueue();
  assert.equal((await fail.tasks.run("task")).reason, "NO_READABLE_MATERIAL");
  assert.equal(fail.calls(), 0);
});
test("publication failure rolls back packet, publication manifest and terminal state together", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  const sequence = f.store.sequence;
  f.store.db.exec(
    "CREATE TRIGGER fail_reading_publish BEFORE INSERT ON reading_publications BEGIN SELECT RAISE(ABORT,'INJECTED_PUBLISH_FAILURE'); END;",
  );
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.store.sequence, sequence);
  assert.equal(f.store.record("packet").data.result, null);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_publications").get().n,
    0,
  );
  f.store.db.exec("DROP TRIGGER fail_reading_publish");
  f.action("continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
});
test("changed input cannot resume or reuse a paid block under an old revision", async (t) => {
  const f = fixture(t, { text: "abcdefghij".repeat(20000) });
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop");
  f.put({ text: "changed" });
  assert.throws(
    () => f.action("continue", "resume"),
    (e) => e.code === "INPUT_CHANGED",
  );
});
test("whitespace-only originals report no readable material and do not publish an empty success", async (t) => {
  const f = fixture(t, { text: " \n\t\n" });
  f.enqueue();
  assert.equal((await f.tasks.run("task")).reason, "NO_READABLE_MATERIAL");
  assert.equal(f.calls(), 0);
  assert.equal(f.store.record("packet").data.result, null);
});
test("settled result envelope survives failure before tenant block write and resumes without another charge", async (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db.exec(
    "CREATE TRIGGER fail_block BEFORE INSERT ON reading_blocks BEGIN SELECT RAISE(ABORT,'INJECTED_BLOCK_FAILURE'); END;",
  );
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.calls(), 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_envelopes").get().n,
    1,
  );
  f.store.db.exec("DROP TRIGGER fail_block");
  f.action("continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_envelopes").get().n,
    0,
  );
});
test("invalid model source still settles valid usage but cannot become a reusable block or publication", async (t) => {
  const f = fixture(t, {
    provider: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: result([{ id: "forged", text: "unrelated quote" }]),
    }),
  });
  f.enqueue();
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
    0,
  );
  assert.equal(f.store.record("packet").data.result, null);
});
