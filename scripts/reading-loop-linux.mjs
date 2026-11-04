import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createSyncService } from "../server/sync-server.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { ReadingTasks } from "../server/reading/tasks.mjs";
import { readingView, sourceLocation } from "../shared/reading-view.mjs";

const root = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(root)
)
  throw Error("SYNTHETIC_LINUX_ROOT_REQUIRED");
const directory = await mkdtemp(join(root, "loop-"));
const service = createSyncService({
  database: join(directory, "tenant.sqlite"),
  password: "synthetic-loop-only-passphrase",
});
const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
let tasks;
await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${service.server.address().port}`;
const request = async (path, body, device, method = "POST") => {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(device ? { Authorization: "Bearer " + device.token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  return { status: response.status, value };
};
try {
  const devices = [];
  for (const name of [
    "Windows source logical transport",
    "WeChat develop logical transport",
  ])
    devices.push(
      (
        await request("/api/v2/devices", {
          name,
          password: "synthetic-loop-only-passphrase",
        })
      ).value,
    );
  const win = devices[0],
    mini = devices[1];
  const put = async (data, device = win) =>
    request(
      "/api/v2/operations",
      {
        epoch: win.epoch,
        operation: {
          opId: crypto.randomUUID(),
          id: "packet",
          type: "put",
          baseVersion: service.store.record("packet")?.version || 0,
          data,
        },
      },
      device,
    );
  assert.equal(
    (
      await put({
        text: "",
        sources: [],
        attachments: [],
        captureDate: "2026-10-28",
        status: "pending",
        result: null,
      })
    ).status,
    200,
  );
  const body = Buffer.from(
    "合成课程报告要求，保留😀原文顺序。\n".repeat(20000) +
      "尾部唯一标记：提交附录",
  );
  const uploadStart = performance.now();
  const uploaded = await fetch(
    base + `/api/v2/attachments/packet/a?epoch=${win.epoch}`,
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + win.token,
        "Content-Type": "application/octet-stream",
        "X-Shixu-File-Name": encodeURIComponent("合成长材料.txt"),
        "X-Shixu-File-Type": "text/plain",
      },
      body,
    },
  );
  assert.equal(uploaded.status, 201);
  const { file } = await uploaded.json();
  const uploadMs = performance.now() - uploadStart;
  assert.equal((await put({ attachments: [file] }, mini)).status, 200);
  ledger.grantInitial("synthetic");
  ledger.freezePrice({
    id: "synthetic-price",
    model: "simulation",
    currency: "CNY",
    source: "synthetic fixture, not supplier pricing",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  const isolated = createLinuxReader({
    runtime: join(root, "runtime"),
    staging: "/run/" + basename(root),
  });
  let parsed = 0,
    providerCalls = 0,
    tailSeen = false;
  const readingMetrics = [];
  tasks = new ReadingTasks({
    store: service.store,
    account: "synthetic",
    ledger,
    priceId: "synthetic-price",
    modelVersion: "simulated/1",
    authorize: (id) =>
      assert.ok(
        service.store.db
          .prepare("SELECT 1 FROM sync_devices WHERE id=? AND revoked=0")
          .get(id),
      ),
    reader: async (f, options) => {
      const result = await isolated(f, options);
      parsed++;
      readingMetrics.push({ ...result.metrics, ...result.timing });
      return result.material;
    },
    provider: async (sources) => {
      providerCalls++;
      tailSeen ||= sources.some((s) =>
        s.text.includes("尾部唯一标记：提交附录"),
      );
      await new Promise((r) => setTimeout(r, 5));
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成整理响应",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成块" + providerCalls,
              summary: "仅验证传输、来源和发布协议",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [
                {
                  sourceId: sources[0].id,
                  quote: sources[0].text.slice(0, 15),
                },
              ],
            },
          ],
        },
      };
    },
  });
  tasks.enqueue({ id: "loop", packetId: "packet", deviceId: win.deviceId });
  assert.equal(
    (await put({ text: "离线修改保留" })).value.code,
    "INPUT_LOCKED",
  );
  const started = performance.now();
  let complete = false;
  const queryMs = [];
  const polling = (async () => {
    while (!complete) {
      for (const device of devices) {
        const t = performance.now();
        const response = await request(
          "/api/v2/changes?epoch=" + win.epoch,
          null,
          device,
          "GET",
        );
        assert.equal(response.status, 200);
        queryMs.push(performance.now() - t);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  try {
    for (let n = 0; n < 30; n++) {
      const t = await tasks.run("loop");
      if (t.state === "done") break;
      if (t.state !== "queued") throw Error(t.reason);
    }
  } finally {
    complete = true;
    await polling;
  }
  assert.equal(tasks.get("loop").state, "done");
  assert.equal(
    parsed,
    1,
    "unchanged original parsed only once across model steps",
  );
  assert.equal(tailSeen, true);
  const projections = [];
  for (const device of devices) {
    const { value } = await request(
      "/api/v2/changes?epoch=" + win.epoch,
      null,
      device,
      "GET",
    );
    const packet = value.records.find((r) => r.id === "packet").data;
    assert.equal(packet.sources.length, 0);
    const view = readingView(packet.readingCoverage);
    assert.equal(view[0].label, "完整读取");
    assert.ok(
      sourceLocation(
        packet.readingCoverage,
        packet.result.items[0].evidence[0].sourceId,
      ).includes("合成长材料.txt"),
    );
    projections.push({
      items: packet.result.items.length,
      coverage: view[0].label,
    });
  }
  assert.deepEqual(projections[0], projections[1]);
  queryMs.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        synthetic: true,
        realProviderCalls: 0,
        simulatedProviderCalls: providerCalls,
        bytes: body.length,
        uploadMs,
        endToEndWithSimulatedModelMs: performance.now() - started,
        parserRuns: parsed,
        readingMetrics,
        tailSeen,
        logicalClientProjections: projections,
        querySamples: queryMs.length,
        queryP95Ms: queryMs[Math.ceil(queryMs.length * 0.95) - 1],
        ledgerMicros: ledger.wallet("synthetic").spent,
        privacy:
          "full extracted text excluded from task and published packet sources; retained original remains in synthetic blob store",
      },
      null,
      2,
    ),
  );
} finally {
  tasks?.close();
  await new Promise((r) => service.server.close(r));
  ledger.close();
  await rm(directory, { recursive: true, force: true });
}
