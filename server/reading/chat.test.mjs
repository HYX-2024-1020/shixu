import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { readMaterial } from "./material.mjs";

function fixture(t, { chatProvider, ledgerOptions } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-chat-ledger-"));
  const store = new SyncStore(join(directory, "tenant.sqlite"));
  createAttachmentStore(store);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"), {
    now: () => Date.parse("2026-10-30T08:00:00Z"),
    ...ledgerOptions,
  });
  let tasks;
  t.after(() => {
    tasks?.close();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  ledger.freezePrice({
    id: "fixture",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  ledger.grantInitial("synthetic");
  const device = store.createDevice("synthetic").deviceId;
  const put = (data) =>
    store.apply(
      device,
      {
        id: "packet",
        opId: crypto.randomUUID(),
        type: "put",
        baseVersion: store.record("packet")?.version || 0,
        data,
      },
      store.epoch,
      { taskId: "synthetic-seed" },
    );
  const item = {
    kind: "task",
    title: "原事项",
    summary: "保留摘要",
    facts: ["必须保留要求"],
    nextSteps: [],
    uncertainties: [],
    evidence: [],
    due: null,
  };
  put({
    text: "原件正文不应发送给事项对话",
    captureDate: "2026-10-29",
    result: {
      summary: "已整理",
      warnings: [],
      items: [item, { ...item, title: "其他事项" }],
    },
    itemIds: ["item1", "item2"],
    itemState: { item2: { starred: true } },
    attachments: [],
    sources: [],
    status: "ready",
    readingCoverage: [{ attachmentId: "original", state: "read", covered: [] }],
  });
  let organizeCalls = 0,
    chatCalls = 0;
  const provider = async (sources) => {
    organizeCalls++;
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        summary: "整理",
        warnings: [],
        items: [
          {
            ...item,
            evidence: [
              { sourceId: sources[0].id, quote: sources[0].text.slice(0, 4) },
            ],
          },
        ],
      },
    };
  };
  provider.chat = async (...args) => {
    chatCalls++;
    return chatProvider
      ? chatProvider(...args)
      : {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: {
            reply: "已按本轮指令修改",
            patch: {
              kind: "notice",
              group: "图像实验",
              due: { anchor: "明天下午5点" },
            },
          },
        };
  };
  const args = {
    store,
    ledger,
    account: "synthetic",
    reader: Object.assign((f, o) => readMaterial(f, o), {
      pdfWindows: true,
      archiveWindows: true,
      imageWindows: true,
    }),
    provider,
    priceId: "fixture",
    modelVersion: "synthetic/1",
    authorize: (id) => assert.equal(id, device),
  };
  tasks = new ReadingTasks(args);
  const input = {
    id: "chat1",
    packetId: "packet",
    deviceId: device,
    chat: {
      itemId: "item1",
      instruction: "改成通知，归到图像实验组，明天下午5点截止，其他要求保留",
      baseVersion: store.record("packet").version,
      epoch: store.epoch,
    },
  };
  return {
    directory,
    store,
    ledger,
    tasks,
    args,
    device,
    put,
    input,
    calls: () => ({ organize: organizeCalls, chat: chatCalls }),
    enqueue: () => tasks.enqueue(input),
    action(action, id = "chat1") {
      const task = tasks.get(id);
      return tasks.action(
        id,
        {
          operationId: crypto.randomUUID(),
          expectedGeneration: task.generation,
          expectedRevision: task.input_revision,
          expectedMaintenanceOperation: tasks.maintenanceOperation(id),
        },
        action,
        device,
      );
    },
  };
}
async function finish(tasks, id = "chat1") {
  for (let i = 0; i < 6 && tasks.get(id)?.state === "queued"; i++)
    await tasks.run(id);
  return tasks.get(id);
}

test("item chat shares the ledger and kernel, changes only its target and preserves reading evidence", async (t) => {
  const f = fixture(t);
  const before = f.store.record("packet").data;
  f.enqueue();
  const done = await finish(f.tasks);
  assert.equal(done.state, "done", JSON.stringify(done));
  assert.deepEqual(f.calls(), { organize: 0, chat: 1 });
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  const after = f.store.record("packet").data;
  assert.equal(after.result.items[0].kind, "notice");
  assert.equal(after.itemState.item1.group, "图像实验");
  assert.equal(after.result.items[0].due.date, "2026-10-31");
  assert.equal(after.result.items[0].due.time, "17:00");
  assert.deepEqual(after.result.items[0].facts, before.result.items[0].facts);
  assert.deepEqual(after.result.items[1], before.result.items[1]);
  assert.deepEqual(after.itemState.item2, before.itemState.item2);
  assert.deepEqual(after.itemIds, before.itemIds);
  assert.deepEqual(after.readingCoverage, before.readingCoverage);
  assert.equal(after.itemState.item1.chat.length, 2);
  assert.ok(after.itemState.item1.history.some((h) => h.field === "due"));
  assert.equal(f.tasks.roots.stats("chat1").calls, 1);
  assert.equal(f.tasks.chat.publicInfo("chat1").kind, "chat");
  assert.ok(
    !f.store.db
      .prepare("SELECT body FROM reading_chat_requests")
      .get()
      .body.includes("原件正文"),
  );
  assert.equal(f.tasks.enqueue(f.input).state, "done");
  assert.equal(f.calls().chat, 1);
});

test("a paid chat survives failed publication and restart without a second call or history append", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("chat1");
  const originalApply = f.store.apply.bind(f.store);
  f.store.apply = () => {
    throw Error("INJECTED_PUBLICATION_FAILURE");
  };
  assert.equal((await f.tasks.run("chat1")).state, "paused");
  f.store.apply = originalApply;
  const restarted = new ReadingTasks(f.args);
  const task = restarted.get("chat1");
  restarted.action(
    "chat1",
    {
      operationId: "restart-chat",
      expectedGeneration: task.generation,
      expectedRevision: task.input_revision,
      expectedMaintenanceOperation: restarted.maintenanceOperation("chat1"),
    },
    "continue",
    f.device,
  );
  assert.equal((await finish(restarted)).state, "done");
  assert.equal(f.calls().chat, 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(f.store.record("packet").data.itemState.item1.chat.length, 2);
  restarted.close();
});

test("invalid chat patches settle returned usage but cannot modify a second item or become a paid proof", async (t) => {
  const f = fixture(t, {
    chatProvider: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { reply: "尝试修改别的事项", patch: { delete: "item2" } },
    }),
  });
  const before = f.store.record("packet");
  f.enqueue();
  const task = await finish(f.tasks);
  assert.equal(task.state, "paused");
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(f.ledger.wallet("synthetic").unknownRisk, 0);
  assert.deepEqual(f.store.record("packet"), before);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_chat_proofs").get().n,
    0,
  );
});

