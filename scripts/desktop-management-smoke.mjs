import { waitForPageState } from "./desktop-test-wait.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-management-test-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  console.log("UI loaded");
  await page.evaluate(async () => {
    const item = (kind) => ({
      kind,
      title:
        kind === "task"
          ? "提交报告"
          : kind === "habit"
            ? "每天阅读"
            : "课程通知",
      summary: "来自示例材料",
      facts: ["明天交报告"],
      nextSteps: ["列出提纲"],
      uncertainties: ["没有具体时刻"],
      evidence: [{ sourceId: "input", quote: "明天交报告" }],
      sourceIds: ["input"],
      due: null,
    });
    await window.desktop.store("savePackets", [
      {
        id: "p1",
        text: "明天交报告",
        sources: [{ id: "input", name: "随手输入", text: "明天交报告" }],
        attachments: [
          {
            id: "attachment-one",
            name: "资料原件.txt",
            type: "text/plain",
            size: 3,
            bytes: Uint8Array.from([1, 2, 3]).buffer,
          },
        ],
        status: "ready",
        result: {
          summary: "收下了任务、习惯和通知",
          items: ["task", "habit", "notice"].map(item),
          warnings: [],
        },
        doneIds: [],
        itemIds: ["i1", "i2", "i3"],
        updatedAt: new Date().toISOString(),
        capturedAt: new Date().toISOString(),
        captureDate: "2026-10-23",
        error: "",
      },
    ]);
    await window.desktop.key("save", "dummy-key-for-local-test");
    if ((await window.desktop.key("read")) !== "dummy-key-for-local-test")
      throw new Error("key round trip failed");
    await window.desktop.key("remove");
  });
  console.log("Seed and key round trip saved");
  await page.reload();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  console.log("Results opened");
  const task = page.locator(".result-card").filter({
    has: page.getByRole("heading", { name: "提交报告", exact: true }),
  });
  await task.getByRole("button", { name: "星标", exact: true }).click();
  await task.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByLabel("结果范围").selectOption("done");
  await task
    .getByRole("button", { name: "撤销完成 / 归档", exact: true })
    .click();
  await page.getByLabel("结果范围").selectOption("active");
  const habit = page.locator(".result-card").filter({
    has: page.getByRole("heading", { name: "每天阅读", exact: true }),
  });
  await habit.getByRole("button", { name: "今天打卡", exact: true }).click();
  await waitForPageState(
    page,
    async () =>
      (await window.desktop.store("packets"))[0].itemState.i2.checkins
        .length === 1,
  );
  await habit.getByRole("button", { name: "今天已打卡", exact: true }).click();
  await waitForPageState(
    page,
    async () =>
      (await window.desktop.store("packets"))[0].itemState.i2.checkins
        .length === 0,
  );
  await habit.getByRole("button", { name: "今天打卡", exact: true }).click();
  await habit.getByLabel("更多事项操作").click();
  await habit.getByRole("button", { name: "删除事项", exact: true }).click();
  await page.getByLabel("结果范围").selectOption("trash");
  await habit
    .getByRole("button", { name: "查看 每天阅读", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "事项详情" })
    .getByRole("button", { name: "恢复事项", exact: true })
    .click();
  await page.getByLabel("结果范围").selectOption("active");
  await task
    .getByRole("button", { name: "查看 提交报告", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "事项详情" });
  assert.equal(await page.getByText(/处待确认/).count(), 0);
  await detail.getByLabel("预览 资料原件.txt", { exact: true }).waitFor();
  await detail
    .getByRole("textbox", { name: "补充信息", exact: true })
    .fill("已和同学核对，补充实验数据后提交。");
  await detail.getByRole("button", { name: "保存补充", exact: true }).click();
  await waitForPageState(
    page,
    async () =>
      (await window.desktop.store("packets"))[0].itemState.i1.additions
        ?.length === 1,
  );
  await detail.getByText("就地修改", { exact: true }).click();
  await detail.getByLabel("标题", { exact: true }).fill("人工确认后的标题");
  await detail.getByLabel("课程 / 项目", { exact: true }).fill("高等数学");
  await detail.getByRole("button", { name: "保存修改", exact: true }).click();
  await waitForPageState(
    page,
    async () =>
      (await window.desktop.store("packets"))[0].result.items[0].title ===
      "人工确认后的标题",
  );
  await page.reload();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const stored = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(stored[0].result.items[0].title, "人工确认后的标题");
  assert.equal(stored[0].itemState.i1.group, "高等数学");
  assert.equal(stored[0].itemState.i1.starred, true);
  assert.equal(
    stored[0].itemState.i1.additions[0].text,
    "已和同学核对，补充实验数据后提交。",
  );
  assert.equal(stored[0].itemState.i2.checkins.length, 1);
  const edited = page.locator(".result-card").filter({
    has: page.getByRole("heading", { name: "人工确认后的标题", exact: true }),
  });
  await edited
    .getByRole("button", { name: "查看 人工确认后的标题", exact: true })
    .click();
  await edited
    .getByRole("button", { name: "采纳为行动", exact: true })
    .evaluate((button) => {
      for (let i = 0; i < 5; i++) button.click();
    });
  await page.getByRole("button", { name: "已采纳 ✓", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "已采纳 ✓", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByText("已加入任务卡片", { exact: true }).waitFor();
  await waitForPageState(page, async () => {
    const [p] = await window.desktop.store("packets");
    return p.result.items.length === 4;
  });
  const adopted = await page.evaluate(() => window.desktop.store("packets"));
  assert.ok(
    Object.values(adopted[0].itemState).some(
      (m) => m.origin === "i1:suggestion:0",
    ),
  );
  assert.equal(Object.values(adopted[0].itemState).filter(m => m.origin === "i1:suggestion:0").length, 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("dialog", { name: "事项详情" })
    .getByLabel("更多材料操作 资料原件.txt", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "删除原件 资料原件.txt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "恢复附件 资料原件.txt", exact: true })
    .click();
  await waitForPageState(
    page,
    async () =>
      !(await window.desktop.store("packets"))[0].attachments[0].deletedAt,
  );
  await page.getByRole("button", { name: "关闭事项详情", exact: true }).click();
  const restoredAttachment = await page.evaluate(() =>
    window.desktop.store("packets"),
  );
  assert.equal(restoredAttachment[0].attachments[0].deletedAt, undefined);
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.desktop.store("packets"))[0].attachments[0].bytes
          .byteLength,
    ),
    3,
  );
  await page.getByLabel("结果范围").selectOption("active");
  assert.equal(await page.getByText("未分组", { exact: true }).count(), 0);
  assert.equal(
    await page.getByText("原始附件（独立管理）", { exact: true }).count(),
    0,
  );
  await edited.getByLabel("更多事项操作").click();
  await edited.getByRole("button", { name: "置顶", exact: true }).click();
  await waitForPageState(
    page,
    async () =>
      (await window.desktop.store("packets"))[0].itemState.i1.pinned === true,
  );
  await edited.getByLabel("更多事项操作").click();
  await page.getByRole("button", { name: "按分组查看", exact: true }).click();
  assert.equal(await page.locator(".result-group > details").count(), 0);
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await page.getByRole("button", { name: "关闭提示", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "release/desktop-results.png" });
  await edited
    .getByRole("button", { name: "查看 人工确认后的标题", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "一起放进来的", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("button", { name: "已采纳 ✓", exact: true }).isDisabled(), true);
  await page.screenshot({ path: "release/desktop-detail.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "事项详情" }).count(), 0);
  console.log(
    "PASS: Windows key encryption, seven-category workspace, per-item status, star, habit undo/deletion/restoration, edit/group persistence",
  );
} finally {
  await app.close();
}
