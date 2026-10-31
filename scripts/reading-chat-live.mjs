// Opt-in synthetic quality probe, launched only by reading-image-live's
// no-window safeStorage entry point. No personal workspace or original is read.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SyncStore } from "../server/sync-store.mjs";
import { createAttachmentStore } from "../server/sync-files.mjs";
import { ReadingLedger, beijingDay } from "../server/reading/ledger.mjs";
import { ReadingTasks } from "../server/reading/tasks.mjs";
import { sha256 } from "../server/reading/material.mjs";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "../server/reading/deepseek.mjs";

export async function runChatLive({ probe, getKey, prepareOnly }) {
  const now = Date.now(),
    day = beijingDay(now);
  // Explicit reviewed snapshot; never infer holiday pricing on a weekday.
  assert.equal(
    process.env.SHIXU_VERIFIED_PRICE_DAY,
    day,
    "VERIFIED_TARIFF_DAY_REQUIRED",
  );
  const period = process.env.SHIXU_VERIFIED_PRICE_PERIOD;
  assert.ok(["peak", "offpeak"].includes(period));
  const local = new Date(now + 8 * 3600000),
    weekday = local.getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  if (weekend) assert.equal(period, "offpeak");
  const price = deepseekPriceSnapshots(now).find((p) =>
    p.id.endsWith("-" + period),
  );
  if (prepareOnly) {
    console.log(
      JSON.stringify({
        prepared: true,
        browserWindows: 0,
        realProviderCalls: 0,
        priceId: price.id,
        day,
      }),
    );
    return;
  }
  const account = "synthetic-chat-quality-development";
  const ledger = new ReadingLedger(process.env.SHIXU_IMAGE_LEDGER_PATH);
  ledger.freezePrice(price);
  ledger.grantInitial(account);
  const store = new SyncStore(join(probe, "chat-tenant.sqlite"));
  createAttachmentStore(store);
  const device = store.createDevice(account).deviceId;
  const key = await getKey();
  let realProviderCalls = 0;
  const provider = createDeepSeekReadingProvider({
    apiKey: key,
    priceAt: () => price.id,
    fetcher: (...args) => {
      realProviderCalls++;
      return fetch(...args);
    },
  });
  const tasks = new ReadingTasks({
    store,
    ledger,
    account,
    provider,
    priceId: price.id,
    modelVersion: price.model,
    reader: () => {
      throw Error("CHAT_MUST_NOT_READ_ORIGINAL");
    },
    authorize: (id) => assert.equal(id, device),
  });
  const cases = [
    {
      id: "date",
      instruction:
        "截止时间改为2026年11月2日下午5点半，归入实验组；补充要求：附上复杂度分析。保留原有要求及其他事实。",
      check: (p, b) => {
        const item = p.result.items[0];
        assert.equal(item.due.date, "2026-11-02");
        assert.equal(item.due.time, "17:30");
        for (const fact of b.result.items[0].facts)
          assert.ok(item.facts.includes(fact), fact);
        assert.ok(item.facts.some((f) => f.includes("复杂度")));
        assert.equal(p.itemState.target.group, "实验组");
      },
    },
    {
      id: "scope",
      instruction:
        "请重新读取原附件并告诉我另一事项的截止时间；如果无法读取，说明你本次实际能依据哪些内容，不要改动事项。",
      check: (p, b) => {
        assert.deepEqual(p.result, b.result);
        const reply = p.itemState.target.chat.at(-1).text;
        assert.match(reply, /无法|不能|没有|未/);
        assert.match(reply, /原件|附件|原始/);
      },
    },
    {
      id: "status",
      instruction:
        "我已完成这件事，标记为完成，并取消星标。不要修改标题、摘要、要求和截止时间。",
      check: (p, b) => {
        assert.deepEqual(p.result, b.result);
        assert.equal(p.itemState.target.status, "done");
        assert.equal(p.itemState.target.starred, false);
        assert.ok(p.itemState.target.completedAt);
        assert.ok(p.doneIds.includes(0));
      },
    },
  ];
  const results = [];
  const started = performance.now();
  try {
    for (const sample of cases) {
      const item = {
        kind: "task",
        title: "提交合成实验报告",
        summary: "报告编号 Q7319，按指定格式提交。",
        facts: ["格式：PDF", "文件名：学号_姓名", "编号：Q7319"],
        nextSteps: [],
        uncertainties: [],
        evidence: [],
        due: null,
      };
      const seed = {
        text: "不得发送的合成原始正文 CANARY_ORIGINAL_917",
        sources: [],
        attachments: [],
        captureDate: day,
        status: "ready",
        result: {
          summary: "合成投递",
          warnings: [],
          items: [item, { ...item, title: "兄弟事项禁止修改" }],
        },
        itemIds: ["target", "sibling"],
        itemState: {
          target: { starred: true, additions: [{ text: "人工笔记保留 N319" }] },
          sibling: { pinned: true },
        },
        readingCoverage: [
          { attachmentId: "synthetic", state: "read", covered: [] },
        ],
      };
      store.apply(
        device,
        {
          id: sample.id,
          opId: "seed-" + sample.id,
          type: "put",
          baseVersion: 0,
          data: seed,
        },
        store.epoch,
        { taskId: "synthetic-seed" },
      );
      const before = store.record(sample.id).data;
      tasks.enqueue({
        id: "chat-" + sample.id,
        packetId: sample.id,
        deviceId: device,
        chat: {
          itemId: "target",
          instruction: sample.instruction,
          baseVersion: store.record(sample.id).version,
          epoch: store.epoch,
        },
      });
      const request = tasks.chat.material(tasks.get("chat-" + sample.id));
      assert.ok(!JSON.stringify(request).includes("CANARY_ORIGINAL_917"));
      for (
        let step = 0;
        step < 6 && tasks.get("chat-" + sample.id).state === "queued";
        step++
      )
        await tasks.run("chat-" + sample.id);
      const task = tasks.get("chat-" + sample.id),
        after = store.record(sample.id).data;
      let qualityError = null;
      try {
        assert.equal(task.state, "done", task.reason);
        sample.check(after, before);
        assert.deepEqual(after.result.items[1], before.result.items[1]);
        assert.deepEqual(after.itemState.sibling, before.itemState.sibling);
        assert.deepEqual(
          after.itemState.target.additions,
          before.itemState.target.additions,
        );
        assert.deepEqual(after.readingCoverage, before.readingCoverage);
        assert.deepEqual(after.itemIds, before.itemIds);
      } catch (error) {
        qualityError = error.message;
      }
      results.push({
        id: sample.id,
        instruction: sample.instruction,
        inputHash: sha256(JSON.stringify(before)),
        state: task.state,
        reason: task.reason,
        qualityError,
        result: after.result,
        itemState: after.itemState,
      });
      if (task.state !== "done") break; // Unknown/error never retried by this probe.
    }
  } finally {
    const report = {
      kind: account,
      testedAt: new Date().toISOString(),
      price,
      browserWindows: 0,
      realProviderCalls,
      elapsedMs: performance.now() - started,
      spentMicros: ledger.wallet(account).spent,
      calls: ledger.db
        .prepare(
          "SELECT id,state,price,reserved,actual,usage FROM reading_calls",
        )
        .all(),
      results,
      boundaries: [
        "Synthetic saved items only",
        "No parser or Linux isolation claim",
        "No native client or final B/C/D acceptance",
      ],
    };
    const output = resolve(process.env.SHIXU_IMAGE_REPORT);
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        report: output,
        realProviderCalls,
        spentMicros: report.spentMicros,
        quality: results.map((r) => ({
          id: r.id,
          state: r.state,
          error: r.qualityError,
        })),
      }),
    );
    tasks.close();
    ledger.close();
    store.close();
  }
  assert.equal(results.length, cases.length);
  assert.ok(
    results.every((r) => !r.qualityError),
    "CHAT_QUALITY_FAILED_SEE_SYNTHETIC_REPORT",
  );
}
