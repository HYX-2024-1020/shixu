import {tmpdir} from 'node:os';
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  mergeFixture,
  finishMerge,
} from "../server/reading/merge-fixtures.mjs";
import { beijingDay } from "../server/reading/ledger.mjs";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "../server/reading/deepseek.mjs";
export async function runAssociationLive({ getKey, prepareOnly }) {
  const now = Date.now(),
    day = beijingDay(now);
  assert.equal(process.env.SHIXU_VERIFIED_PRICE_DAY, day);
  assert.equal(process.env.SHIXU_VERIFIED_PRICE_PERIOD, "offpeak");
  assert.ok([0, 6].includes(new Date(now + 8 * 3600000).getUTCDay()));
  const price = deepseekPriceSnapshots(now)[1];
  if (prepareOnly) {
    console.log(
      JSON.stringify({
        prepared: true,
        realProviderCalls: 0,
        priceId: price.id,
      }),
    );
    return;
  }
  let realProviderCalls = 0,
    simulatedUpstreamCalls = 0;
  const real = createDeepSeekReadingProvider({
    apiKey: await getKey(),
    priceAt: () => price.id,
    fetcher: (...args) => {
      realProviderCalls++;
      return fetch(...args);
    },
  });
  const item = (number, source, quote, date = "2026-11-03") => ({
    kind: "task",
    title: "提交算法实验" + number,
    summary: "算法课实验报告",
    facts: ["实验编号" + number, "格式PDF"],
    nextSteps: [],
    uncertainties: [],
    due: { date, time: "16:45", anchor: date + " 16:45", sourceId: source },
    evidence: [{ sourceId: source, quote }],
  });
  const text =
    "算法课实验A7319，提交PDF报告并另附UTF-8源代码。截止2026-11-03 16:45。";
  const provider = async (sources) => {
    simulatedUpstreamCalls++;
    const a = item("A7319", sources[0].id, sources[0].text);
    a.facts.push("另附UTF-8源代码");
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { summary: "模拟已经读取的本次事项", warnings: [], items: [a] },
    };
  };
  provider.association = real.association;
  const f = mergeFixture(null, { provider, sourceText: text, price }),
    before = [];
  for (let n = 0; n < 4; n++) {
    const number = n === 1 ? "B7320" : "A7319",
      date = n === 2 ? "2026-11-10" : "2026-11-03",
      quote = "算法课实验" + number + "，提交PDF报告，截止" + date + " 16:45。";
    f.store.apply(
      f.device,
      {
        id: "old" + n,
        opId: "seed-old" + n,
        type: "put",
        baseVersion: 0,
        data: {
          text: "",
          sources: [],
          attachments: [],
          captureDate: "2026-10-31",
          status: "ready",
          itemIds: ["old-item"],
          doneIds: n === 3 ? [0] : [],
          itemState: n === 3 ? { "old-item": { status: "done" } } : {},
          result: {
            summary: "合成历史",
            warnings: [],
            items: [item(number, "old-source" + n, quote, date)],
          },
        },
      },
      f.store.epoch,
    );
    before.push(f.store.record("old" + n));
  }
  const output = resolve(process.env.SHIXU_IMAGE_REPORT);
  let qualityError = null;
  try {
    f.enqueue();
    const task = await finishMerge(f.tasks),
      packet = f.store.record("packet").data;
    try {
      assert.equal(task.state, "done", task.reason);
      assert.equal(realProviderCalls, 1);
      assert.equal(packet.historyAssociation.candidates, 3);
      assert.equal(packet.association.links.length, 1);
      assert.equal(packet.association.links[0].target, "old0#old-item");
      assert.equal(packet.association.links[0].relation, "same");
      assert.equal(packet.result.items[0].due.time, "16:45");
      assert.ok(packet.result.items[0].facts.includes("另附UTF-8源代码"));
      for (let n = 0; n < 4; n++)
        assert.deepEqual(f.store.record("old" + n), before[n]);
    } catch (e) {
      qualityError = e.message;
    }
    const mockIds = new Set(
        f.ledger.db
          .prepare("SELECT call_id FROM reading_paid_proofs")
          .all()
          .map((r) => r.call_id),
      ),
      calls = f.ledger.db
        .prepare(
          "SELECT id,state,price,reserved,actual,usage FROM reading_calls",
        )
        .all()
        .map((c) => ({ ...c, simulated: mockIds.has(c.id) })),
      realCalls = calls.filter((c) => !c.simulated),
      realSpentMicros = realCalls.reduce((n, c) => n + (c.actual || 0), 0);
    const report = {
      kind: "synthetic-real-history-association-quality",
      testedAt: new Date().toISOString(),
      realProviderCalls,
      simulatedUpstreamCalls,
      price,
      state: task.state,
      reason: task.reason,
      qualityError,
      realSpentMicros,
      realUnknownCalls: realCalls.filter((c) => c.state === "unknown").length,
      calls,
      providerReceipts:realCalls.map(c=>({callId:c.id,...f.ledger.receipts.review(c.id)})),
      association: packet.association,
      historyAssociation: packet.historyAssociation,
      result: packet.result,
      decisions: f.store.db
        .prepare("SELECT result FROM reading_association_results")
        .all()
        .map((r) => JSON.parse(r.result)),
      boundaries: [
        "Only history association model call real; upstream recognition simulated",
        "Synthetic saved history, completed candidate excluded",
        "No UI window or final B/C/D acceptance",
      ],
    };
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        report: output,
        realProviderCalls,
        realSpentMicros,
        qualityError,
        state: task.state,
      }),
    );
  } finally {
    f.tasks.close();
    f.ledger.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    f.ledger.close();
    f.store.close();
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(
      join(f.directory, "ledger.sqlite"),
      join(dirname(output), "association-ledger.sqlite"),
    );
    if (dirname(resolve(f.directory))!==resolve(tmpdir())||!basename(f.directory).startsWith("shixu-merge-"))
      throw Error("UNSAFE_FIXTURE_CLEANUP");
    rmSync(f.directory, { recursive: true, force: true });
  }
  assert.equal(
    qualityError,
    null,
    "ASSOCIATION_QUALITY_FAILED_SEE_SYNTHETIC_REPORT",
  );
}
