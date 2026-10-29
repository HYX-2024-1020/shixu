import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SyncStore } from "../server/sync-store.mjs";
import { createAttachmentStore } from "../server/sync-files.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { ReadingTasks } from "../server/reading/tasks.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { sha256 } from "../server/reading/material.mjs";
import { archiveSample } from "../server/reading/archive-fixtures.mjs";
const base = resolve(process.argv[2] || "");
if (process.platform !== "linux" || process.getuid() !== 0 || !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)) throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-reuse-benchmark";
await mkdir(staging, { mode: 0o700 });
const isolated = createLinuxReader({ runtime: "/opt/shixu-bcd-test-20261028/runtime", staging });
const sample = archiveSample({ long: true });
const report = { synthetic: true, realProviderCalls: 0, repetitions: 5,
  originalBytes: sample.body.length, originalHash: sha256(sample.body),
  independentTextHash: sha256(sample.expectedText), runs: [] };
try {
  for (let repetition = 0; repetition < 5; repetition++) {
    const directory = await mkdtemp(join(base, "benchmark-"));
    const store = new SyncStore(join(directory, "tenant.sqlite"));
    createAttachmentStore(store);
    const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
    ledger.grantInitial("synthetic");
    ledger.freezePrice({ id: "fixture", model: "synthetic", currency: "CNY", source: "synthetic, not provider pricing", verifiedAt: 1,
      inputMicrosPerMillion: 1000000, cachedMicrosPerMillion: 100000, outputMicrosPerMillion: 1000000 });
    const device = store.createDevice("synthetic").deviceId;
    let tasks, calls = 0;
    const metrics = [];
    const put = data => store.apply(device, { opId: crypto.randomUUID(), id: "packet", type: "put",
      baseVersion: store.record("packet")?.version || 0, data }, store.epoch);
    const finish = async id => {
      for (let n = 0; n < 20 && tasks.get(id).state === "queued"; n++) await tasks.run(id);
      assert.equal(tasks.get(id).state, "done", tasks.get(id).reason);
    };
    try {
      put({ text: "", attachments: [], sources: [], captureDate: "2026-10-28", status: "pending", result: null });
      const file = store.files.put("packet", "a", { name: sample.name, type: sample.type, body: sample.body, epoch: store.epoch });
      put({ attachments: [file] });
      tasks = new ReadingTasks({ store, account: "synthetic", ledger, priceId: "fixture", modelVersion: "synthetic/1",
        authorize: id => assert.equal(id, device),
        reader: async (file, options) => {
          const output = await isolated(file, options);
          assert.equal(sha256(output.material.segments.map(s => s.text).join("")),
            sha256(file.id === "input" ? "补充新的材料要求" : sample.expectedText));
          metrics.push({ id: file.id, ...output.metrics });
          return { ...output.material, timing: output.timing };
        },
        provider: async sources => {
          calls++;
          return { usage: { prompt_tokens: 10, completion_tokens: 10 }, result: {
            summary: "合成摘要", warnings: [], items: [{ kind: "note", title: "合成事项", summary: "合成结果",
              facts: [], nextSteps: [], uncertainties: [], due: null,
              evidence: [{ sourceId: sources[0].id, quote: sources[0].text.slice(0, 10) }] }] } };
        } });
      tasks.enqueue({ id: "before", packetId: "packet", deviceId: device });
      const initialAt = performance.now();
      await finish("before");
      const initialMs = performance.now() - initialAt, initialCalls = calls;
      const before = structuredClone(store.record("packet").data.result);
      put({ text: "补充新的材料要求" });
      tasks.enqueue({ id: "after", packetId: "packet", deviceId: device });
      const revisedAt = performance.now();
      await finish("after");
      const revisedMs = performance.now() - revisedAt;
      assert.equal(calls, initialCalls + 1);
      assert.equal(tasks.reuse.count("after"), initialCalls);
      assert.deepEqual(store.record("packet").data.result.items.slice(1), before.items);
      assert.equal(tasks.roots.stats("after").completed, calls);
      assert.equal(ledger.wallet("synthetic").spent, calls * 20);
      report.runs.push({ initialMs, revisedMs, initialCalls, newCalls: 1, reusedBlocks: tasks.reuse.count("after"),
        rootCalls: tasks.roots.stats("after").calls, rootCompleted: tasks.roots.stats("after").completed,
        spentMicros: ledger.wallet("synthetic").spent, metrics });
    } finally {
      tasks?.close(); ledger.close(); store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
  const times = report.runs.map(r => r.revisedMs).sort((a,b) => a-b);
  report.revisedP50Ms = times[2]; report.revisedP95Ms = times[4];
  report.maxWorkerRssKiB = Math.max(...report.runs.flatMap(r => r.metrics.map(m => m.maxRssKiB)));
  await writeFile(base + "/reuse-benchmark.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await rm(staging, { recursive: true, force: true }); }
