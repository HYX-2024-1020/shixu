import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedModelFetch } from "./sync-provider.mjs";

const url = "https://api.deepseek.com/chat/completions";
const request = {
  method: "POST",
  body: JSON.stringify({
    messages: [{ role: "user", content: "合成材料" }],
    max_tokens: 7000,
  }),
};
test("provider bounds the actual request and allows one billable attempt per job", async () => {
  let payload,
    attempts = 0;
  const fetcher = boundedModelFetch({
    maxOutputTokens: 1024,
    fetcher: async (_, init) => {
      attempts++;
      payload = JSON.parse(init.body);
      assert.equal(init.redirect, "error");
      return new Response('{"fixture":true}');
    },
  });
  const response = await fetcher(url, request);
  assert.equal(payload.max_tokens, 1024);
  assert.equal(payload.stream, false);
  assert.deepEqual(await response.json(), { fixture: true });
  await assert.rejects(
    fetcher(url, request),
    (e) => e.code === "AI_CALL_LIMIT",
  );
  assert.equal(attempts, 1);
});
test("oversized input is rejected before upstream; oversized output never reaches organizer", async () => {
  let attempts = 0;
  const small = boundedModelFetch({
    maxOutputTokens: 100,
    maxRequestBytes: 2,
    fetcher: async () => {
      attempts++;
    },
  });
  await assert.rejects(small(url, request), (e) => e.code === "AI_INPUT_LIMIT");
  assert.equal(attempts, 0);
  const large = boundedModelFetch({
    maxOutputTokens: 100,
    fetcher: async () => new Response("x".repeat(128001)),
  });
  await assert.rejects(
    large(url, request),
    (e) => e.code === "AI_OUTPUT_LIMIT",
  );
});
test("upstream network errors are never retried automatically", async () => {
  let attempts = 0;
  const fetcher = boundedModelFetch({
    maxOutputTokens: 1024,
    fetcher: async () => {
      attempts++;
      throw Error("synthetic lost response");
    },
  });
  await assert.rejects(fetcher(url, request));
  await assert.rejects(
    fetcher(url, request),
    (e) => e.code === "AI_CALL_LIMIT",
  );
  assert.equal(attempts, 1);
});
