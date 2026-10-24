import { test, expect } from "@playwright/test";

test("DDL manual input resolves once, shares world state, edits and survives restart", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00"));
  await page.goto("/");
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const ddl = page.getByRole("region", { name: "DDL 截止事项" });
  await ddl.getByText("＋ 自己补充一项 DDL", { exact: true }).click();
  await ddl.getByLabel("事项标题", { exact: true }).fill("明天交课程报告");
  await ddl.getByLabel("截止日期", { exact: true }).last().fill("明天下午三点");
  await ddl.getByLabel("交付要求", { exact: true }).fill("提交 PDF 和访谈记录");
  await ddl.getByRole("button", { name: "添加 DDL", exact: true }).click();
  let card = ddl.locator(".ddl-item").filter({ hasText: "课程报告" });
  await expect(card.locator(".ddl-copy h3")).toHaveText(
    "2026年10月29日交课程报告",
  );
  await expect(card.locator(".time-rail")).toContainText("15:00");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: `test-results/ddl-${test.info().project.name}.png`,
    fullPage: true,
  });
  await card.getByRole("button", { name: /核对截止时间/ }).click();
  await expect(card.locator("blockquote")).toContainText("明天下午三点");
  await card.getByLabel("截止日期", { exact: true }).fill("2026-11-02");
  await card.getByLabel("截止时刻", { exact: true }).fill("");
  await card.getByRole("button", { name: "保存时间" }).click();
  await expect(card.locator(".time-rail")).toContainText("具体时刻未知");
  await expect(card.locator(".ddl-copy h3")).toHaveText(
    "2026年11月02日交课程报告",
  );
  await card.getByRole("button", { name: /标记完成/ }).click();
  await ddl.getByText(/已完成 · 1 项/).click();
  await ddl.getByRole("button", { name: /撤销完成/ }).click();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(
    page
      .locator(".results-workspace")
      .first()
      .getByRole("heading", { name: "2026年11月02日交课程报告", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.clock.setFixedTime(new Date("2026-11-03T12:00:00"));
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await ddl.getByText("已逾期 · 1 项 · 点开看看", { exact: true }).click();
  await expect(ddl.locator(".ddl-item .ddl-copy h3")).toHaveText(
    "2026年11月02日交课程报告",
  );
});
