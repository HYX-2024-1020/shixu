import test from "node:test";
import assert from "node:assert/strict";
import { pricePeriod } from "./price-calendar.mjs";
test("official peak windows use Beijing dates, holiday exclusions and fail closed outside reviewed year", () => {
  for (const [time, period] of [
    ["2026-11-09T08:59:00+08:00", "offpeak"],
    ["2026-11-09T09:00:00+08:00", "peak"],
    ["2026-11-09T12:00:00+08:00", "offpeak"],
    ["2026-11-09T14:00:00+08:00", "peak"],
    ["2026-11-09T18:00:00+08:00", "offpeak"],
    ["2026-11-08T10:00:00+08:00", "offpeak"],
    ["2026-10-01T10:00:00+08:00", "offpeak"],
  ])
    assert.equal(pricePeriod(Date.parse(time)), period);
  assert.throws(
    () => pricePeriod(Date.parse("2027-01-01T00:00:00+08:00")),
    /REVIEW_REQUIRED/,
  );
});
