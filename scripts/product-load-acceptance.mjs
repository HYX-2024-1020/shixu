import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createMultiUserService } from "../server/sync-multi-user.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { createBrokerClient } from "../server/reading/broker-service.mjs";
const require = createRequire(import.meta.url),
  { AccountWorkspace } = require("../desktop/accounts.cjs"),
  { DesktopStore } = require("../desktop/storage.cjs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const root = await mkdtemp(join(tmpdir(), "shixu-ten-account-"));
const ledger = new ReadingLedger(join(root, "billing.sqlite"));
ledger.freezePrice({
  id: "synthetic",
  model: "synthetic",
  currency: "CNY",
  source: "synthetic-only-no-provider",
  verifiedAt: 1,
  inputMicrosPerMillion: 1,
  cachedMicrosPerMillion: 0,
  outputMicrosPerMillion: 1,
});
const broker = process.env.SHIXU_LOAD_BROKER_SOCKET
  ? createBrokerClient(process.env.SHIXU_LOAD_BROKER_SOCKET)
  : null;
let calls = 0,
  active = 0,
  peak = 0,
  reads = 0,
  peakRss = 0;
const memory = setInterval(
  () => (peakRss = Math.max(peakRss, process.memoryUsage().rss)),
  25,
);
memory.unref();
const provider = async (sources) => {
  calls++;
  active++;
  peak = Math.max(peak, active);
  await pause(400);
  active--;
  return {
    usage: { prompt_tokens: 10, completion_tokens: 10 },
    result: {
      summary: "合成负载结果",
      warnings: [],
      items: [
        {
          kind: "note",
          title: "合成资料要点",
          summary: "合成摘要",
          facts: [],
          nextSteps: [],
          uncertainties: [],
          due: null,
          evidence: [
            { sourceId: sources[0].id, quote: sources[0].text.slice(0, 8) },
          ],
        },
      ],
    },
  };
};
const service = createMultiUserService({
  directory: join(root, "accounts"),
  secret: "synthetic-load-secret-".repeat(3),
  reading: {
    ledger,
    priceId: "synthetic",
    modelVersion: "synthetic",
    enabled: true,
    credentials: true,
    accountSafety: true,
    tenantSafety: true,
    reader: async (...args) => {
      reads++;
      return broker ? broker(...args) : readMaterial(...args);
    },
    provider,
  },
});
await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${service.server.address().port}`,
  clients = [],
  timings = [];
let clock = Date.now();
// Avoid spending a literal minute between synthetic registrations from the same
// loopback IP. Product rate limits remain enabled and unchanged.
service.credentials.now = () => clock;
try {
  const invites = service.registry.generate(10);
  for (let i = 0; i < 10; i++) {
    clock += 61000;
    const client = new AccountWorkspace({
      root: join(root, "client-" + i),
      local: new DesktopStore(join(root, "local-" + i)),
      serviceOrigin: base,
      seal: async (s) => Buffer.from(s),
      unseal: async (b) => b.toString(),
    });
    await client.init();
    await client.action("register", {
      username: "load-user-" + i,
      password: "synthetic-load-password",
      invite: invites[i].invite,
      deviceName: "负载合成设备" + i,
    });
    const body = Buffer.from(
      ("第" + i + "份合成课程通知，要求按时提交报告。\n").repeat(
        i % 2 ? 2000 : 200,
      ),
    );
    await client.call(
      "savePackets",
      [
        {
          id: "packet-" + i,
          text: "",
          sources: [],
          attachments: [
            {
              id: "original-" + i,
              name: "synthetic-" + i + ".txt",
              type: "text/plain",
              bytes: body,
            },
          ],
          captureDate: "2026-11-11",
          capturedAt: "2026-11-10T16:00:00Z",
          updatedAt: "2026-11-10T16:00:00Z",
          doneIds: [],
          result: null,
          status: "pending",
        },
      ],
      client.config.active,
    );
    await client.action("sync");
    clients.push(client);
  }
  const jobs = await Promise.all(
    clients.map((c, i) =>
      c.action("ai", { kind: "organize", packetId: "packet-" + i }),
    ),
  );
  const initialQueue = service.readingRoutes.snapshot();
  for (let round = 0; round < 8; round++) {
    await Promise.all(
      clients.map(async (c, i) => {
        const start = performance.now();
        await c.request(c.config.active, "GET", "/api/v4/storage");
        timings.push(performance.now() - start);
        const other = jobs[(i + 1) % 10].job;
        await assert.rejects(
          c.request(c.config.active, "GET", "/api/v4/tasks/" + other),
          (e) => e.code === "TASK_NOT_FOUND",
        );
      }),
    );
    await pause(50);
  }
  const deadline = Date.now() + 120000;
  while (service.readingRoutes.snapshot().accounts) {
    if (Date.now() > deadline) throw Error("LOAD_TIMEOUT");
    await pause(50);
  }
  const states = [];
  for (let i = 0; i < 10; i++) {
    const task = await clients[i].request(
      clients[i].config.active,
      "GET",
      "/api/v4/tasks/" + jobs[i].job,
    );
    states.push(task.state);
    assert.equal(task.state, "done");
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
  assert.ok(
    p95 < 1000,
    "basic query P95 must stay below one second excluding external network",
  );
  assert.ok(peak <= 3);
  assert.equal(reads, 10);
  assert.equal(calls, 10);
  assert.ok(
    peakRss < 640 * 1024 * 1024,
    "synthetic service plus ten client adapters must stay within the service memory ceiling",
  );
  ledger.audit();
  const result = {
    synthetic: true,
    accounts: 10,
    actualSignedWindowsAdapters: true,
    actualHTTP: true,
    actualBroker: !!broker,
    realProviderCalls: 0,
    simulatedProviderCalls: calls,
    originalReads: reads,
    peakModelConcurrency: peak,
    initialQueue,
    basicQueries: timings.length,
    basicQueryP95Ms: p95,
    peakProcessRssBytes: peakRss,
    maxRssKiB: process.resourceUsage().maxRSS,
    states,
    unknown: ledger.db
      .prepare("SELECT COUNT(*) n FROM reading_calls WHERE state='unknown'")
      .get().n,
  };
  const output = resolve(process.argv[2] || join(root, "acceptance.json"));
  await writeFile(output, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} finally {
  clearInterval(memory);
  await service.quiesce();
  ledger.close();
}
