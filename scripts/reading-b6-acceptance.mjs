import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SyncStore } from "../server/sync-store.mjs";
import { createAttachmentStore } from "../server/sync-files.mjs";
import { ReadingLedger, beijingDay } from "../server/reading/ledger.mjs";
import { ReadingTasks } from "../server/reading/tasks.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
import { createDeepSeekReadingProvider, deepseekPriceSnapshots } from "../server/reading/deepseek.mjs";

const directory = process.argv[2];
const config = process.argv[3];
const now = Date.now();
if (!directory || !config || process.env.SHIXU_VERIFIED_PRICE_DAY !== beijingDay(now))
  throw Error("B6_VERIFIED_DAY_AND_ISOLATED_DIRECTORY_REQUIRED");
const period = process.env.SHIXU_VERIFIED_PRICE_PERIOD;
if (!["peak", "offpeak"].includes(period)) throw Error("B6_VERIFIED_PERIOD_REQUIRED");
const beijingHour = (time) => new Date(time + 8 * 3600000).getUTCHours();
const isPeakHour = (hour) => (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
const startPeakHour = isPeakHour(beijingHour(now));
if (period === "peak" && !startPeakHour) throw Error("B6_VERIFIED_PERIOD_CHANGED");
let price = deepseekPriceSnapshots(now)[period === "peak" ? 0 : 1];
const prepareOnly = config === "--prepare-only";
const docxRetest = process.argv[4] === "--docx-retest";
const finalPair = process.argv[4] === "--final-pair";
const sendLimit = finalPair ? 6 : 16;
const reserveLimit = finalPair ? 2_000_000 : 4_000_000;
const key = prepareOnly ? "synthetic-prepare-only" :
  /^DEEPSEEK_API_KEY=([A-Za-z0-9_-]{16,256})\r?$/m.exec(readFileSync(config, "utf8"))?.[1];
if (!key) throw Error("B6_TEST_KEY_UNAVAILABLE");
if (docxRetest) {
  if (prepareOnly) throw Error("B6_INITIAL_BATCH_REQUIRED");
  closeSync(openSync(join(directory, "paid-batch-started"), "r"));
}
if (!prepareOnly) closeSync(openSync(join(directory, docxRetest ? "docx-retest-started" : "paid-batch-started"), "wx", 0o600));
const ledger = new ReadingLedger(prepareOnly ? ":memory:" : join(directory, "billing.sqlite"));
let sends = docxRetest ? ledger.db.prepare("SELECT COUNT(*) AS n FROM reading_calls").get().n : 0;
if (docxRetest && (sends < 1 || sends >= 16 ||
    ledger.db.prepare("SELECT 1 FROM reading_calls WHERE state!='settled' LIMIT 1").get())) {
  ledger.close();
  throw Error("B6_INITIAL_BATCH_UNRESOLVED");
}
const provider = createDeepSeekReadingProvider({
  apiKey: key, priceAt: () => price.id,
  fetcher: (...args) => {
    if (prepareOnly) throw Error("B6_PREPARE_NO_NETWORK");
    const current = Date.now();
    if (beijingDay(current) !== beijingDay(now) ||
        isPeakHour(beijingHour(current)) !== startPeakHour || sends >= sendLimit)
      throw Error("B6_SEND_LIMIT");
    const totals = ledger.db.prepare(
      "SELECT COALESCE(SUM(reserved),0) AS reserved FROM reading_calls",
    ).get();
    if (totals.reserved > reserveLimit) throw Error("B6_RESERVATION_LIMIT");
    sends++;
    return fetch(...args);
  },
});
for (const stage of [provider, provider.merge, provider.association, provider.reviewVisual]) {
  const prepare = stage.prepare;
  stage.prepare = (...args) => {
    const result = prepare(...args);
    if (result.maxPromptTokens > 100_000 || result.maxOutputTokens > 4000)
      throw Error("B6_REQUEST_LIMIT");
    return result;
  };
}
const text = (name, content) => ({ name, body: Buffer.from(content) });
const file = (name, path) => ({ name, body: readFileSync(path) });
const cases = [
  { id: "pdf", files: [file("合成扫描通知.pdf", new URL("../server/reading/fixtures/pdf-scan-notice.pdf", import.meta.url))] },
  { id: "docx", files: [file("合成Office通知.docx", join(directory, "notice.docx"))] },
  { id: "notice", files: [
    text("课程通知一.txt", "算法课通知。A7319：请提交实验报告，格式PDF。B7320是同课程另一份作业，须分别提交。"),
    text("课程通知二.txt", "算法课补充。A7319实验报告命名为学号_姓名，要求说明算法与时间复杂度。C7321是独立习题。"),
  ] },
  { id: "history", files: [text("算法课通知.txt", "算法课实验A7319，提交PDF报告并另附UTF-8源代码。截止2026-11-03 16:45。")] },
];
if (sha256(cases[1].files[0].body) !== "8ea7d9b4160dc6525a9078b629077ed81633c80237273cf36a060063531539ea")
  throw Error("B6_DOCX_SAMPLE_MISMATCH");
const reader = Object.assign(readMaterial.bind(null), {
  pdfWindows: true, officeWindows: true, pdfVisualWindows: true, imageWindows: true,
});
function seedHistory(put) {
  for (const [index, number, date] of [
    [0, "A7319", "2026-11-03"], [1, "B7320", "2026-11-03"],
    [2, "A7319", "2026-11-10"], [3, "A7319", "2026-11-03"],
  ]) {
    const sourceId = "old-source-" + index;
    const due = { date, time: "16:45", anchor: date + " 16:45", sourceId };
    const quote = `算法课实验${number}，提交PDF报告，截止${due.anchor}。`;
    put("old" + index, {
      text: "", sources: [], attachments: [], status: "ready", captureDate: "2026-10-31",
      itemIds: ["old-item"], doneIds: index === 3 ? [0] : [],
      itemState: index === 3 ? { "old-item": { status: "done" } } : {},
      result: { summary: "合成历史", warnings: [], items: [{
        kind: "task", title: "提交算法实验" + number, summary: "算法课实验报告",
        facts: ["实验编号" + number, "格式PDF"], nextSteps: [], uncertainties: [],
        due, evidence: [{ sourceId, quote }],
      }] },
    });
  }
}
try {
  if (docxRetest) {
    const prior = ledger.db.prepare("SELECT body FROM reading_prices WHERE id=?").get(price.id);
    if (!prior) throw Error("B6_INITIAL_TARIFF_REQUIRED");
    const frozen = JSON.parse(prior.body);
    if (Object.keys(price).some(key => key !== "verifiedAt" && price[key] !== frozen[key]))
      throw Error("B6_INITIAL_TARIFF_CHANGED");
    price = frozen;
  }
  ledger.freezePrice(price);
  const selected = docxRetest ? [{ ...cases[1], id: "docx-retest" }]
    : finalPair ? cases.filter(({ id }) => id === "pdf" || id === "notice") : cases;
  for (const { id, files } of selected) {
    if (prepareOnly) {
      for (const { name, body } of files) {
        const hash = sha256(body);
        const material = await reader({ id, name, body, size: body.length, hash }, id === "pdf"
          ? { pdfVisualWindow: { page: 1, tile: 1, offset: 0 } }
          : id === "docx" ? { officeWindow: { text: 1, image: 0, tile: 1, offset: 0 } } : {});
        if (!material.segments.length) throw Error("B6_SAMPLE_UNREADABLE:" + id);
        console.log(JSON.stringify({ id, hash, state: material.state, sends }));
      }
      continue;
    }
    const store = new SyncStore(join(directory, id + ".sqlite"));
    let tasks;
    try {
      ledger.grantInitial(id);
      createAttachmentStore(store);
      const device = store.createDevice("synthetic").deviceId;
      const put = (record, data) => store.apply(device, {
        id: record, opId: crypto.randomUUID(), type: "put",
        baseVersion: store.record(record)?.version || 0, data,
      }, store.epoch);
      if (id === "history") seedHistory(put);
      const packet = { text: "", captureDate: "2026-10-31", sources: [], attachments: [], status: "pending" };
      put("packet", packet);
      packet.attachments = files.map(({ name, body }, index) => store.files.put("packet", "file" + index, {
        name, body, type: "application/octet-stream", epoch: store.epoch,
      }));
      put("packet", packet);
      tasks = new ReadingTasks({
        store, ledger, account: id, reader, provider, priceId: price.id,
        modelVersion: price.model, authorize: () => {},
      });
      tasks.enqueue({ id: "task", packetId: "packet", deviceId: device });
      for (let i = 0; i < 30 && tasks.get("task")?.state === "queued"; i++)
        await tasks.run("task");
      const task = tasks.get("task");
      const result = store.record("packet").data;
      const calls = ledger.db.prepare("SELECT id,state,reserved,actual FROM reading_calls WHERE account=?").all(id);
      writeFileSync(join(directory, id + ".json"), JSON.stringify({
        id, state: task.state, reason: task.reason, inputHashes: files.map(f => sha256(f.body)),
        result: result.result, association: result.association, historyAssociation: result.historyAssociation,
        coverage: result.readingCoverage, calls: calls.map(call => ({ ...call, receipt: ledger.receipts.review(call.id) })),
      }, null, 2));
      console.log(JSON.stringify({ id, state: task.state, reason: task.reason, sends, spent: ledger.wallet(id).spent }));
      if (calls.some(c => ["sent", "unknown"].includes(c.state)) || sends >= sendLimit) break;
    } finally {
      tasks?.close();
      store.close();
    }
  }
} finally {
  ledger.close();
}
