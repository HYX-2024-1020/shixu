import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "./deepseek.mjs";
import { ReadingLedger, validateUsage } from "./ledger.mjs";
const sources = [{ id: "input", name: "合成.txt", text: "明天提交报告😀" }];
test("DeepSeek adapter preflights actual UTF-8 payload, preserves valid usage on invalid/length output and never retries", async () => {
  const prices = deepseekPriceSnapshots(1);
  let calls = 0;
  const provider = createDeepSeekReadingProvider({
    apiKey: "synthetic-not-a-key",
    priceAt: () => prices[0].id,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      assert.equal(body.tools, undefined);
      assert.equal(body.thinking.type, "disabled");
      assert.equal(body.response_format.type, "json_object");
      return Response.json({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_cache_hit_tokens: 50,
          prompt_cache_miss_tokens: 50,
        },
        choices: [
          { finish_reason: "length", message: { content: '{"incomplete"' } },
        ],
      });
    },
  });
  const prepared = provider.prepare(sources, { captureDate: "2026-10-28" });
  assert.ok(prepared.maxPromptTokens > Buffer.byteLength(prepared.body));
  const response = await provider(sources, new AbortController().signal, {
    prepared,
  });
  assert.equal(response.result, null);
  assert.equal(response.usage.prompt_tokens, 100);
  assert.equal(calls, 1);
  assert.throws(
    () =>
      validateUsage({
        prompt_tokens: 100,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 40,
        prompt_cache_miss_tokens: 70,
      }),
    /INVALID_USAGE/,
  );
  const failing = createDeepSeekReadingProvider({
    apiKey: "synthetic",
    priceAt: () => prices[0].id,
    fetcher: async () => {
      calls++;
      throw Error("offline");
    },
  });
  await assert.rejects(failing(sources, undefined, { prepared }), /offline/);
  assert.equal(calls, 2);
  assert.throws(
    () => createDeepSeekReadingProvider({ apiKey: "synthetic" }),
    /CONFIGURATION/,
  );
});
test("independent ledger audit rejects refunded projections and accounts for unknown-cost risk", () => {
  const ledger = new ReadingLedger(":memory:");
  try {
    ledger.grantInitial("a");
    const price = deepseekPriceSnapshots(1)[0];
    ledger.freezePrice(price);
    ledger.reserve({
      callId: "call",
      account: "a",
      task: "task",
      block: "block",
      generation: 1,
      priceId: price.id,
      maxPromptTokens: 1000,
      maxOutputTokens: 100,
    });
    ledger.sent("call");
    ledger.unknown("call");
    assert.ok(ledger.wallet("a").unknownRisk > 0);
    assert.equal(ledger.wallet("a").pausedReason, "UNKNOWN_COST");
    ledger.settle("call", { prompt_tokens: 100, completion_tokens: 10 });
    assert.equal(ledger.audit().valid, true);
    ledger.db.exec("UPDATE reading_wallets SET spent=0");
    assert.throws(() => ledger.audit(), /RECONCILIATION_REQUIRED/);
    assert.equal(
      ledger.db.prepare("SELECT paused FROM reading_controls").get().paused,
      1,
    );
  } finally {
    ledger.close();
  }
});
