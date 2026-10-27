import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReadingLedger, estimatedCost } from "./ledger.mjs";
const price = {
  id: "synthetic-v1",
  model: "synthetic",
  currency: "CNY",
  source: "synthetic fixture, never supplier pricing",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 100000,
  outputMicrosPerMillion: 2000000,
};
function fixture(t, options) {
  const directory = mkdtempSync(join(tmpdir(), "shixu-ledger-")),
    path = join(directory, "ledger.sqlite");
  const ledger = new ReadingLedger(path, options);
  ledger.freezePrice(price);
  ledger.grantInitial("account");
  const connections = [ledger];
  t.after(() => {
    for (const c of connections) c.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    ledger,
    path,
    reopen: () => {
      const c = new ReadingLedger(path);
      connections.push(c);
      return c;
    },
  };
}
const request = (n, extra = {}) => ({
  callId: "call:" + n,
  account: "account",
  task: "task",
  block: "block:" + n,
  generation: 1,
  priceId: price.id,
  maxPromptTokens: 500000,
  maxOutputTokens: 250000,
  ...extra,
});
test("initial cumulative grant is exactly once and does not reset across Beijing midnight", (t) => {
  let now = Date.parse("2026-10-28T15:59:59Z");
  const { ledger } = fixture(t, { now: () => now });
  ledger.reserve(request(1));
  ledger.sent("call:1");
  ledger.settle("call:1", { prompt_tokens: 10, completion_tokens: 2 });
  now += 2000;
  ledger.grantInitial("account");
  assert.equal(ledger.wallet("account").granted, 20000000);
  assert.equal(ledger.wallet("account").spent, 14);
  assert.throws(() => ledger.wallet("legacy"), /RECONCILIATION_REQUIRED/);
});
test("two connections cannot oversell the 2 yuan in-flight limit; settled cumulative task may exceed it", (t) => {
  const { ledger, reopen } = fixture(t);
  const rival = reopen();
  ledger.reserve(request(1));
  rival.reserve(request(2));
  assert.throws(() => rival.reserve(request(3)), /TASK_INFLIGHT_BUDGET/);
  for (let n = 1; n <= 4; n++) {
    if (n > 2) ledger.reserve(request(n));
    ledger.sent("call:" + n);
    ledger.settle("call:" + n, {
      prompt_tokens: 500000,
      completion_tokens: 250000,
    });
  }
  assert.equal(ledger.wallet("account").spent, 4000000);
  assert.equal(rival.wallet("account").reserved, 0);
});
test("call identity, frozen price and settlement are immutable/idempotent with cache-aware rounding", (t) => {
  const { ledger } = fixture(t);
  const first = ledger.reserve(request(1));
  assert.deepEqual(ledger.reserve(request(1)), first);
  assert.throws(
    () => ledger.reserve(request(1, { generation: 2 })),
    /CALL_ID_REUSED/,
  );
  assert.throws(
    () => ledger.freezePrice({ ...price, inputMicrosPerMillion: 2 }),
    /INVALID_PRICE|PRICE_ID_REUSED/,
  );
  ledger.sent("call:1");
  const usage = {
    prompt_tokens: 100,
    completion_tokens: 10,
    prompt_cache_hit_tokens: 90,
  };
  assert.equal(estimatedCost(price, usage), 39);
  const settled = ledger.settle("call:1", usage);
  assert.deepEqual(ledger.settle("call:1", usage), settled);
  assert.equal(ledger.wallet("account").spent, 39);
  assert.throws(
    () => ledger.settle("call:1", { ...usage, completion_tokens: 11 }),
    /USAGE_CONFLICT/,
  );
  assert.throws(
    () => ledger.db.exec("DELETE FROM reading_events"),
    /APPEND_ONLY/,
  );
  assert.throws(
    () => ledger.db.exec("UPDATE reading_prices SET body='{}'"),
    /IMMUTABLE_PRICE/,
  );
});
test("missing usage cannot be settled at zero; unknown risk persists across days and restart", (t) => {
  let now = Date.parse("2026-10-28T15:59:59Z");
  const { ledger, reopen } = fixture(t, {
    now: () => now,
    siteDailyMicros: 1500000,
  });
  ledger.reserve(request(1));
  ledger.sent("call:1");
  for (const bad of [
    {},
    null,
    [],
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 1.5, completion_tokens: 1 },
  ])
    assert.throws(() => ledger.settle("call:1", bad), /INVALID_USAGE/);
  ledger.recoverSent();
  assert.equal(ledger.call("call:1").state, "unknown");
  assert.equal(ledger.wallet("account").spent, 0);
  assert.equal(ledger.wallet("account").reserved, 0);
  assert.throws(() => ledger.reserve(request(2)), /UNKNOWN_COST/);
  now += 2000;
  ledger.grantInitial("other");
  assert.throws(
    () => ledger.reserve(request(2, { account: "other" })),
    /SITE_BUDGET/,
  );
  const reopened = reopen();
  assert.equal(reopened.call("call:1").state, "unknown");
  ledger.settle("call:1", { prompt_tokens: 2, completion_tokens: 1 });
  assert.equal(ledger.wallet("account").spent, 4);
});
test("only provably unsent calls can release; under-reservation records spending and pauses", (t) => {
  const { ledger } = fixture(t);
  ledger.reserve(request(1));
  ledger.releaseUnsent("call:1");
  ledger.releaseUnsent("call:1");
  assert.equal(ledger.wallet("account").available, 20000000);
  ledger.reserve(request(2));
  ledger.sent("call:2");
  assert.throws(() => ledger.releaseUnsent("call:2"), /NOT_PROVEN_UNSENT/);
  ledger.settle("call:2", { prompt_tokens: 2000000, completion_tokens: 1 });
  assert.equal(ledger.wallet("account").spent, 2000002);
  assert.throws(() => ledger.reserve(request(3)), /LEDGER_PAUSED/);
});
