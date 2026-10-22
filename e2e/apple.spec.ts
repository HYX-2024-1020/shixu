import { test, expect } from "@playwright/test";

test("Apple touch layout, install guidance, files and durable capture", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "往桶里放入内容" });
  await expect(input).toBeEnabled();
  await expect(input).not.toBeFocused();
  await expect(input).toHaveCSS("font-size", "16px");
  await page.getByText("安装到 iPhone / iPad", { exact: true }).click();
  await expect(
    page.getByText("用 Safari 打开拾序，把这个桶放到主屏幕。"),
  ).toBeVisible();
  await input.fill("完成 Python 第二课作业，要求见附件。");
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "老师通知.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("周五提交，附上源代码。"),
    });
  await expect(page.locator(".attachment-chip")).toContainText("老师通知.txt");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.reload();
  await page.getByRole("button", { name: "原文与附件", exact: true }).click();
  await expect(page.locator(".bucket-packet")).toContainText(
    "完成 Python 第二课作业",
  );
  await expect(page.locator(".bucket-packet")).toContainText("老师通知.txt");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "连接与设置" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  const close = page.getByRole("button", { name: "关闭设置" });
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await close.click();
});

test("Apple grouped tasks remain usable in narrow multitasking windows", async ({
  page,
}) => {
  await page.goto("/?preview=relations");
  await expect(page.locator(".group-unit")).toHaveCount(2);
  const check = page.locator(".group-unit .bucket-check").first();
  expect((await check.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await check.click();
  await expect(page.locator(".group-stamp")).toContainText("1/2 已完成");
  await page.setViewportSize({ width: 375, height: 667 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".group-stamp")).toContainText("1/2 已完成");
});
