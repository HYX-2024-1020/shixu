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
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import { xlsxBytes, inline } from "./xlsx-fixtures.mjs";
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
    name = "合成.txt",
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
    name,
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

test("empty/unreadable XLSX has no provider cost; partial worksheet rows retain exact source coordinates at publication", async (t) => {
  const empty = fixture(t, {
    name: "空.xlsx",
    text: xlsxBytes([
      { name: "空表", xml: `<row r="1">${inline("A1", " ")}</row>` },
    ]),
  });
  empty.enqueue();
  assert.equal((await finish(empty.tasks)).reason, "NO_READABLE_MATERIAL");
  assert.equal(empty.calls(), 0);
  assert.equal(empty.ledger.wallet("synthetic").spent, 0);
  const partial = fixture(t, {
    name: "合成.xlsx",
    text: xlsxBytes([
      {
        name: "安全表",
        xml: `<row r="1">${inline("A1", "安全资料")}</row><row r="7"><c r="B7"><f>1+1</f><v>999</v></c></row>`,
      },
    ]),
  });
  partial.enqueue();
  assert.equal((await finish(partial.tasks)).state, "done");
  const coverage = partial.store.record("packet").data.readingCoverage[0];
  assert.equal(coverage.state, "partial");
  assert.ok(
    coverage.covered.some(
      (r) => r.sheet === "安全表" && r.row === 7 && r.column === 2,
    ),
  );
  assert.ok(
    coverage.uncovered.some(
      (r) => r.code === "XLSX_FORMULA_CACHED" && r.cell === "B7",
    ),
  );
});

test("orderly shutdown interrupts queued tasks durably without consuming or automatically restarting them", (t) => {
  const f = fixture(t);
  f.enqueue();
  f.tasks.close();
  const restarted = new ReadingTasks(f.taskArgs);
  assert.equal(restarted.get("task").state, "interrupted");
  assert.equal(restarted.get("task").reason, "SHUTDOWN");
  assert.equal(f.calls(), 0);
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
  restarted.close();
});

for (const rejects of [false, true]) {
  test(`shutdown finalization preserves unknown cost and discards a late ${rejects ? "failure" : "success"} without accessing closed databases`, async (t) => {
    let release, entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const f = fixture(t, {
      provider: async (sources) => {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
        if (rejects) throw Error("late synthetic failure");
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: result(sources),
        };
      },
    });
    f.enqueue();
    const pending = f.tasks.run("task");
    await started;
    f.tasks.close();
    f.tasks.finalizeShutdown();
    assert.equal(f.tasks.get("task").state, "interrupted");
    assert.equal(f.tasks.get("task").reason, "SHUTDOWN_TIMEOUT");
    assert.equal(
      f.ledger.db.prepare("SELECT state FROM reading_calls").get().state,
      "unknown",
    );
    assert.throws(
      () => f.action("continue"),
      (e) => e.code === "SERVICE_CLOSING",
    );
    const restarted = new ReadingTasks(f.taskArgs);
    const task = restarted.get("task");
    assert.throws(
      () =>
        restarted.action(
          "task",
          {
            operationId: "restart",
            expectedGeneration: task.generation,
            expectedRevision: task.input_revision,
          },
          "continue",
        ),
      (e) => e.code === "UNKNOWN_COST",
    );
    restarted.close();
    assert.equal(f.store.record("packet").data.result, null);
    // Throwing DB entry points represent stores already closed by the host.
    const tenantPrepare = f.store.db.prepare,
      ledgerPrepare = f.ledger.db.prepare;
    f.store.db.prepare = f.ledger.db.prepare = () => {
      throw Error("DATABASE_ALREADY_CLOSED");
    };
    try {
      release();
      assert.equal((await pending).state, "interrupted");
    } finally {
      f.store.db.prepare = tenantPrepare;
      f.ledger.db.prepare = ledgerPrepare;
    }
    assert.equal(f.ledger.audit().valid, true);
    assert.equal(
      f.ledger.db.prepare("SELECT state FROM reading_calls").get().state,
      "unknown",
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
      0,
    );
  });
}

test("a reader that outlives shutdown cannot publish and needs active-time reconciliation before continuing", async (t) => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const f = fixture(t, {
    reader: async (file) => {
      entered();
      await new Promise((resolve) => {
        release = resolve;
      });
      return { ...readMaterial(file), timing: { waitingMs: 100 } };
    },
  });
  f.enqueue();
  const pending = f.tasks.run("task");
  await started;
  f.tasks.finalizeShutdown();
  assert.equal(f.tasks.get("task").reason, "SHUTDOWN_TIME_UNCERTAIN");
  const restarted = new ReadingTasks(f.taskArgs);
  const task = restarted.get("task");
  assert.throws(
    () =>
      restarted.action(
        "task",
        {
          operationId: "restart",
          expectedGeneration: task.generation,
          expectedRevision: task.input_revision,
        },
        "continue",
      ),
    (e) => e.code === "ACTIVE_TIME_RECONCILIATION",
  );
  restarted.close();
  release();
  await pending;
  assert.equal(f.calls(), 0);
  assert.equal(f.ledger.wallet("synthetic").spent, 0);
  assert.equal(f.store.record("packet").data.result, null);
});

