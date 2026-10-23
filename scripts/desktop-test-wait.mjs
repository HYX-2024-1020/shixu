import { expect } from "@playwright/test";

// waitForFunction tests Promise truthiness before its async predicate resolves.
// Poll from Node so an IPC-backed predicate must actually resolve to true.
export async function waitForPageState(page, predicate, arg, options = {}) {
  await expect
    .poll(() => page.evaluate(predicate, arg), {
      timeout: options.timeout || 20000,
      intervals: [100],
    })
    .toBeTruthy();
}
