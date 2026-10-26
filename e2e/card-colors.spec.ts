import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-26T12:00:00"));
  await page.goto("/");
  await page.evaluate(async () => {
    const store = await import("/src/bucket/store.ts");
    const kinds = ["task", "event", "idea", "habit", "notice", "note", "other"];
    const titles = [
      "完成品牌提案",
      "团队创意碰头",
      "把灵感变成作品",
      "每天读二十页书",
      "设计展报名通知",
      "值得收藏的设计笔记",
      "留给未来的小事",
    ];
    const dates = [
      "2026-10-26",
      "2026-10-29",
      "2026-10-25",
      "2026-11-26",
      "",
      "2026-10-27",
      "",
    ];
    const items = kinds.map((kind, i) => ({
      kind,
      title: titles[i],
      summary: "让每件事都有自己的颜色，行动要求与原文都清楚。",
      facts: ["合成验收材料"],
      nextSteps: ["打开原文核对要求"],
      uncertainties: [],
      evidence: [],
      sourceIds: ["input"],
      due: dates[i]
        ? {
            date: dates[i],
            time: "18:30",
            anchor: dates[i] + " 18:30",
            sourceId: "input",
          }
        : null,
    }));
    await store.putPacket({
      id: "vivid-fixture",
      text: "合成配色验收",
      sources: [{ id: "input", name: "合成配色验收", text: "合成配色验收" }],
      attachments: [],
      capturedAt: "2026-10-26T12:00:00Z",
      captureDate: "2026-10-26",
      status: "ready",
      result: { summary: "", warnings: [], items },
      itemIds: kinds,
      itemState: { note: { status: "done" } },
      doneIds: [5],
      error: "",
      updatedAt: "2026-10-26T12:00:00Z",
    });
  });
  await page.reload();
});

test("type colors survive filtering and carry through to the detail dialog", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const task = page.locator(".result-card.kind-task");
  const idea = page.locator(".result-card.kind-idea");
  await expect(task.locator(".card-topline")).toHaveCSS(
    "background-color",
    "rgb(255, 212, 59)",
  );
  await expect(idea.locator(".card-topline")).toHaveCSS(
    "background-color",
    "rgb(255, 143, 171)",
  );
  for (const card of await page.locator(".result-card").all()) {
    const { left, right, width } = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: innerWidth };
    });
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(width);
  }
  await page.screenshot({
    path: info.outputPath("world.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("navigation", { name: "内容分类" })
    .getByRole("button", { name: /灵感/ })
    .click();
  await expect(idea.locator(".card-topline")).toHaveCSS(
    "background-color",
    "rgb(255, 143, 171)",
  );
  await idea.locator(".card-open").click();
  await expect(page.getByRole("dialog").locator(".result-heading")).toHaveCSS(
    "background-color",
    "rgb(255, 143, 171)",
  );
  await expect(page.getByRole("dialog")).not.toHaveAttribute(
    "data-motion-state",
    "opening",
  );
  await page.screenshot({
    path: info.outputPath("detail.png"),
    animations: "disabled",
  });
});

test("DDL status colors preserve clock verification and completion", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const today = page
    .locator(".ddl-item.urgency-today")
    .filter({ hasText: "完成品牌提案" });
  await expect(today.locator(".ddl-status")).toHaveText("今天截止");
  await expect(today.locator(".time-rail")).toHaveCSS(
    "background-color",
    "rgb(255, 212, 59)",
  );
  await expect(page.locator(".urgency-soon .time-rail")).toHaveCSS(
    "background-color",
    "rgb(181, 152, 255)",
  );
  await page.locator(".ddl-overdue > summary").click();
  await expect(page.locator(".urgency-overdue .ddl-status")).toHaveText(
    "已逾期",
  );
  await expect(page.locator(".urgency-overdue .time-rail")).toHaveCSS(
    "background-color",
    "rgb(255, 143, 171)",
  );
  await page.screenshot({
    path: info.outputPath("ddl.png"),
    fullPage: true,
    animations: "disabled",
  });
  await today.getByRole("button", { name: /核对截止时间/ }).click();
  await expect(today.getByLabel("截止时刻", { exact: true })).toHaveValue(
    "18:30",
  );
  await today.getByRole("button", { name: /标记完成/ }).click();
  await page
    .locator(".ddl-secondary > summary")
    .filter({ hasText: "已完成" })
    .click();
  await expect(
    page
      .locator(".urgency-done")
      .filter({ hasText: "完成品牌提案" })
      .locator(".time-rail"),
  ).toHaveCSS("background-color", "rgb(96, 214, 170)");
});
