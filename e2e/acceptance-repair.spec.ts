import { test, expect } from "@playwright/test";

test("failed organization keeps usable original material and retry after reload", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "unavailable" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容" }),
  ).toBeEnabled();
  await page.evaluate(async () => {
    const path = "/src/bucket/store.ts";
    const store = await import(path);
    await store.putPackets([
      {
        id: "synthetic-raw",
        text: "合成通知：本周交报告，原文不能丢失。",
        attachments: [],
        sources: [],
        captureDate: "2026-11-11",
        capturedAt: "2026-11-11T00:00:00Z",
        updatedAt: "2026-11-11T00:00:00Z",
        status: "error",
        result: null,
        doneIds: [],
        error: "整理核对未通过；报告编号 synthetic-report",
      },
    ]);
  });
  await page.reload();
  await expect(page.locator(".current-delivery")).toContainText(
    "原样材料已保存",
  );
  await page
    .locator(".current-delivery")
    .getByRole("button", { name: "查看原样材料" })
    .click();
  const card = page.locator(".raw-material-card");
  await expect(card).toContainText("AI尚未完成整理");
  await expect(card.getByRole("button", { name: "后续再整理" })).toBeVisible();
  await card.getByRole("button", { name: "查看原样材料" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "合成通知：本周交报告，原文不能丢失。",
  );
  await page.reload();
  await expect(page.locator(".current-delivery")).toContainText(
    "synthetic-report",
  );
});
