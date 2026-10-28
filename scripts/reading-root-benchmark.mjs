import assert from "node:assert/strict";
import { SyncStore } from "../server/sync-store.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { ReadingTasks } from "../server/reading/tasks.mjs";
import { createReadingRoutes } from "../server/reading/routes.mjs";

// Pure synthetic, in-memory databases; no provider/network/originals. Exercise
// both a long root (SQL parameter batching) and same-ID cross-account billing.
const store = new SyncStore(":memory:");
const ledger = new ReadingLedger(":memory:");
const observations = [];
try {
  for (const account of ["synthetic", "other"]) ledger.grantInitial(account);
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic, not a live tariff",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 1000000,
    outputMicrosPerMillion: 1000000,
  });
  const tasks = new ReadingTasks({
    store,
    ledger,
    account: "synthetic",
    reader() {
      throw Error("UNEXPECTED_READER");
    },
    provider() {
      throw Error("UNEXPECTED_PROVIDER");
    },
    priceId: "synthetic",
    modelVersion: "synthetic",
    authorize() {},
  });
  const insert = store.db.prepare(
    "INSERT INTO reading_tasks(id,packet,device,input_revision,base_version,state,calls,active_ms) VALUES(?,'packet','device','revision',0,'purged',1,32)",
  );
  const pay = (account, task, suffix) => {
    const callId = account + "_" + suffix;
    ledger.reserve({
      callId,
      account,
      task,
      block: suffix,
      generation: 1,
      priceId: "synthetic",
      maxPromptTokens: 10,
      maxOutputTokens: 10,
    });
    ledger.sent(callId);
    ledger.settle(callId, { prompt_tokens: 10, completion_tokens: 10 });
  };
  let count = 0;
  for (const size of [1, 100, 1000]) {
    while (count < size) {
      const id = "task_" + count;
      insert.run(id);
      tasks.roots.attach(tasks.get(id));
      pay("synthetic", id, String(count));
      if (count % 10 === 0) pay("other", id, String(count));
      tasks.roots.progress(id, "fingerprint_" + count);
      count++;
    }
    const samples = [];
    for (let n = 0; n < 5; n++) {
      const started = performance.now();
      const root = tasks.roots.stats("task_0");
      samples.push(performance.now() - started);
      assert.equal(root.id, "task_0");
      assert.equal(root.calls, size);
      assert.equal(root.activeMs, size * 32);
      assert.equal(root.spent, size * 20);
      assert.equal(root.completed, size);
      assert.equal(root.unknownRisk, 0);
      assert.equal(root.reason, "");
    }
    samples.sort((a, b) => a - b);
    observations.push({
      historicalTasks: size,
      repeats: 5,
      p50Ms: samples[2],
      p95Ms: samples[4],
      allCountersVerified: true,
    });
  }
  assert.equal(ledger.audit().valid, true);
  const routes = createReadingRoutes({
    ledger,
    reader() {
      throw Error("UNEXPECTED_READER");
    },
    provider() {
      throw Error("UNEXPECTED_PROVIDER");
    },
    priceId: "synthetic",
    modelVersion: "synthetic",
    authorize() {},
  });
  const request = () =>
    routes.handle({
      account: "synthetic",
      device: "device",
      store,
      method: "GET",
      url: new URL("http://localhost/api/v4/tasks"),
    });
  await request(); // Attach/upgrade separately from a warm query observation.
  const listSamples = [];
  for (let n = 0; n < 5; n++) {
    const started = performance.now();
    const list = (await request()).tasks;
    listSamples.push(performance.now() - started);
    assert.equal(list.length, 100);
    assert.ok(
      list.every(
        (t) =>
          t.rootTaskId === "task_0" &&
          t.rootCalls === 1000 &&
          t.rootSpent === 20000,
      ),
    );
  }
  listSamples.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        realProviderCalls: 0,
        node: process.version,
        platform: process.platform,
        database:
          "in-memory, warm same-process queries, not production disk latency",
        p95Method: "nearest rank, 5 samples => maximum",
        observations,
        taskList: {
          returned: 100,
          historical: 1000,
          repeats: 5,
          p50Ms: listSamples[2],
          p95Ms: listSamples[4],
          allCountersVerified: true,
        },
        maxRssKiB: process.resourceUsage().maxRSS,
      },
      null,
      2,
    ),
  );
  tasks.close();
  await routes.close();
} finally {
  ledger.close();
  store.close();
}
