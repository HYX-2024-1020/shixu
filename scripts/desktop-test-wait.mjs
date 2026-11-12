import { expect } from "@playwright/test";

// A fresh Windows profile can still be upgrading after the first markup is
// visible. Keep the data-load barrier; never enable a blank replacement draft.
export async function waitForDesktopReady(page, label = "desktop") {
  const started = Date.now();
  const input = page.getByRole("textbox", {
    name: "往桶里放入内容",
    exact: true,
  });
  try {
    await expect(input).toBeEnabled({ timeout: 12000 });
  } catch (error) {
    console.error(
      "Synthetic profile startup failure:",
      label,
      await page.evaluate(() => ({
        readyState: document.readyState,
        hasBridge: !!window.desktop,
        profileUpgrade: localStorage.getItem("shixu-native-store-v1"),
        body: document.body.innerText.slice(0, 4000),
      })),
    );
    throw error;
  }
  console.log("Synthetic profile hydration (ms):", label, Date.now() - started);
}

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
