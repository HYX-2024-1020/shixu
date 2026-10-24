import { expect, it } from "vitest";
import {
  groundedTime,
  itemDeadlineTime,
  resolveDeadlineTime,
} from "../../shared/deadline-time.mjs";
import {
  validateResult,
  type BucketItem,
} from "../../shared/bucket-engine.mjs";
import { absoluteItem, parseDeadline } from "../../shared/deadlines.mjs";
import { validateChat } from "./item-chat";

it("retains Chinese minutes, full width clocks, quarters and AM/PM", () => {
  for (const [text, time] of [
    ["下午三点十分", "15:10"],
    ["晚上十一点五十九分", "23:59"],
    ["２３：５９前", "23:59"],
    ["下午三点一刻", "15:15"],
    ["下午三点三刻", "15:45"],
    ["3 pm", "15:00"],
    ["12:30 am", "00:30"],
    ["15时05分", "15:05"],
  ])
    expect(groundedTime(text), text).toBe(time);
});
it("recovers a clock even when the model anchor contains only the date", () => {
  const text = "明天下午三点十分前提交报告";
  const out = validateResult(
    {
      summary: "报告截止",
      items: [
        {
          kind: "task",
          title: "提交报告",
          summary: "交报告",
          facts: [],
          due: { anchor: "明天", sourceId: "input" },
          evidence: [{ sourceId: "input", quote: text }],
        },
      ],
    },
    [{ id: "input", name: "通知", text }],
    "2026-10-28",
  );
  expect(out.items[0].due).toMatchObject({ date: "2026-10-29", time: "15:10" });
  expect(out.items[0].due?.timeInferred).toBeUndefined();
  expect(out.items[0].evidence[0].quote).toBe(text);
});
it("uses the corresponding date clause instead of an unrelated meeting clock", () => {
  const due = {
    date: "2026-10-29",
    time: "",
    anchor: "明天",
    sourceId: "input",
  };
  expect(
    resolveDeadlineTime(
      due,
      [],
      [
        {
          id: "input",
          name: "通知",
          text: "今天09:00开会；明天下午三点交报告",
        },
      ],
    ).time,
  ).toBe("15:00");
  const fallback = resolveDeadlineTime(due, [
    { sourceId: "input", quote: "今天09:00开会；明天交报告" },
  ]);
  expect(fallback).toMatchObject({ time: "23:59", timeInferred: true });
});
it("infers stable clocks from parts of day, ambiguous hours and date-only input", () => {
  for (const [text, time] of [
    ["明天上午", "09:00"],
    ["明天下午", "15:00"],
    ["明天晚上", "20:00"],
    ["明天三点", "15:00"],
    ["明天八点", "08:00"],
    ["明天", "23:59"],
  ]) {
    const due = parseDeadline(text, "2026-10-28");
    expect(due, text).toMatchObject({ time, timeInferred: true });
    expect(due.timeReason).toBeTruthy();
    expect(resolveDeadlineTime(due)).toEqual(due);
  }
  expect(
    parseDeadline("明天", "2026-10-28", "16:45").timeInferred,
  ).toBeUndefined();
});
it("repairs legacy blank clocks using source or saved chat without shifting the date or overwriting manual time", () => {
  const item: BucketItem = {
    kind: "task",
    title: "交报告",
    summary: "报告",
    facts: [],
    nextSteps: [],
    uncertainties: [],
    sourceIds: ["input"],
    evidence: [],
    due: { date: "2026-10-29", time: "", anchor: "明天", sourceId: "input" },
  };
  expect(
    absoluteItem(item, "2026-10-28", [
      { id: "input", name: "通知", text: "明天，下午三点十分前交报告" },
    ]).due,
  ).toMatchObject({ date: "2026-10-29", time: "15:10" });
  expect(
    absoluteItem(
      { ...item, due: { ...item.due!, sourceId: "item-chat" } },
      "2026-10-28",
      [],
      [{ role: "user", text: "改为明天下午四点半" }],
    ).due?.time,
  ).toBe("16:30");
  expect(
    absoluteItem(
      { ...item, due: { ...item.due!, time: "18:00", sourceId: "manual" } },
      "2026-10-28",
      [{ id: "manual", name: "补充", text: "明天下午三点交报告" }],
    ).due?.time,
  ).toBe("18:00");
  expect(
    resolveDeadlineTime({
      ...item.due!,
      time: "15:00",
      anchor: "明天下午三点十分",
    }).time,
  ).toBe("15:10");
  expect(item.due?.time).toBe("");
});
it("chat recovers a clock beyond the chosen anchor and accepts time-only edits for an existing deadline", () => {
  expect(
    validateChat(
      { reply: "已改", patch: { due: { anchor: "明天" } } },
      "改为明天下午三点十分",
      "2026-10-28",
    ).patch.due,
  ).toMatchObject({ date: "2026-10-29", time: "15:10" });
  expect(
    validateChat(
      { reply: "已改", patch: { due: { anchor: "三点" } } },
      "改成三点",
      "2026-10-28",
      { date: "2026-10-29", time: "23:59", anchor: "明天", sourceId: "input" },
    ).patch.due,
  ).toMatchObject({ date: "2026-10-29", time: "15:00", timeInferred: true });
});

