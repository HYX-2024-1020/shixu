import { test, expect } from "@playwright/test";
import { world } from "./current-ui";
test("failed card choices, persistent overlapping groups and true merge/undo use the ordinary world", async ({
  page,
}, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "synthetic offline" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const file = "/src/bucket/store.ts",
      store = await import(file);
    const make = (id: string) => ({
      id,
      text: id + "合成要求",
      sources: [],
      attachments: [],
      captureDate: "2026-11-13",
      capturedAt: "2026-11-13T10:00:00Z",
      updatedAt: "2026-11-13T10:00:00Z",
      status: "ready",
      error: "",
      doneIds: [],
      itemIds: [id + "_item"],
      result: {
        summary: "合成",
        warnings: [],
        items: [
          {
            kind: "task",
            title: id,
            summary: "保留各自要求",
            facts: [],
            nextSteps: [],
            uncertainties: [],
            evidence: [],
            sourceIds: [],
            due: null,
          },
        ],
      },
    });
    await store.putPackets([
      make("合成甲"),
      make("合成乙"),
      {
        ...make("原样材料"),
        status: "error",
        result: null,
        error: "合成读取未完成",
      },
    ]);
  });
  await page.reload();
  await world(page);
  await expect(page.locator(".result-card")).toHaveCount(3);
  const fallback = page
    .locator(".result-card")
    .filter({ hasText: "合成读取未完成" });
  await fallback.getByRole("button", { name: "保留", exact: true }).click();
  await expect(
    page.getByText("已保留，可正常编辑、分组和删除", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "管理小组与类型入口", exact: true })
    .click();
  await page.getByLabel("新小组名称").fill("校园电动车");
  await page.getByRole("button", { name: "建立小组", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "我的小组" })
      .getByRole("button", { name: "校园电动车", exact: true }),
  ).toBeVisible();
  const a = page
    .locator(".result-card")
    .filter({
      has: page.getByRole("heading", { name: "合成甲", exact: true }),
    });
  await a.locator("summary[aria-label='更多事项操作']").click();
  await a.getByRole("checkbox", { name: "校园电动车", exact: true }).check();
  await a.locator("summary[aria-label='更多事项操作']").click();
  await page
    .getByRole("navigation", { name: "我的小组" })
    .getByRole("button", { name: "校园电动车", exact: true })
    .click();
  await expect(page.locator(".result-card")).toHaveCount(1);
  await page.reload();
  await world(page);
  await page
    .getByRole("navigation", { name: "我的小组" })
    .getByRole("button", { name: "校园电动车", exact: true })
    .click();
  await expect(page.locator(".result-card")).toHaveCount(1);
  await page.getByRole("button", { name: "全部小组", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "选择合并 合成甲", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "选择合并 合成乙", exact: true })
    .check();
  await page
    .getByRole("button", { name: "合并已选卡片（2）", exact: true })
    .click();
  const preview = page.getByRole("dialog", { name: "核对多卡合并" });
  await preview.getByLabel("主卡标题").fill("统一办理");
  await preview.getByRole("button", { name: "确认合并", exact: true }).click();
  await expect(page.locator(".result-card")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "统一办理", exact: true }),
  ).toBeVisible();
  await page.reload();
  await world(page);
  await expect(
    page.getByRole("heading", { name: "统一办理", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销合并", exact: true }).click();
  await expect(page.locator(".result-card")).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("round-two-world.png") });
});
