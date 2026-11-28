import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyncStore } from "../sync-store.mjs";
import { createAttachmentStore } from "../sync-files.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingTasks } from "./tasks.mjs";
import { readMaterial } from "./material.mjs";

export function mergeFixture(t, { merge, price, provider: realProvider, sourceText, sourceBytes, sourceName, reader = readMaterial } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-merge-"));
  const store = new SyncStore(join(directory, "tenant.sqlite"));
  createAttachmentStore(store);
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.freezePrice(
    price || {
      id: "synthetic",
      model: "synthetic",
      currency: "CNY",
      source: "synthetic",
      verifiedAt: 1,
      inputMicrosPerMillion: 1000000,
      cachedMicrosPerMillion: 100000,
      outputMicrosPerMillion: 1000000,
    },
  );
  ledger.grantInitial("synthetic");
  const device = store.createDevice("synthetic").deviceId;
  const text = sourceText ||
    "报告编号A7319；提交实验报告，格式PDF，文件名学号_姓名。\n".repeat(4500);
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
    );
  put({
    text: "",
    captureDate: "2026-10-31",
    sources: [],
    attachments: [],
    result: null,
    status: "pending",
  });
  const file = store.files.put("packet", "synthetic-text", {
    name: sourceName || "合成报告.txt",
    body: sourceBytes || Buffer.from(text),
    type: "text/plain",
    epoch: store.epoch,
  });
  put({ attachments: [file] });
  let organizeCalls = 0,
    mergeCalls = 0;
  const provider =
    realProvider ||
    (async (sources) => {
      organizeCalls++;
      const id = sources[0].id,
        text = sources[0].text;
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成整理",
          warnings: [],
          items: [
            {
              kind: "task",
              title: organizeCalls === 1 ? "提交实验报告" : "交实验文档",
              summary: organizeCalls === 1 ? "格式PDF" : "文件名学号_姓名",
              facts: [organizeCalls === 1 ? "格式PDF" : "文件名学号_姓名"],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [{ sourceId: id, quote: text.slice(0, 8) }],
            },
          ],
        },
      };
    });
  if (!realProvider)
    provider.merge = async (...args) => {
      mergeCalls++;
      if (merge) return merge(...args);
      const context = JSON.parse(args[0][0].text),
        ids = context.items.map((i) => i.id);
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: { same: [[ids[0], ids[1]]], related: [] },
      };
    };
  const args = {
    store,
    ledger,
    account: "synthetic",
    reader,
    provider,
    priceId: price?.id || "synthetic",
    modelVersion: price?.model || "synthetic/1",
    authorize: (id) => assert.equal(id, device),
  };
  const tasks = new ReadingTasks(args);
  t?.after(() => {
    tasks.close();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const enqueue = (id = "task") =>
    tasks.enqueue({ id, packetId: "packet", deviceId: device });
  const action = (action, id = "task", engine = tasks) => {
    const task = engine.get(id);
    return engine.action(
      id,
      {
        operationId: crypto.randomUUID(),
        expectedGeneration: task.generation,
        expectedRevision: task.input_revision,
        expectedMaintenanceOperation: engine.maintenanceOperation(id),
      },
      action,
      device,
    );
  };
  const untilMerge = async (id = "task") => {
    for (
      let i = 0;
      i < 12 && !tasks.merge.active(id) && tasks.get(id).state === "queued";
      i++
    )
      await tasks.run(id);
    assert.equal(tasks.merge.active(id), true, JSON.stringify(tasks.get(id)));
  };
  return {
    tasks,
    args,
    store,
    ledger,
    device,
    put,
    enqueue,
    action,
    untilMerge,
    directory,
    calls: () => ({ organize: organizeCalls, merge: mergeCalls }),
  };
}
export async function finishMerge(tasks, id = "task") {
  for (let i = 0; i < 30 && tasks.get(id)?.state === "queued"; i++)
    await tasks.run(id);
  return tasks.get(id);
}