it("handles abbreviated day periods and midnight rollover without repeated shifting", () => {
  expect(groundedTime("下午三点十分")).toBe("15:10");
  expect(groundedTime("下午三点十")).toBe("15:10");
  expect(parseDeadline("明晚八点", "2026-10-28")).toMatchObject({
    date: "2026-10-29",
    time: "20:00",
  });
  const midnight = parseDeadline("2026-12-31 晚上十二点", "2026-10-28");
  expect(midnight).toMatchObject({ date: "2027-01-01", time: "00:00" });
  expect(resolveDeadlineTime(midnight)).toEqual(midnight);
  expect(parseDeadline("2026-12-31 24:00", "2026-10-28")).toMatchObject({
    date: "2027-01-01",
    time: "00:00",
  });
});

it("does not lose minutes when the model truncates its anchor and evidence at the hour", () => {
  const due = {
    date: "2026-10-29",
    time: "",
    anchor: "明天下午三点",
    sourceId: "input",
  };
  expect(
    resolveDeadlineTime(
      due,
      [{ sourceId: "input", quote: "明天下午三点" }],
      [{ id: "input", name: "通知", text: "明天下午三点十分前提交报告" }],
    ).time,
  ).toBe("15:10");
});

it("can infer a stated clock on the next line without borrowing a different dated event", () => {
  const due = {
    date: "2026-10-29",
    time: "",
    anchor: "明天",
    sourceId: "input",
  };
  expect(
    resolveDeadlineTime(
      due,
      [],
      [
        {
          id: "input",
          name: "通知",
          text: "明天交报告\n截止时刻：下午三点十分",
        },
      ],
    ),
  ).toMatchObject({ time: "15:10", timeInferred: true });
  expect(
    resolveDeadlineTime(
      due,
      [],
      [{ id: "input", name: "通知", text: "今天09:00开会\n明天交报告" }],
    ),
  ).toMatchObject({ time: "23:59", timeInferred: true });
});

it("replaces stale missing-clock notices while retaining date and source conflicts", () => {
  const item: BucketItem = {
    kind: "task",
    title: "报告",
    summary: "报告",
    facts: [],
    nextSteps: [],
    sourceIds: [],
    evidence: [],
    uncertainties: [
      "具体时刻未知",
      "原文时刻需核对，未自动填入具体时间",
      "截止日期不明",
      "时间与附件冲突",
    ],
    due: { date: "2026-10-29", time: "", anchor: "明天", sourceId: "input" },
  };
  expect(absoluteItem(item, "2026-10-28").uncertainties).toEqual([
    "截止日期不明",
    "时间与附件冲突",
  ]);
});

it("does not roll a recovered midnight forward again when rendering a saved inferred clock", () => {
  const sources = [
    { id: "input", name: "通知", text: "明天提交报告\n截止时刻24:00" },
  ];
  const due = resolveDeadlineTime(
    { date: "2026-10-29", time: "", anchor: "明天", sourceId: "input" },
    [],
    sources,
  );
  expect(due).toMatchObject({
    date: "2026-10-30",
    time: "00:00",
    timeInferred: true,
  });
  expect(resolveDeadlineTime(due, [], sources)).toEqual(due);
});

it("keeps a stated clock even when the deadline date itself is still pending", () => {
  const item: BucketItem = {
    kind: "task",
    title: "提交说明",
    summary: "月底下午三点十分提交说明",
    facts: [],
    nextSteps: [],
    uncertainties: ["日期还不明确"],
    sourceIds: ["input"],
    evidence: [{ sourceId: "input", quote: "月底下午三点十分提交说明" }],
    due: null,
  };
  expect(itemDeadlineTime(item)).toMatchObject({ date: "", time: "15:10" });
  expect(item.due).toBeNull();
});
