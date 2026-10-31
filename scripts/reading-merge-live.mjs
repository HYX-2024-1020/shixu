import assert from "node:assert/strict";
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  mergeFixture,
  finishMerge,
} from "../server/reading/merge-fixtures.mjs";
import { beijingDay } from "../server/reading/ledger.mjs";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "../server/reading/deepseek.mjs";

// One real semantic call over simulated, already-validated upstream items. This
// is deliberately NOT evidence for attachment recognition or a real full input.
export async function runMergeLive({ getKey, prepareOnly }) {
  const now = Date.now(),
    day = beijingDay(now),
    local = new Date(now + 8 * 3600000);
  assert.equal(process.env.SHIXU_VERIFIED_PRICE_DAY, day);
  assert.ok(
    [0, 6].includes(local.getUTCDay()),
    "WEEKEND_PROBE_ONLY_VERIFY_NEW_TARIFF_OTHERWISE",
  );
  assert.equal(process.env.SHIXU_VERIFIED_PRICE_PERIOD, "offpeak");
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
  const provider = async (sources) => {
    simulatedUpstreamCalls++;
    const item = (title, facts) => ({
      kind: "task",
      title,
      summary: facts[0],
      facts,
      nextSteps: [],
      uncertainties: [],
      due: null,
      group: "算法课",
      evidence: [
        { sourceId: sources[0].id, quote: sources[0].text.slice(0, 8) },
      ],
    });
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        summary: "模拟上游，不是真实识别",
        warnings: [],
        items:
          simulatedUpstreamCalls === 1
            ? [
                item("提交算法实验A7319", ["任务编号A7319", "格式PDF"]),
                item("提交算法实验B7320", [
                  "任务编号B7320",
                  "本事项与A7319是同一课程的另一份作业，须分别提交",
                ]),
              ]
            : [
          {...item("递交实验报告A7319", [
                  "任务编号A7319",
                  "文件名学号_姓名",
                  "要求说明时间复杂度",
          ]),kind:"notice"},
                item("完成算法课习题C7321", [
                  "任务编号C7321",
                  "独立习题，不能与实验报告合并",
                ]),
              ],
      },
    };
  };
  provider.merge = real.merge;
  const f = mergeFixture(null, { provider, price });
  // Keep this synthetic ledger, including simulated rows, with an explicit
  // separate real-only accounting report; never claim mock usage as a bill.
  const { copyFileSync, mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const output = resolve(process.env.SHIXU_IMAGE_REPORT);
  let qualityError = null,
    task;
  try {
    f.enqueue();
    task = await finishMerge(f.tasks);
    const packet = f.store.record("packet").data;
    try {
      assert.equal(task.state, "done", task.reason);
      assert.equal(realProviderCalls, 1);
      assert.equal(packet.result.items.length, 3);
      const a = packet.result.items.find((i) =>
        i.facts.includes("任务编号A7319"),
      );
      for (const fact of ["格式PDF", "文件名学号_姓名", "要求说明时间复杂度"])
        assert.ok(a.facts.includes(fact), fact);
      assert.ok(
        packet.result.items.some((i) => i.facts.includes("任务编号B7320")),
      );
      assert.ok(
        packet.result.items.some((i) => i.facts.includes("任务编号C7321")),
      );
      assert.ok(
        packet.association.links.length > 0,
        "same course distinct tasks should retain a related link",
      );
      assert.equal(a.evidence.length, 2);
      assert.equal(a.kind,"task");
    } catch (error) {
      qualityError = error.message;
    }
    const realCalls = f.ledger.db
      .prepare(
        `SELECT c.id,c.state,c.price,c.reserved,c.actual,c.usage FROM reading_calls c
      JOIN reading_merge_proofs p ON p.call_id=c.id`,
      )
      .all();
    const report = {
      kind: "synthetic-real-semantic-quality",
      variant: "notice-to-action/v2",
      testedAt: new Date().toISOString(),
      realProviderCalls,
      simulatedUpstreamCalls,
      price,
      state: task.state,
      reason: task.reason,
      qualityError,
      realSpentMicros: realCalls.reduce((n, c) => n + (c.actual || 0), 0),
      realCalls,
      result: packet.result,
      association: packet.association,
      semanticMerge: packet.semanticMerge,
      boundaries: [
        "Only semantic call is real; upstream recognition simulated",
        "No UI window",
        "No final B/C/D acceptance",
      ],
    };
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        report: output,
        realProviderCalls,
        realSpentMicros: report.realSpentMicros,
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
      join(dirname(output), "semantic-ledger.sqlite"),
    );
    rmSync(f.directory, { recursive: true, force: true });
  }
  assert.equal(
    qualityError,
    null,
    "SEMANTIC_QUALITY_FAILED_SEE_SYNTHETIC_REPORT",
  );
}
