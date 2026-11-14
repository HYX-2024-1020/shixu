import { test, expect } from "@playwright/test";

test("failed material offers three visible actions in the bucket and manual edits survive restart without AI", async ({
  page,
}, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "synthetic offline" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const file = "/src/bucket/store.ts";
    const store = await import(file);
    await store.putPackets([
      {
        id: "synthetic-stability",
        text: "合成验收材料",
        sources: [],
        attachments: [],
        doneIds: [],
        capturedAt: "2026-11-14T00:00:00Z",
        updatedAt: "2026-11-14T00:00:00Z",
        captureDate: "2026-11-14",
        status: "error",
        result: null,
        error: "合成停止整理",
      },
    ]);
  });
  await page.reload();
  const current = page.locator(".current-delivery");
  for (const name of ["保留", "删除", "重试"]) {
    const button = current.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(76);
  }
  await expect(current.locator(".completion-orbit")).toBeHidden();
  await page.screenshot({
    path: `../outputs/acceptance-unblock-20261114/failed-actions-${info.project.name}.png`,
    animations: "disabled",
  });
  await current.getByRole("button", { name: "保留", exact: true }).click();
  await current.getByRole("button", { name: "手动编辑", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[name=title]").fill("验收合成材料");
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(page.locator(".result-card")).toContainText("验收合成材料");
  await expect(page.locator(".default-card-decision")).toHaveCount(0);
});
