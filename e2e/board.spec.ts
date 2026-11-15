import { test, expect } from "@playwright/test";
test("unsubmitted title, deadline and planning-name edits recover when editors reopen after restart", async ({
  page,
}) => {
  await page.goto("/?board=1");
  await page.getByLabel("新增短期计划").fill("已有事项");
  await page
    .getByRole("button", { name: "新增一项", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByLabel("编辑事项：已有事项", { exact: true }).click();
  await page
    .locator(".sx-task-edit:visible")
    .getByLabel("标题", { exact: true })
    .fill("未提交的新标题");
  await page
    .locator(".sx-task-edit:visible")
    .locator("input[type=datetime-local]")
    .fill("2026-12-01T14:30");
  await page
    .locator(".sx-rail")
    .getByLabel("新建规划", { exact: true })
    .click();
  await page.getByLabel("新规划名称", { exact: true }).fill("未提交规划名");
  await page.evaluate(() => window.flushBoardDraft?.());
  await page.reload();
  await page.getByLabel("编辑事项：已有事项", { exact: true }).click();
  await expect(
    page.locator(".sx-task-edit:visible").getByLabel("标题", { exact: true }),
  ).toHaveValue("未提交的新标题");
  await expect(
    page.locator(".sx-task-edit:visible").locator("input[type=datetime-local]"),
  ).toHaveValue("2026-12-01T14:30");
  await page
    .locator(".sx-rail")
    .getByLabel("新建规划", { exact: true })
    .click();
  await expect(page.getByLabel("新规划名称", { exact: true })).toHaveValue(
    "未提交规划名",
  );
  await page
    .locator(".sx-task-edit:visible")
    .getByRole("button", { name: "保存修改", exact: true })
    .click();
  await page.getByLabel("编辑事项：未提交的新标题", { exact: true }).click();
  await page
    .locator(".sx-task-edit:visible")
    .getByLabel("标题", { exact: true })
    .fill("用户主动取消的文字");
  await page
    .locator(".sx-task-edit:visible")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByLabel("编辑事项：未提交的新标题", { exact: true }).click();
  await expect(
    page.locator(".sx-task-edit:visible").getByLabel("标题", { exact: true }),
  ).toHaveValue("未提交的新标题");
});
test("real board persists planning, shared steps, archive restoration, input drafts and originals without bucket pollution", async ({
  page,
}) => {
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 503, body: "synthetic offline" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "看板", exact: true }).click();
  const board = page.locator(".sx-host");
  await board.getByLabel("新增短期计划").fill("合成短期");
  await board
    .getByRole("button", { name: "新增一项", exact: true })
    .filter({ visible: true })
    .click();
  await expect(board.locator(".sx-task:visible")).toContainText("合成短期");
  await board.getByRole("button", { name: "长期计划", exact: true }).click();
  await board.getByLabel("新增长期计划").fill("合成长计划");
  await board
    .getByRole("button", { name: "新增一项", exact: true })
    .filter({ visible: true })
    .click();
  await board.getByLabel("合成长计划的新子事项").fill("共享步骤");
  await board.getByRole("button", { name: "子事项", exact: true }).click();
  const id = await board
    .locator(".sx-task:visible")
    .getAttribute("data-task-id");
  await board
    .getByLabel("完成：共享步骤", { exact: true })
    .filter({ visible: true })
    .click();
  await board.getByRole("button", { name: "归档已完成", exact: true }).click();
  await board.locator(".sx-archived summary").click();
  await board.getByRole("button", { name: "恢复展示", exact: true }).click();
  await expect(
    board
      .getByLabel("撤销完成：共享步骤", { exact: true })
      .filter({ visible: true }),
  ).toBeChecked();
  await board.getByRole("button", { name: "短期计划", exact: true }).click();
  await expect(
    board.locator(`.sx-task:visible[data-task-id="${id}"]`),
  ).toContainText("共享步骤");
  await board.getByLabel("新增短期计划").fill("未提交合成草稿");
  await page.evaluate(() => window.flushBoardDraft?.());
  await page.reload();
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(board.getByLabel("新增短期计划")).toHaveValue("未提交合成草稿");
  await board.getByRole("button", { name: "面板", exact: true }).click();
  await board.getByLabel("添加图片或文件").setInputFiles({
    name: "合成资料.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("restart-original"),
  });
  await expect(
    board.getByText("合成资料.txt", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await board
    .getByText("合成资料.txt", { exact: true })
    .filter({ visible: true })
    .click();
  await board
    .getByLabel("资料关联长期计划")
    .selectOption({ label: "合成长计划" });
  await page.evaluate(() => window.flushBoardDraft?.());
  await page.reload();
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await board.getByRole("button", { name: "面板", exact: true }).click();
  await expect(
    board.getByText("合成资料.txt", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await board
    .getByText("合成资料.txt", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(board.getByLabel("资料关联长期计划")).toHaveValue(/parent-/);
  const packets = await page.evaluate(async () => {
    const path = "/src/bucket/store.ts";
    return (await import(path)).allPackets();
  });
  expect(packets).toHaveLength(0);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("two browser windows reject stale snapshots and do not overwrite each other", async ({
  page,
  context,
}) => {
  await page.goto("/?board=1");
  await expect(page.getByLabel("新增短期计划")).toBeVisible();
  const other = await context.newPage();
  await other.goto("/?board=1");
  await expect(other.getByLabel("新增短期计划")).toBeVisible();
  await page.getByLabel("新增短期计划").fill("窗口甲");
  await page.evaluate(() => window.flushBoardDraft?.());
  await other.getByLabel("新增短期计划").fill("窗口乙");
  await other.evaluate(() => window.flushBoardDraft?.()).catch(() => {});
  await expect(other.getByText(/另一窗口已修改看板/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("新增短期计划")).toHaveValue("窗口甲");
});
