import test from "node:test";
import assert from "node:assert/strict";
import { executionLimitReader } from "./reading-limit-fixture.mjs";

test("audited budget admits the first read even when pre-read work exhausted the initial limit", { timeout: 1000 }, async () => {
  let reads = 0;
  const reader = executionLimitReader(async () => { reads++; return "material"; });
  const signal = new AbortController().signal;
  // No reader invocation preceded the audit. The old first-call fault would
  // hang here until the full renewed budget elapsed.
  assert.equal(await reader({}, { signal, activeBudgetMs: 3599800 }), "material");
  assert.equal(reads, 1);
});

test("initial budget still waits for confirmed cancellation, including an already aborted signal", async () => {
  const reader = executionLimitReader(() => assert.fail("must not read"));
  for (const alreadyAborted of [false, true]) {
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const pending = reader({}, { signal: controller.signal, activeBudgetMs: 80 });
    if (!alreadyAborted) controller.abort();
    await assert.rejects(pending, error => error.message === "READING_ABORTED" && error.timing.waitingMs === 0);
  }
});
