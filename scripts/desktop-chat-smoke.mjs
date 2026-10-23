import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, copyFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { DesktopStore } from "../desktop/storage.cjs";
const live = process.argv.includes("--live");
const profile = await mkdtemp(path.join(tmpdir(), "shixu-chat-test-"));
if (live)
  for (const name of ["Local State", "api-key.enc"])
    await copyFile(
      path.join(process.env.APPDATA, "ShixuDesktop", name),
      path.join(profile, name),
    );
const source =
  "虚构课程通知：下周一和周二暂停课程，请相互转告。这是功能测试样本。";
const item = {
  kind: "task",
  title: "转告同学课程调整",
  summary: "下周一、周二停课，请相互转告。",
  facts: ["下周一和周二停课"],
  due: null,
  nextSteps: [],
  uncertainties: [],
  sourceIds: ["input"],
  evidence: [{ sourceId: "input", quote: source }],
};
const now = new Date().toISOString();
await new DesktopStore(path.join(profile, "workspace")).call("savePackets", [
  {
    id: "chat-p",
    text: source,
    sources: [{ id: "input", name: "输入原文", text: source }],
    attachments: [],
    capturedAt: now,
    captureDate: "2026-10-23",
    updatedAt: now,
    status: "ready",
    result: { summary: "测试", items: [item], warnings: [] },
    error: "",
    doneIds: [],
    itemIds: ["chat-i"],
  },
]);
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  let calls = 0,
    mode = "normal";
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (!live) {
    await page.evaluate(() => window.desktop.key("save", "dummy-chat-key"));
    await page.route(
      "https://api.deepseek.com/chat/completions",
      async (route) => {
        calls++;
        const input = JSON.parse(
          route.request().postDataJSON().messages[1].content,
        );
        const patch =
          mode === "invalid"
            ? { delete: true }
            : input.instruction.includes("不是任务")
              ? { kind: "notice", group: "人工智能" }
              : { title: "课程调课通知", starred: true };
        await route.fulfill({
          json: {
            model: "deepseek-flash",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    reply: "已按你的要求修改卡片。",
                    patch,
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 30,
              completion_tokens: 20,
              total_tokens: 50,
            },
          },
        });
      },
    );
    await page.reload();
  }
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const card = page.locator(".result-card").first();
  await card.getByLabel("更多事项操作").click();
  await card
    .getByRole("button", { name: "编辑内容与分组", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(detail.getByLabel("标题", { exact: true })).toBeVisible();
  await detail.getByLabel("课程 / 项目", { exact: true }).fill("课程资料");
  await detail
    .getByLabel("关键要求（每行一项）", { exact: true })
    .fill("下周一和周二停课\n保留通知原文");
  await detail.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    detail.getByRole("textbox", { name: "给 AI 的指令", exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("textbox", { name: "给 AI 的指令", exact: true })
    .fill("这应该是通知，不是任务，放到通知分区，并分到人工智能这个组。");
  await detail
    .getByRole("button", { name: "发送", exact: true })
    .evaluate((b) => {
      b.click();
      b.click();
    });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.desktop.store("packets")))[0].result
          .items[0].kind,
      { timeout: 100000 },
    )
    .toBe("notice");
  await expect(detail.locator(".chat-assistant")).toHaveCount(1);
  await detail
    .getByRole("textbox", { name: "给 AI 的指令", exact: true })
    .fill("再把标题改为课程调课通知，给它加上星标。");
  await detail.getByRole("button", { name: "发送", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.desktop.store("packets")))[0].result
          .items[0].title,
      { timeout: 100000 },
    )
    .toBe("课程调课通知");
  let [saved] = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(saved.itemState["chat-i"].group, "人工智能");
  assert.equal(saved.itemState["chat-i"].starred, true);
  assert.equal(saved.result.items.length, 1);
  assert.equal(saved.text, source);
  assert.deepEqual(saved.result.items[0].facts, [
    "下周一和周二停课",
    "保留通知原文",
  ]);
  assert.equal(saved.itemState["chat-i"].chat.length, 4);
  await detail.getByLabel("卡片操作", { exact: true }).click();
  await detail.getByRole("button", { name: "编辑内容", exact: true }).click();
  await expect(detail.getByLabel("标题", { exact: true })).toHaveValue(
    "课程调课通知",
  );
  await expect(detail.getByLabel("课程 / 项目", { exact: true })).toHaveValue(
    "人工智能",
  );
  await detail.getByLabel("卡片操作", { exact: true }).click();
  await detail.getByRole("button", { name: "查看详情", exact: true }).click();
  if (!live) {
    assert.equal(calls, 2);
    mode = "invalid";
    await detail
      .getByRole("textbox", { name: "给 AI 的指令", exact: true })
      .fill("保持分类");
    await detail.getByRole("button", { name: "发送", exact: true }).click();
    await expect(detail.getByRole("alert")).toBeVisible();
    [saved] = await page.evaluate(() => window.desktop.store("packets"));
    assert.equal(saved.result.items[0].kind, "notice");
    mode = "normal";
    await detail.getByRole("button", { name: "重试", exact: true }).click();
    await expect(detail.getByRole("alert")).toHaveCount(0);
    await expect(detail.locator(".chat-assistant")).toHaveCount(3);
  }
  await page.screenshot({ path: "release/desktop-chat.png" });
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 课程调课通知", exact: true })
    .click();
  await expect(page.locator(".chat-assistant")).toHaveCount(live ? 2 : 3);
  assert.deepEqual(errors, []);
  await writeFile(
    "release/" + (live ? "chat-live-validation" : "chat-validation") + ".json",
    JSON.stringify(
      {
        passed: true,
        live,
        multiTurn: true,
        manualEdit: true,
        classification: "notice",
        group: "人工智能",
        starred: true,
        sourcePreserved: true,
        historySurvivedReload: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: " +
      (live ? "REAL MODEL" : "mocked model") +
      " direct editor, task→notice, group, multi-turn title/star changes, no duplicate submits, persisted chat, original preserved" +
      (live ? "" : ", invalid action rejected and retry succeeds"),
  );
} finally {
  await app.close();
  if (live)
    for (const name of ["api-key.enc", "Local State"])
      await rm(path.join(profile, name), { force: true });
}
