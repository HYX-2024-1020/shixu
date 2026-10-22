import { describe, it, expect } from "vitest";
import {
  normalizeUsage,
  estimateCost,
  usageTotals,
  type UsageRecord,
} from "../../shared/usage.mjs";
const raw = {
  prompt_tokens: 1000,
  completion_tokens: 100,
  prompt_cache_hit_tokens: 200,
  prompt_cache_miss_tokens: 800,
  completion_tokens_details: { reasoning_tokens: 20 },
};
describe("usage is measured separately from estimated charges", () => {
  it("uses the two input rates and counts reasoning as part of output, not extra output", () => {
    const u = normalizeUsage(raw)!;
    expect(u.total).toBe(1100);
    expect(u.reasoning).toBe(20);
    expect(estimateCost(u, "deepseek-flash")).toMatchObject({
      min: 0.001204,
      max: 0.002408,
      currency: "CNY",
      priceDate: "2026-10-22",
    });
    expect(estimateCost(u, "deepseek-v4-pro")).toMatchObject({
      min: 0.00498,
      max: 0.00996,
    });
  });
  it("handles cache-hit details and enlarges bounds if cache information is absent or inconsistent", () => {
    expect(
      normalizeUsage({
        prompt_tokens: 1000,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 200 },
      })?.cacheMiss,
    ).toBe(800);
    const unknown = normalizeUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
    })!;
    expect(estimateCost(unknown, "deepseek-flash")).toMatchObject({
      min: 0.00042,
      max: 0.0028,
      cacheKnown: false,
    });
    expect(
      normalizeUsage({ ...raw, prompt_cache_miss_tokens: 100 })?.cacheHit,
    ).toBeNull();
  });
  it("does not invent zero usage or prices for missing reports and unknown models", () => {
    expect(normalizeUsage(undefined)).toBeNull();
    expect(normalizeUsage({ ...raw, prompt_tokens: -1 })).toBeNull();
    expect(
      estimateCost(normalizeUsage(raw), "future-model-with-unknown-price"),
    ).toBeNull();
  });
  it("upserts a pending call by identity, preserves historical price snapshots, and flags unpriced calls", () => {
    const base: UsageRecord = {
      id: "call-1",
      packetId: "fixture",
      startedAt: "2026-10-22T00:00:00Z",
      requestedModel: "deepseek-flash",
      model: "deepseek-flash",
      state: "pending",
      usage: null,
      cost: null,
    };
    const report: UsageRecord = {
      ...base,
      state: "reported",
      usage: normalizeUsage(raw),
      cost: estimateCost(normalizeUsage(raw), "deepseek-flash"),
    };
    expect(
      usageTotals([
        base,
        report,
        { ...base, id: "interrupted", state: "unreported" },
      ]),
    ).toMatchObject({
      calls: 2,
      reported: 1,
      unpriced: 1,
      prompt: 1000,
      completion: 100,
      min: 0.001204,
    });
  });
});
