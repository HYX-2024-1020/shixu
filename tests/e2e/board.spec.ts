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
    .locator(".sx-board-sidebar")
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
    .locator(".sx-board-sidebar")
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
  await board.getByLabel("长期计划操作").click();
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
  await board.getByLabel("看板视图").selectOption("panel");
  await board.getByLabel("添加图片或文件").setInputFiles({
    name: "合成资料.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("restart-original"),
  });
  await expect(
    board.getByText("合成资料.txt", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await board.getByLabel("资料操作：合成资料.txt").click();
  await board
    .getByLabel("资料关联长期计划")
    .selectOption({ label: "合成长计划" });
  await page.evaluate(() => window.flushBoardDraft?.());
  await page.reload();
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await board.getByLabel("看板视图").selectOption("panel");
  await expect(
    board.getByText("合成资料.txt", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await board.getByLabel("资料操作：合成资料.txt").click();
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

test("library drag and display names survive reload; browser downloads the original name and bytes", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "mobile",
    "Mouse drag is covered by desktop.",
  );
  await page.goto("/?board=1");
  await page.getByLabel("看板视图").selectOption("panel");
  await page.getByLabel("添加图片或文件").setInputFiles([
    {
      name: "原件.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("original"),
    },
    {
      name: "第二份.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("second"),
    },
  ]);
  const cards = page.locator(".sx-library-card");
  await expect(cards).toHaveCount(2);
  const grip = await cards
    .first()
    .locator("[data-card-drag-handle]")
    .boundingBox();
  const target = await cards.last().boundingBox();
  if (!grip || !target) throw Error("资料卡未呈现");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 12 },
  );
  await expect(cards.first()).toContainText("第二份.txt");
  await page.mouse.up();
  await expect(page.getByText("已移动到第 2 个位置")).toHaveCount(1);
  await page.getByLabel("资料操作：原件.txt").click();
  await cards.last().getByLabel("资料显示名").fill("新显示名");
  await cards.last().getByRole("button", { name: "保存名称" }).click();
  await page.evaluate(() => window.flushBoardDraft?.());
  await page.reload();
  await page.getByLabel("看板视图").selectOption("panel");
  await expect(cards.first()).toContainText("第二份.txt");
  await expect(cards.last()).toContainText("新显示名");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "打开资料：新显示名" }).click();
  const original = await download;
  expect(original.suggestedFilename()).toBe("原件.txt");
  const chunks = [];
  for await (const chunk of await original.createReadStream())
    chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe("original");
});

test("strip spacing, completion and deliberate removal work with a persistent custom palette", async ({
  page,
}) => {
  await page.goto("/?board=1");
  for (const name of ["待办甲", "待办乙"]) {
    await page.getByLabel("新增短期计划").fill(name);
    await page
      .getByRole("button", { name: "新增一项", exact: true })
      .filter({ visible: true })
      .click();
  }
  await page.getByLabel("看板视图").selectOption("strip");
  await page.getByLabel("展开小条").click();
  const tasks = page.getByTestId("strip-board");
  const cards = tasks.locator(".sx-task");
  await expect(cards).toHaveCount(2);
  expect(
    await cards.first().evaluate((card) => {
      const check = card
        .querySelector(".sx-task-check")!
        .getBoundingClientRect();
      const menu = card.querySelector("summary")!.getBoundingClientRect();
      return menu.left >= check.right && Math.abs(menu.top - check.top) < 4;
    }),
  ).toBe(true);
  await expect(tasks.locator(".sx-strip-list")).toHaveCSS("row-gap", "10px");
  await tasks
    .getByRole("checkbox", { name: "完成：待办甲", exact: true })
    .check();
  await expect(
    tasks.getByRole("checkbox", { name: "撤销完成：待办甲", exact: true }),
  ).toBeChecked();
  await expect(cards.first().locator(".sx-check-mark")).toHaveCSS(
    "stroke-dashoffset",
    "0px",
  );
  await expect(cards).toHaveCount(2);
  await page.evaluate(() => window.flushBoardDraft?.());
  await page.getByLabel("卡面配色").selectOption("custom");
  await page.getByLabel("卡面颜色").fill("#206080");
  await page.reload();
  await page.getByLabel("看板视图").selectOption("strip");
  await expect(page.getByLabel("卡面颜色")).toHaveValue("#206080");
  await expect(
    tasks.getByRole("checkbox", { name: "撤销完成：待办甲", exact: true }),
  ).toBeChecked();
  await tasks.getByLabel("事项操作：待办甲").click();
  await tasks
    .getByRole("button", { name: "删除：待办甲", exact: true })
    .click();
  await expect(cards).toHaveCount(1);
  await page.getByText(/最近删除 · 1/).click();
  await page.getByRole("button", { name: "恢复事项", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(
    tasks.getByRole("checkbox", { name: "撤销完成：待办甲", exact: true }),
  ).toBeChecked();
});
