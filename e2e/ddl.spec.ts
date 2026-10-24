import { test, expect } from "@playwright/test";

test("legacy blank deadline clocks recover the stated time or get an editable default", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00"));
  await page.goto("/");
  await page.evaluate(async () => {
    const store = await import("/src/bucket/store.ts");
    const text = "明天下午三点十分前提交报告";
    const item = (title: string, source: string) => ({
      kind: "task",
      title,
      summary: "合成回归资料",
      facts: [],
      nextSteps: [],
      uncertainties: [],
      sourceIds: ["input"],
      evidence: [{ sourceId: "input", quote: source }],
      due: { date: "2026-10-29", time: "", anchor: "明天", sourceId: "input" },
    });
    await store.putPacket({
      id: "time-recovery-fixture",
      text,
      sources: [{ id: "input", name: "合成通知", text }],
      attachments: [],
      capturedAt: "2026-10-28T12:00:00Z",
      captureDate: "2026-10-28",
      status: "ready",
      result: {
        summary: "合成时刻回归",
        warnings: [],
        items: [
          item("恢复报告时刻", text),
          {
            ...item("默认草稿时刻", "明天交草稿"),
            due: {
              date: "2026-10-29",
              time: "",
              anchor: "明天",
              sourceId: "manual",
            },
          },
        ],
      },
      itemIds: ["recover-clock", "default-clock"],
      itemState: {},
      doneIds: [],
      updatedAt: "2026-10-28T12:00:00Z",
      error: "",
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const ddl = page.getByRole("region", { name: "DDL 截止事项" });
  const recovered = ddl
    .locator(".ddl-item")
    .filter({ hasText: "恢复报告时刻" });
  await expect(recovered.locator(".time-rail")).toContainText("15:10");
  const guessed = ddl.locator(".ddl-item").filter({ hasText: "默认草稿时刻" });
  await expect(guessed.locator(".time-rail")).toContainText("23:59");
  await guessed.getByRole("button", { name: /核对截止时间/ }).click();
  await expect(guessed.locator(".ddl-time-inference")).toContainText(
    "未指定时刻",
  );
  await guessed.getByLabel("截止时刻", { exact: true }).fill("18:30");
  await guessed.getByRole("button", { name: "保存时间" }).click();
  await expect(guessed.locator(".time-rail")).toContainText("18:30");
  await expect(guessed.locator(".ddl-time-inference")).toHaveCount(0);
  await expect(ddl).not.toContainText("具体时刻未知");
  await page.reload();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await expect(
    ddl
      .locator(".ddl-item")
      .filter({ hasText: "默认草稿时刻" })
      .locator(".time-rail"),
  ).toContainText("18:30");
});

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
  await expect(card.locator(".time-rail")).toContainText("23:59");
  await expect(card.locator(".ddl-time-inference")).toContainText("未指定时刻");
  await expect(card.locator(".ddl-copy h3")).toHaveText(
    "2026年11月02日交课程报告",
  );
  await card.getByRole("button", { name: /标记完成/ }).click();
  await ddl.getByText(/已完成 · 1 项/).click();
  const completed = ddl.getByRole("button", { name: /撤销完成/ });
  await expect(completed).toHaveAttribute("aria-pressed", "true");
  await expect(completed).toHaveClass("completion-orbit");
  await expect(completed.locator("svg")).toBeVisible();
  await expect(completed).toHaveCSS("border-radius", "50%");
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
