import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pdfBytes } from "../server/reading/pdf-fixtures.mjs";
import { SyncStore } from "../server/sync-store.mjs";
import { createAttachmentStore } from "../server/sync-files.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { ReadingTasks } from "../server/reading/tasks.mjs";
import { createLinuxReader } from "../server/reading/linux-broker.mjs";
import { sha256 } from "../server/reading/material.mjs";
const base = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(base)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const staging = "/run/shixu-pdf-windows";
await mkdir(staging, { mode: 0o700 });
const directory = await mkdtemp(join(base, "window-task-"));
const store = new SyncStore(join(directory, "tenant.sqlite"));
createAttachmentStore(store);
const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
ledger.grantInitial("synthetic");
ledger.freezePrice({
  id: "fixture",
  model: "synthetic",
  currency: "CNY",
  source: "synthetic, not live provider pricing",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 100000,
  outputMicrosPerMillion: 1000000,
});
const pageText = ("资源".repeat(50) + "\n").repeat(400),
  tail = "不可假称已读的尾页";
const body = pdfBytes(
  [...Array.from({ length: 240 }, () => ({ text: pageText })), { text: tail }],
  { compress: true },
);
assert.equal(body.length, 531269, "same historical pressure sample");
const expectedHash = createHash("sha256");
for (let i = 0; i < 240; i++) expectedHash.update(pageText);
expectedHash.update(tail + "\n");
const expectedTextHash = expectedHash.digest("hex"),
  seen = createHash("sha256");
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
  );
put({
  text: "",
  attachments: [],
  sources: [],
  result: null,
  captureDate: "2026-10-29",
  status: "pending",
});
const file = store.files.put("packet", "pdf", {
  name: "resource.pdf",
  type: "application/pdf",
  body,
  epoch: store.epoch,
});
put({ attachments: [file] });
const isolated = createLinuxReader({
  runtime: "/opt/shixu-bcd-test-20261028/runtime",
  staging,
});
let calls = 0,
  tailSeen = false,
  maxWindowTextUnits = 0,
  tasks;
const windows = [];
try {
  tasks = new ReadingTasks({
    store,
    ledger,
    account: "synthetic",
    priceId: "fixture",
    modelVersion: "synthetic/1",
    authorize: (id) => assert.equal(id, device),
    reader: Object.assign(
      async (file, options) => {
        const output = await isolated(file, options);
        windows.push({
          request: options.pdfWindow,
          pagination: output.material.pagination,
          ...output.metrics,
        });
        return { ...output.material, timing: output.timing };
      },
      { pdfWindows: true },
    ),
    provider: async (sources) => {
      calls++;
      for (const source of sources) {
        seen.update(source.text);
        tailSeen ||= source.text.includes(tail);
      }
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成摘要",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成块" + calls,
              summary: "只验证有界读取与协议",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [
                {
                  sourceId: sources[0].id,
                  quote: sources[0].text.slice(0, 10),
                },
              ],
            },
          ],
        },
      };
    },
  });
  tasks.enqueue({ id: "windows", packetId: "packet", deviceId: device });
  const started = performance.now();
  for (
    let step = 0;
    step < 300 && tasks.get("windows").state === "queued";
    step++
  ) {
    await tasks.run("windows");
    maxWindowTextUnits = Math.max(
      maxWindowTextUnits,
      ...[...tasks.materials.values()].map((ms) =>
        ms.reduce(
          (n, m) => n + m.segments.reduce((n, s) => n + s.text.length, 0),
          0,
        ),
      ),
    );
  }
  assert.equal(tasks.get("windows").state, "done", tasks.get("windows").reason);
  assert.equal(seen.digest("hex"), expectedTextHash);
  assert.equal(tailSeen, true);
  const c = store.record("packet").data.readingCoverage[0];
  assert.deepEqual(
    c.covered.map((r) => r.page),
    Array.from({ length: 241 }, (_, i) => i + 1),
  );
  assert.ok(c.uncovered.every((r) => r.code === "PDF_VISUAL_UNREAD"));
  assert.equal(c.pagination.nextPage, null);
  assert.equal(new Set(c.covered.map((r) => r.sourceId)).size, 241);
  assert.ok(
    c.covered.every(
      (r, i) =>
        r.start === i * pageText.length &&
        r.end === r.start + (i === 240 ? tail.length + 1 : pageText.length),
    ),
  );
  assert.equal(
    store.record("packet").data.processingCoverage.pending.length,
    0,
  );
  const root = tasks.roots.stats("windows");
  assert.equal(root.calls, calls);
  assert.ok(root.checkpointCalls >= 120);
  assert.equal(ledger.wallet("synthetic").spent, calls * 20);
  assert.equal(tasks.materials.size, 0);
  assert.ok(
    !JSON.stringify(tasks.windows.rows("windows")).includes(
      pageText.slice(0, 100),
    ),
  );
  const report = {
    synthetic: true,
    realProviderCalls: 0,
    originalBytes: body.length,
    originalHash: sha256(body),
    independentFullTextHash: expectedTextHash,
    totalPages: 241,
    windows: windows.length,
    simulatedCalls: calls,
    checkpointCalls: root.checkpointCalls,
    spentMicros: ledger.wallet("synthetic").spent,
    elapsedMs: performance.now() - started,
    maxWindowTextUnits,
    maxWorkerRssKiB: Math.max(...windows.map((w) => w.maxRssKiB)),
    tailSeen,
    completeTextOrderCoordinatesAndSourcesChecked: true,
    visualContentsUnread: true,
    samples: windows,
  };
  await writeFile(
    base + "/pdf-windows-task.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  tasks?.close();
  ledger.close();
  store.close();
  await rm(directory, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
}
