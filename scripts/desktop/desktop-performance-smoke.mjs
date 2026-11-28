import { waitForPageState } from "./desktop-test-wait.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-scale-test-")),
  env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const packets = Array.from({ length: 1000 }, (_, n) => ({
      id: "scale-" + n,
      text: "老师通知 " + n,
      sources: [
        { id: "input", name: "包内资料" + n + ".txt", text: "老师通知 " + n },
      ],
      attachments: [],
      capturedAt: new Date().toISOString(),
      captureDate: "2026-10-23",
      updatedAt: new Date().toISOString(),
      status: "ready",
      error: "",
      doneIds: [],
      itemIds: ["item-" + n + "-0", "item-" + n + "-1"],
      result: {
        summary: "模拟大量结果",
        warnings: [],
        items: [0, 1].map((i) => ({
          kind: "task",
          title: `事项 ${n}-${i}`,
          summary: "用于检索与输入性能验证",
          facts: ["原文要求"],
          nextSteps: [],
          uncertainties: [],
          evidence: [{ sourceId: "input", quote: "老师通知" }],
          sourceIds: ["input"],
          due: null,
          group: "课程 " + (n % 10),
        })),
      },
    }));
    await window.desktop.store("savePackets", packets);
  });
  await page.reload();
  const composer = page.getByRole("textbox", {
    name: "往桶里放入内容",
    exact: true,
  });
  await composer.fill("");
  assert.ok(
    (await page.locator(".result-card").count()) <= 80,
    "initial DOM must be paginated",
  );
  const start = performance.now();
  await composer.pressSequentially("大量资料下仍然可以继续输入与投递。", {
    delay: 2,
  });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 5000, `typing blocked for ${elapsed}ms`);
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByLabel("搜索整理结果", { exact: true }).fill("事项 999");
  await waitForPageState(
    page,
    () =>
      document.querySelectorAll(".results-workspace .result-card").length === 2,
  );
  await page
    .getByLabel("搜索整理结果", { exact: true })
    .fill("包内资料999.txt");
  await waitForPageState(
    page,
    () =>
      document.querySelectorAll(".results-workspace .result-card").length === 2,
  );
  await page.getByRole("button", { name: "投递桶", exact: true }).click();
  assert.equal(
    await composer.inputValue(),
    "大量资料下仍然可以继续输入与投递。",
  );
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  assert.equal(
    await page.getByLabel("搜索整理结果", { exact: true }).inputValue(),
    "包内资料999.txt",
  );
  console.log(
    `PASS: 1000 deliveries / 2000 items, bounded initial DOM, search and workspace state retained; typing ${Math.round(elapsed)}ms`,
  );
} finally {
  await app.close();
}
