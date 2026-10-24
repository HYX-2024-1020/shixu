import { test, expect } from "@playwright/test";
import { records, world } from "./current-ui";
test("Apple touch layout, install guidance and original files survive restart", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "往桶里放入内容" });
  await expect(input).toBeEnabled();
  await expect(input).not.toBeFocused();
  expect(
    parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.getByText("安装到 iPhone / iPad", { exact: true }).click();
  await expect(
    page.getByText("用 Safari 打开拾序，把这个桶放到主屏幕。"),
  ).toBeVisible();
  await input.fill("完成 Python 第二课作业，要求见附件。");
  await page.locator("input[type=file]").setInputFiles({
    name: "老师通知.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("周五提交，附上源代码。"),
  });
  await expect(page.locator(".attachment-chip")).toContainText("老师通知.txt");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.reload();
  const d = await records(page);
  await d.getByText("原文、遗漏与操作", { exact: true }).click();
  await expect(d).toContainText("完成 Python 第二课作业");
  await expect(d).toContainText("老师通知.txt");
  await expect(
    d.getByLabel("预览 老师通知.txt", { exact: true }),
  ).toContainText("周五提交，附上源代码。");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await d.getByLabel("关闭整理记录", { exact: true }).click();
  await expect(d).toHaveCount(0);
  await page.getByRole("button", { name: "连接与设置" }).click();
  const close = page.getByRole("button", { name: "关闭设置" });
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await close.click();
});
test("grouped cards remain usable in narrow Apple multitasking windows", async ({
  page,
}) => {
  await page.goto("/?preview=relations");
  await world(page);
  await page.getByRole("button", { name: "按分组查看", exact: true }).click();
  await expect(page.locator(".result-card:visible")).toHaveCount(2);
  await expect(page.locator(".collection-heading")).toHaveCount(1);
  const check = page.locator(".result-card:visible .completion-orbit").first();
  await check.tap();
  await expect(page.locator(".result-card:visible")).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 667 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await world(page);
  await page.getByLabel("结果范围").selectOption("done");
  await expect(page.locator(".result-card:visible")).toHaveCount(1);
});
