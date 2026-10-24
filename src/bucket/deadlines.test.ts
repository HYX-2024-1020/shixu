import { expect, it } from "vitest";
import {
  absoluteItem,
  absoluteText,
  deadlineSections,
  parseDeadline,
  setDeadline,
} from "../../shared/deadlines.mjs";
import { validateResult } from "../../shared/bucket-engine.mjs";

it("anchors dates to capture day across month, year, leap day and later viewing", () => {
  expect(absoluteText("明天下午三点交报告", "2026-10-28")).toBe(
    "2026年10月29日下午三点交报告",
  );
  expect(parseDeadline("明天下午三点", "2026-12-31")).toMatchObject({
    date: "2027-01-01",
    time: "15:00",
  });
  expect(parseDeadline("后天", "2028-02-28")).toMatchObject({
    date: "2028-03-01",
    time: "23:59",
  });
  expect(parseDeadline("下周一", "2026-10-30").date).toBe("2026-11-02");
  expect(parseDeadline("上周一", "2026-10-28").date).toBe("2026-10-19");
  expect(absoluteText("昨天交，上周五发通知", "2026-11-01")).toBe(
    "2026年10月31日交，2026年10月23日发通知",
  );
  expect(absoluteText("下周一和周二停课，周三交报告", "2026-10-26")).toBe(
    "2026年11月02日和2026年11月03日停课，2026年10月28日交报告",
  );
  expect(() => parseDeadline("尽快", "2026-10-28")).toThrow();
  expect(() => parseDeadline("2026-02-30", "2026-10-28")).toThrow();
  expect(() => parseDeadline("2026-10-29", "2026-10-28", "25:00")).toThrow();
});

it("normalizes saved generated card copy while retaining exact source evidence", () => {
  const text = "明天下午三点交报告";
  const raw = {
    kind: "task",
    title: text,
    summary: text,
    facts: [text],
    nextSteps: [],
    uncertainties: [],
    due: { anchor: "明天下午三点", sourceId: "input" },
    evidence: [{ sourceId: "input", quote: text }],
  };
  const result = validateResult(
    { summary: text, items: [raw] },
    [{ id: "input", name: "通知", text }],
    "2026-10-28",
  );
  const item = result.items[0];
  expect(item.title).toContain("2026年10月29日");
  expect(item.facts[0]).not.toContain("明天");
  expect(item.evidence[0].quote).toBe(text);
  expect(absoluteItem(item, "2026-11-15")).toEqual(item);
  const changed = setDeadline(
    item,
    parseDeadline("2026-11-02", "2026-10-28"),
    "2026-10-28",
  );
  expect(changed.summary).toContain("2026年11月02日");
  expect(changed.evidence).toEqual(item.evidence);
  expect(changed.summary).toContain("23:59");
  expect(changed.summary).not.toContain("下午三点");
  const shifted = setDeadline(
    item,
    parseDeadline("2026-11-03", "2026-10-28", "16:00"),
    "2026-10-28",
  );
  expect(shifted.summary).toContain("16:00");
  expect(shifted.summary).not.toContain("下午三点");
});

it("uses clock precision only when provided, sorts by time, and excludes deleted rows", () => {
  const row = (id: string, date: string, time = "", kind = "task") => ({
    id,
    date,
    time,
    kind,
    done: false,
  });
  const rows = [
    row("past", "2026-10-27"),
    row("elapsed", "2026-10-28", "09:00"),
    row("unknown", "2026-10-28"),
    row("later", "2026-10-28", "19:00"),
    row("earlier", "2026-10-28", "15:00"),
    row("edge", "2026-11-04"),
    row("beyond", "2026-11-05"),
    row("unsure", ""),
    row("note", "", "", "note"),
    { ...row("done", "2026-10-28"), done: true },
    { ...row("deleted", "2026-10-28"), deleted: true },
  ];
  const sections = deadlineSections(rows, "2026-10-28", "12:00", 7);
  expect(sections.overdue.map((r) => r.id)).toEqual(["past", "elapsed"]);
  expect(sections.today.map((r) => r.id)).toEqual([
    "earlier",
    "later",
    "unknown",
  ]);
  expect(sections.soon.map((r) => r.id)).toEqual(["edge"]);
  expect(sections.later.map((r) => r.id)).toEqual(["beyond"]);
  expect(sections.unsure.map((r) => r.id)).toEqual(["unsure"]);
  expect(sections.done.map((r) => r.id)).toEqual(["done"]);
});