test("another authorized device can accept paid partial blocks atomically; purge cannot refund or resurrect them", async (t) => {
  const f = fixture(t, {
    text: "合成材料正文".repeat(45000),
    provider: async (sources, signal, n) => {
      if (n === 2) throw Error("synthetic timeout");
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  f.enqueue();
  await f.tasks.run("task");
  await f.tasks.run("task");
  const task = f.tasks.get("task");
  assert.equal(task.state, "paused");
  const request = {
    operationId: "accept",
    expectedGeneration: task.generation,
    expectedRevision: task.input_revision,
  };
  const response = f.tasks.action(
    "task",
    request,
    "accept-partial",
    f.wechat.deviceId,
  );
  assert.equal(response.state, "partial");
  assert.deepEqual(
    f.tasks.action("task", request, "accept-partial", f.wechat.deviceId),
    { ...response },
  );
  assert.equal(f.store.record("packet").data.processingCoverage.partial, true);
  assert.ok(
    f.store.record("packet").data.processingCoverage.pending.length > 0,
  );
  assert.ok(
    f.store.record("packet").data.processingCoverage.processed.length > 0,
  );
  const spent = f.ledger.wallet("synthetic").spent;
  const purged = f.tasks.action(
    "task",
    {
      operationId: "purge",
      expectedGeneration: response.generation,
      expectedRevision: response.input_revision,
    },
    "purge",
    f.wechat.deviceId,
  );
  assert.equal(purged.state, "purged");
  assert.equal(f.ledger.wallet("synthetic").spent, spent);
  assert.equal(f.store.record("packet").data.result.items.length, 1);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_blocks").get().n,
    0,
  );
  assert.throws(
    () => f.action("continue", "after-purge"),
    (e) => e.code === "INVALID_TASK_TRANSITION",
  );
});

test("24-call checkpoint records progress and does not cap a longer task", async (t) => {
  const f = fixture(t, { text: "合成正文".repeat(810000) });
  f.enqueue();
  let task;
  for (let i = 0; i < 35; i++) {
    task = await f.tasks.run("task");
    if (task.state !== "queued") break;
  }
  assert.equal(task.state, "done");
  assert.ok(f.calls() > 24);
  const checkpoint = f.store.db
    .prepare("SELECT * FROM reading_checkpoints")
    .get();
  assert.equal(checkpoint.calls, 24);
  assert.equal(checkpoint.completed, 24);
  assert.ok(checkpoint.spent > 0);
});

test("a no-progress checkpoint remains paused across repeated manual continue, without new calls", async (t) => {
  const f = fixture(t);
  f.enqueue();
  f.store.db.prepare("UPDATE reading_tasks SET calls=24 WHERE id='task'").run();
  assert.equal((await f.tasks.run("task")).reason, "CHECKPOINT_NO_PROGRESS");
  f.action("continue", "retry-checkpoint");
  assert.equal((await f.tasks.run("task")).reason, "CHECKPOINT_NO_PROGRESS");
  assert.equal(f.calls(), 0);
});

test("cleared originals require a matching reupload before paid blocks can resume", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop", "before-clear");
  const original = f.store.files.get("packet", "a");
  f.store.files.purge("packet");
  assert.throws(
    () => f.action("continue", "missing-original"),
    (e) => e.code === "REUPLOAD_REQUIRED",
  );
  f.store.files.put("packet", "a", {
    name: original.name,
    type: original.type,
    body: original.body,
    epoch: f.store.epoch,
  });
  f.action("continue", "matching-reupload");
  assert.equal((await finish(f.tasks)).state, "done");
  assert.equal(f.calls(), 1);
});

test("broker queue time is excluded and a provider step obeys the remaining cumulative active deadline", async (t) => {
  const f = fixture(t, {
    reader: async (file) => {
      await new Promise((done) => setTimeout(done, 450));
      return { ...readMaterial(file), timing: { waitingMs: 440 } };
    },
  });
  f.tasks.activeLimitMs = 300;
  f.enqueue();
  assert.equal((await f.tasks.run("task")).state, "queued");
  assert.ok(f.tasks.get("task").active_ms < 300);
  const g = fixture(t, {
    provider: async (sources, signal) =>
      new Promise((done, reject) => {
        const timer = setTimeout(
          () => reject(Error("failed to enforce deadline")),
          1000,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Error("abort"));
          },
          { once: true },
        );
      }),
  });
  g.tasks.activeLimitMs = 80;
  g.enqueue();
  g.store.db
    .prepare("UPDATE reading_tasks SET active_ms=40 WHERE id='task'")
    .run();
  const start = performance.now();
  assert.equal((await g.tasks.run("task")).reason, "UNKNOWN_COST");
  assert.ok(performance.now() - start < 600);
});
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
  const original = f.store.files.get("packet", "a");
  assert.equal(
    f.store.files.put("packet", "a", {
      name: original.name,
      type: original.type,
      body: original.body,
      epoch: f.store.epoch,
    }).hash,
    original.hash,
  );
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

test("unreadable DOCX never spends; damaged DOCX tail publishes only complete safe paragraphs and exact missing metadata", async (t) => {
  const unreadable = fixture(t, {
    name: "损坏.docx",
    text: docxBytes("<w:p><w:r><w:t>损坏尾部"),
  });
  unreadable.enqueue();
  assert.equal(
    (await unreadable.tasks.run("task")).reason,
    "NO_READABLE_MATERIAL",
  );
  assert.equal(unreadable.calls(), 0);
  assert.equal(unreadable.ledger.wallet("synthetic").spent, 0);
  const partial = fixture(t, {
    name: "部分.docx",
    text: docxBytes(
      paragraph("可以安全读取的段落") + "<w:p><w:r><w:t>损坏尾部",
    ),
    provider: async (sources) => {
      assert.equal(sources.map((s) => s.text).join(""), "可以安全读取的段落\n");
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: result(sources),
      };
    },
  });
  partial.enqueue();
  assert.equal((await finish(partial.tasks)).state, "done");
  const record = partial.store.record("packet");
  assert.equal(record.data.readingCoverage[0].state, "partial");
  assert.ok(
    record.data.readingCoverage[0].uncovered.some(
      (r) => r.code === "DOCX_XML_MALFORMED",
    ),
  );
  assert.equal(partial.calls(), 1);
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
