import { expect } from "@playwright/test";

// waitForFunction tests Promise truthiness before its async predicate resolves.
// Poll from Node so an IPC-backed predicate must actually resolve to true.
export async function waitForPageState(page, predicate, arg, options = {}) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(predicate, arg);
        } catch (error) {
          // Activation intentionally reloads the renderer. Retry that transition,
          // but surface closed windows and genuine predicate/IPC failures.
          if (String(error.message).includes("Execution context was destroyed"))
            return false;
          throw error;
        }
      },
      {
        timeout: options.timeout || 20000,
        intervals: [100],
      },
    )
    .toBeTruthy();
}
