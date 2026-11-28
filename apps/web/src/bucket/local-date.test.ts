import { describe, expect, it } from "vitest";
import { localDate } from "./local-date";

describe("localDate", () => {
  it("formats local calendar date without timezone drift", () => {
    expect(localDate(new Date("2026-10-22T12:00:00"))).toBe("2026-10-22");
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