test("unknown chat usage pauses the same wallet used by organizer and cannot be retried", async (t) => {
  const f = fixture(t, {
    chatProvider: async () => {
      throw Error("response lost");
    },
  });
  f.enqueue();
  const task = await finish(f.tasks);
  assert.equal(task.reason, "UNKNOWN_COST");
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
  assert.ok(f.ledger.wallet("synthetic").unknownRisk > 0);
  assert.throws(
    () => f.action("continue"),
    (e) => e.code === "UNKNOWN_COST",
  );
  assert.equal(f.calls().chat, 1);
  assert.equal(
    f.ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_calls WHERE state='unknown'")
      .get().n,
    1,
  );
});

test("chat creation rejects stale revisions and changed instructions under the same id", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.tasks.enqueue({
        ...f.input,
        chat: { ...f.input.chat, baseVersion: 99 },
      }),
    (e) => e.code === "REVISION_CONFLICT",
  );
  assert.throws(
    () =>
      f.tasks.enqueue({ ...f.input, chat: { ...f.input.chat, epoch: "old" } }),
    (e) => e.code === "RESET_REQUIRED",
  );
  f.enqueue();
  assert.throws(
    () =>
      f.tasks.enqueue({
        ...f.input,
        chat: { ...f.input.chat, instruction: "different" },
      }),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.throws(
    () => f.tasks.enqueue({ ...f.input, chat: null }),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(f.calls().chat, 0);
});

test("stop fences late chat output while settling its valid usage", async (t) => {
  let enter, release;
  const entered = new Promise((r) => (enter = r)),
    held = new Promise((r) => (release = r));
  const f = fixture(t, {
    chatProvider: async () => {
      enter();
      await held;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: { reply: "late", patch: { title: "late" } },
      };
    },
  });
  const before = f.store.record("packet");
  f.enqueue();
  const running = f.tasks.run("chat1");
  await entered;
  f.action("stop");
  release();
  await running;
  assert.equal(f.tasks.get("chat1").state, "cancelled");
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.deepEqual(f.store.record("packet"), before);
  assert.equal(f.tasks.roots.stats("chat1").calls, 1);
});

test("chat uses the organizer account slot and cannot spend an organizer unknown-cost reservation", async (t) => {
  const f = fixture(t);
  f.enqueue();
  assert.throws(
    () =>
      f.tasks.enqueue({
        id: "organizer",
        packetId: "packet",
        deviceId: f.device,
      }),
    (e) => e.code === "TASK_SLOT_FULL",
  );
  f.action("stop");
  f.ledger.reserve({
    callId: "organizer-unknown",
    account: "synthetic",
    task: "old-organizer",
    block: "block",
    generation: 1,
    priceId: "fixture",
    maxPromptTokens: 100,
    maxOutputTokens: 10,
  });
  f.ledger.sent("organizer-unknown");
  f.ledger.unknown("organizer-unknown");
  assert.throws(
    () => f.action("continue"),
    (e) => e.code === "UNKNOWN_COST",
  );
  assert.equal(f.calls().chat, 0);
});

