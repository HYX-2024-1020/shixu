import { expect, it } from "vitest";
import {
  parseDateExpression,
  deadlineLabel,
} from "../../shared/deadline-date.mjs";
import {
  absoluteItem,
  absoluteText,
  deadlineSections,
  parseDeadline,
} from "../../shared/deadlines.mjs";
import {
  validateResult,
  type BucketItem,
} from "../../shared/bucket-engine.mjs";
import { validateChat } from "./item-chat";
const day = "2026-10-25";
it("fills omitted calendar components once, including Chinese numbers and month boundaries", () => {
  for (const [input, date] of [
    ["26号", "2026-10-26"],
    ["十月二十六日", "2026-10-26"],
    ["10/26", "2026-10-26"],
    ["26", "2026-10-26"],
    ["月底", "2026-10-31"],
    ["下月底", "2026-11-30"],
    ["三天后", "2026-10-28"],
    ["周末", "2026-10-25"],
    ["1月2日", "2027-01-02"],
  ])
    expect(parseDeadline(input, day).date, input).toBe(date);
  expect(parseDeadline("2号", "2026-12-30").date).toBe("2027-01-02");
  expect(parseDeadline("本月2号", day).date).toBe("2026-10-02");
  expect(parseDeadline("31号", "2026-04-25").date).toBe("2026-05-31");
});
it("normalizes date and clock ranges into absolute endpoints", () => {
  for (const [input, startDate, startTime, date, time] of [
    ["26-28", "2026-10-26", "00:00", "2026-10-28", "23:59"],
    ["10月26-28", "2026-10-26", "00:00", "2026-10-28", "23:59"],
    ["12月31日到1月2日", "2026-12-31", "00:00", "2027-01-02", "23:59"],
    ["明天14:00到16:00", "2026-10-26", "14:00", "2026-10-26", "16:00"],
    ["明天下午三点到五点", "2026-10-26", "15:00", "2026-10-26", "17:00"],
    ["明天晚上十一点到凌晨一点", "2026-10-26", "23:00", "2026-10-27", "01:00"],
    ["下周五到周一", "2026-10-30", "00:00", "2026-11-02", "23:59"],
    [
      "2026-10-26 14:00 至 2026-10-28 16:00",
      "2026-10-26",
      "14:00",
      "2026-10-28",
      "16:00",
    ],
  ])
    expect(parseDeadline(input, day), input).toMatchObject({
      startDate,
      startTime,
      date,
      time,
    });
  expect(deadlineLabel(parseDeadline("26-28", day))).toBe(
    "2026-10-26 00:00 → 2026-10-28 23:59",
  );
});
it("leaves invalid, contradictory or unanchored dates pending", () => {
  for (const text of [
    "2月30日",
    "2026-02-29",
    "开学前",
    "尽快",
    "明天16:00到14:00",
    "2026-10-28至2026-10-26",
    "今天09:00开会；明天交报告",
    "获得10-26分",
  ])
    expect(parseDateExpression(text, day), text).toBeNull();
});
it("recovers a full range from bound evidence even when the model truncates its anchor", () => {
  const quote = "26-28号参加合成训练";
  const out = validateResult(
    {
      summary: "训练",
      items: [
        {
          kind: "event",
          title: "训练",
          summary: quote,
          facts: [],
          due: { anchor: "26", sourceId: "input" },
          evidence: [{ sourceId: "input", quote }],
        },
      ],
    },
    [{ id: "input", name: "合成通知", text: quote }],
    day,
  );
  expect(out.items[0].due).toMatchObject({
    startDate: "2026-10-26",
    date: "2026-10-28",
  });
  expect(out.items[0].evidence[0].quote).toBe(quote);
  expect(out.items[0].summary).not.toContain("26-28");
});
it("upgrades old pending dates from evidence without a model call, retaining conflicts", () => {
  const item: BucketItem = {
    kind: "task",
    title: "报告",
    summary: "26号交报告",
    facts: [],
    nextSteps: [],
    uncertainties: ["缺少年份"],
    sourceIds: ["input"],
    evidence: [{ sourceId: "input", quote: "26号交报告" }],
    due: null,
  };
  const fixed = absoluteItem(item, day);
  expect(fixed.due).toMatchObject({ date: "2026-10-26", dateInferred: true });
  expect(absoluteItem(fixed, "2027-01-01").due).toEqual(fixed.due);
  expect(
    absoluteItem({ ...item, uncertainties: ["日期与附件冲突"] }, day).due,
  ).toBeNull();
  expect(item.due).toBeNull();
  expect(absoluteItem({ ...item, kind: "note" }, day).due).toBeNull();
});
it("preserves range ends through chat and includes ongoing ranges in the time window", () => {
  const result = validateChat(
    { reply: "已改", patch: { due: { anchor: "26-28" } } },
    "改为26-28",
    day,
  );
  expect(result.patch.due).toMatchObject({
    startDate: "2026-10-26",
    date: "2026-10-28",
  });
  const rows = [
    {
      id: "range",
      date: "2026-11-01",
      time: "23:59",
      startDate: "2026-10-24",
      kind: "task",
      done: false,
    },
  ];
  expect(deadlineSections(rows, day, "12:00", 1).soon).toHaveLength(1);
  expect(deadlineSections(rows, "2026-11-02", "12:00", 1).overdue).toHaveLength(
    1,
  );
  expect(absoluteText("26-28号训练，10月30日提交", day)).toBe(
    "2026-10-26 至 2026-10-28训练，2026年10月30日提交",
  );
});
