const { test } = require("node:test");
const assert = require("node:assert/strict");

test("desktop state polling survives a renderer reload and awaits a true IPC result", async () => {
  const { waitForPageState } = await import("../scripts/desktop-test-wait.mjs");
  let calls = 0;
  await waitForPageState(
    {
      evaluate: async () => {
        calls++;
        if (calls === 1)
          throw Error(
            "page.evaluate: Execution context was destroyed, most likely because of a navigation.",
          );
        return calls > 2;
      },
    },
    () => true,
    null,
    { timeout: 2000 },
  );
  assert.equal(calls, 3);
});

test("desktop polling preserves actual predicate and closed-page errors", async () => {
  const { waitForPageState } = await import("../scripts/desktop-test-wait.mjs");
  for (const message of [
    "IPC failure",
    "Target page, context or browser has been closed",
  ]) {
    await assert.rejects(
      waitForPageState(
        {
          evaluate: async () => {
            throw Error(message);
          },
        },
        () => true,
      ),
      { message },
    );
  }
});
