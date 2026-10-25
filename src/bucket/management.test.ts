import { it, expect } from "vitest";
import { compareItems, habitCheckin, type RankedItem } from "./management";
const item = (id: string, extras: Partial<RankedItem> = {}): RankedItem => ({
  id,
  importance: 1,
  pinned: false,
  createdAt: "2026-10-23T00:00:00Z",
  order: 0,
  ...extras,
});
it("promotes deadlines as local days advance without changing dates", () => {
  const upcoming = item("upcoming", { date: "2026-10-31" }),
    important = item("important", { importance: 2 });
  expect(
    compareItems(upcoming, important, "priority", "2026-10-23"),
  ).toBeGreaterThan(0);
  expect(
    compareItems(upcoming, important, "priority", "2026-10-24"),
  ).toBeLessThan(0);
  expect(upcoming.date).toBe("2026-10-31");
});
it("respects pinning and manual order independently of urgency, with stable ties", () => {
  const overdue = item("overdue", { date: "2026-10-01", order: 10 }),
    pinned = item("pinned", { pinned: true, order: 20 });
  expect(
    compareItems(overdue, pinned, "priority", "2026-10-23"),
  ).toBeGreaterThan(0);
  expect(compareItems(overdue, pinned, "custom", "2026-10-23")).toBeLessThan(0);
  expect(
    compareItems(item("a"), item("b"), "priority", "2026-10-23"),
  ).toBeLessThan(0);
});

it("habit check-in deduplicates local days and undoes only the current day", () => {
  const first = habitCheckin(
    { checkins: ["2026-10-24", "2026-10-24"] },
    "2026-10-25",
  );
  expect(first.checkins).toEqual(["2026-10-24", "2026-10-25"]);
  expect(first.status).toBe("active");
  expect(first.completedAt).toBe("");
  const next = habitCheckin(first, "2026-10-26");
  expect(next.checkins).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  expect(habitCheckin(next, "2026-10-26").checkins).toEqual(first.checkins);
});
