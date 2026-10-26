import { expect, it } from "vitest";
import { deadlineCountdown } from "./deadline-countdown";

it.each([
  ["2026-10-28", "2026-10-24", "还剩 4 天"],
  ["2026-11-06", "2026-10-24", "还剩 13 天"],
  ["2027-01-01", "2026-12-31", "还剩 1 天"],
  ["2028-03-01", "2028-02-28", "还剩 2 天"],
  ["2026-03-09", "2026-03-07", "还剩 2 天"],
  ["2026-11-02", "2026-10-31", "还剩 2 天"],
  ["2026-10-23", "2026-10-24", "已逾期 1 天"],
  ["", "2026-10-24", "日期待确认"],
  ["2026-02-30", "2026-02-28", "日期待确认"],
])("counts calendar days from %s to local today %s", (date, day, label) => {
  expect(deadlineCountdown(date, day, "23:59", "12:00").label).toBe(label);
});

it("distinguishes today's cutoff, overdue and completion without changing the due date", () => {
  const today = "2026-10-24";
  expect(deadlineCountdown(today, today, "15:00", "15:00")).toEqual({
    label: "今天截止",
    status: "today",
  });
  expect(deadlineCountdown(today, today, "15:00", "15:01")).toEqual({
    label: "今天已逾期",
    status: "overdue",
  });
  expect(
    deadlineCountdown("2026-10-23", today, "15:00", "15:01", true),
  ).toEqual({
    label: "已完成",
    status: "done",
  });
});
