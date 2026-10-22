// CNY per million tokens. Snapshot checked against the official page on 2026-10-22.
export const PRICE_DATE = "2026-10-22";
export const PRICE_URL =
  "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
export function rateFor(model) {
  const id = String(model).toLowerCase();
  if (
    [
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash-1017",
    ].includes(id)
  )
    return { hit: 0.02, miss: 1, output: 4 };
  if (["deepseek-v4-pro", "deepseek-v4-pro-0813"].includes(id))
    return { hit: 0.15, miss: 4.5, output: 13.5 };
  return null;
}
const count = (v) => Number.isSafeInteger(v) && v >= 0;
export function normalizeUsage(raw) {
  if (!raw || !count(raw.prompt_tokens) || !count(raw.completion_tokens))
    return null;
  const prompt = raw.prompt_tokens,
    completion = raw.completion_tokens;
  let hit =
    raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens;
  let miss = raw.prompt_cache_miss_tokens;
  if (count(hit) && !count(miss)) miss = prompt - hit;
  if (count(miss) && !count(hit)) hit = prompt - miss;
  const cacheKnown = count(hit) && count(miss) && hit + miss === prompt;
  return {
    prompt,
    completion,
    total: prompt + completion,
    cacheHit: cacheKnown ? hit : null,
    cacheMiss: cacheKnown ? miss : null,
    // Reasoning is a subset of completion_tokens; never add it again.
    reasoning: count(raw.completion_tokens_details?.reasoning_tokens)
      ? raw.completion_tokens_details.reasoning_tokens
      : null,
  };
}
export function estimateCost(usage, model) {
  const rate = rateFor(model);
  if (!usage || !rate) return null;
  // Time windows depend on Chinese statutory holidays. Show the official
  // off-peak/peak bounds rather than guessing a holiday or an exact charge.
  const lowInput =
    usage.cacheHit === null
      ? usage.prompt * rate.hit
      : usage.cacheHit * rate.hit + usage.cacheMiss * rate.miss;
  const highInput =
    usage.cacheHit === null ? usage.prompt * rate.miss : lowInput;
  return {
    currency: "CNY",
    priceDate: PRICE_DATE,
    min: (lowInput + usage.completion * rate.output) / 1e6,
    max: ((highInput + usage.completion * rate.output) * 2) / 1e6,
    cacheKnown: usage.cacheHit !== null,
  };
}
export function usageTotals(records) {
  const rows = [...new Map(records.map((r) => [r.id, r])).values()];
  return rows.reduce(
    (s, r) => ({
      calls: s.calls + 1,
      reported: s.reported + (r.usage ? 1 : 0),
      unpriced: s.unpriced + (r.cost ? 0 : 1),
      prompt: s.prompt + (r.usage?.prompt || 0),
      completion: s.completion + (r.usage?.completion || 0),
      min: s.min + (r.cost?.min || 0),
      max: s.max + (r.cost?.max || 0),
    }),
    {
      calls: 0,
      reported: 0,
      unpriced: 0,
      prompt: 0,
      completion: 0,
      min: 0,
      max: 0,
    },
  );
}
export function money(value) {
  return value > 0 && value < 0.000001 ? "<0.000001" : value.toFixed(6);
}
