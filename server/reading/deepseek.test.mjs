import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "./deepseek.mjs";
import { ReadingLedger, validateUsage } from "./ledger.mjs";
const sources = [{ id: "input", name: "合成.txt", text: "明天提交报告😀" }];
test("semantic provider uses bounded paid-item context, reference-only edges and the same no-retry usage adapter",async()=>{
  let calls=0;
  const provider=createDeepSeekReadingProvider({apiKey:"synthetic",priceAt:()=>deepseekPriceSnapshots(1)[0].id,fetcher:async(url,init)=>{
    calls++;const b=JSON.parse(init.body);
    assert.match(b.messages[0].content,/不得创建新id/);assert.equal(b.tool_choice,"none");
    assert.equal(b.tools,undefined);assert.equal(b.stream,false);
    return Response.json({usage:{prompt_tokens:20,completion_tokens:10},choices:[{finish_reason:"stop",message:{content:'{"same":[],"related":[]}'}}]});
  }});
  const sources=[{id:"merge",text:JSON.stringify({schema:"paid-semantic-pairs/1",items:[{id:"a",item:{title:"合成"}},{id:"b",item:{title:"合成"}}]})}];
  const prepared=provider.merge.prepare(sources);assert.ok(prepared.maxPromptTokens>Buffer.byteLength(prepared.body));
  assert.deepEqual((await provider.merge(sources,undefined,{prepared})).result,{same:[],related:[]});assert.equal(calls,1);
  assert.throws(()=>provider.merge.prepare([{...sources[0],image:{}}]),/INVALID_PROVIDER_INPUT/);
});
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

test('chat provider prepares only saved context and uses the common no-retry usage adapter',async()=>{
  let calls=0;
  const provider=createDeepSeekReadingProvider({apiKey:'synthetic',priceAt:()=>deepseekPriceSnapshots(1)[0].id,fetcher:async(url,init)=>{
    calls++;const body=JSON.parse(init.body);
    assert.equal(body.messages.length,2);assert.match(body.messages[0].content,/没有重新读取原件/);
    assert.equal(body.max_tokens,4000);assert.equal(body.tools,undefined);assert.equal(body.stream,false);
    const context=JSON.parse(body.messages[1].content);assert.equal(context.instruction,'只问问题');
    return Response.json({usage:{prompt_tokens:30,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'回答',patch:{}})}}]});
  }});
  const sources=[{id:'chat',text:JSON.stringify({schema:'saved-item-chat/1',today:'2026-10-30',instruction:'只问问题',currentItem:{title:'合成'}})}];
  const prepared=provider.chat.prepare(sources);
  assert.ok(prepared.maxPromptTokens>Buffer.byteLength(prepared.body));
  const result=await provider.chat(sources,undefined,{prepared});
  assert.deepEqual(result.result,{reply:'回答',patch:{}});assert.equal(result.usage.prompt_tokens,30);assert.equal(calls,1);
  assert.throws(()=>provider.chat.prepare([...sources,...sources]),/INVALID_PROVIDER_INPUT/);
});