test("changed saved context cannot publish a paid chat or trigger an automatic second call", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("chat1");
  assert.throws(
    () => f.put({ itemState: { item1: { group: "人工修改" } } }),
    (e) => e.code === "INPUT_LOCKED",
  );
  f.action("stop");
  f.put({ itemState: { item1: { group: "人工修改" } } });
  assert.throws(
    () => f.action("continue"),
    (e) => e.code === "INPUT_CHANGED",
  );
  assert.equal(f.store.record("packet").data.itemState.item1.group, "人工修改");
  assert.equal(f.calls().chat, 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
});

for (const corruption of ["result", "request", "lost-block"])
  test(`independent chat proof fences tenant ${corruption} rollback without a new charge`, async (t) => {
    const f = fixture(t);
    f.enqueue();
    await f.tasks.run("chat1");
    if (corruption === "result")
      f.store.db
        .prepare("UPDATE reading_blocks SET result=?")
        .run(
          JSON.stringify({ reply: "tampered", patch: { title: "tampered" } }),
        );
    if (corruption === "request")
      f.store.db.exec("DELETE FROM reading_chat_requests");
    if (corruption === "lost-block") {
      f.store.db.exec(
        "DELETE FROM reading_blocks; DELETE FROM reading_block_ranges; DELETE FROM reading_windows",
      );
      f.tasks.materials.clear();
    }
    try {
      await finish(f.tasks);
    } catch (e) {
      assert.equal(e.code, "SAFETY_RECONCILIATION");
    }
    assert.notEqual(f.tasks.get("chat1").state, "done");
    assert.equal(f.calls().chat, 1);
    assert.equal(f.ledger.wallet("synthetic").spent, 20);
    assert.equal(f.store.record("packet").data.result.items[0].title, "原事项");
    assert.throws(
      () => f.ledger.db.exec("DELETE FROM reading_chat_intents"),
      /IMMUTABLE_CHAT_INTENT/,
    );
    assert.throws(
      () => f.ledger.db.exec("DELETE FROM reading_chat_proofs"),
      /IMMUTABLE_CHAT_PROOF/,
    );
  });

test("paid chat envelope recovers after tenant block failure with its independent proof", async (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db.exec(
    "CREATE TRIGGER fail_chat_block BEFORE INSERT ON reading_blocks BEGIN SELECT RAISE(ABORT,'INJECTED_BLOCK_FAILURE'); END;",
  );
  assert.equal((await f.tasks.run("chat1")).state, "paused");
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_envelopes").get().n,
    1,
  );
  f.store.db.exec("DROP TRIGGER fail_chat_block");
  f.action("continue");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls().chat, 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  assert.equal(
    f.ledger.db.prepare("SELECT COUNT(*) n FROM reading_chat_proofs").get().n,
    1,
  );
});

test("chat shutdown keeps unknown risk and discards a late response", async (t) => {
  let enter, release;
  const entered = new Promise((r) => (enter = r)),
    held = new Promise((r) => (release = r));
  const f = fixture(t, {
    chatProvider: async () => {
      enter();
      await held;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: { reply: "late", patch: {} },
      };
    },
  });
  f.enqueue();
  const pending = f.tasks.run("chat1");
  await entered;
  f.tasks.finalizeShutdown();
  const snapshot = f.tasks.get("chat1");
  assert.equal(snapshot.reason, "SHUTDOWN_TIMEOUT");
  assert.ok(f.ledger.wallet("synthetic").unknownRisk > 0);
  release();
  await pending;
  assert.deepEqual(f.tasks.get("chat1"), snapshot);
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
  assert.equal(f.store.record("packet").data.itemState.item1, undefined);
});

for (const [options, reason] of [
  [{ siteDailyMicros: 1 }, "SITE_BUDGET"],
  [{ taskInflightMicros: 1 }, "TASK_INFLIGHT_BUDGET"],
])
  test(`chat cannot bypass shared ${reason}`, async (t) => {
    const f = fixture(t, { ledgerOptions: options });
    f.enqueue();
    const task = await finish(f.tasks);
    assert.equal(task.state, "paused");
    assert.equal(task.reason, reason);
    assert.equal(f.calls().chat, 0);
    assert.equal(f.ledger.wallet("synthetic").spent, 0);
  });

test("chat status and correction metadata follow the existing manual card rules", async (t) => {
  const f = fixture(t, {
    chatProvider: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { reply: "完成", patch: { status: "done" } },
    }),
  });
  f.enqueue();
  assert.equal((await finish(f.tasks)).state, "done");
  const packet = f.store.record("packet").data;
  assert.deepEqual(packet.doneIds, [0]);
  assert.equal(packet.itemState.item1.corrected, true);
  assert.equal(packet.itemState.item1.completedAt, "2026-10-30T08:00:00.000Z");
  assert.equal(packet.itemState.item1.history.length, 1);
});
