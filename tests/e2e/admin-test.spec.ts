import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
async function models(p: Page) {
  await p.route("https://api.deepseek.com/models", (r) =>
    r.fulfill({ json: { data: [{ id: "deepseek-flash" }] } }),
  );
  await p.route("https://api.deepseek.com/chat/completions", (r) => {
    const body = r.request().postDataJSON();
    const input = JSON.parse(body.messages[1].content);
    const value = input.instruction
      ? { reply: "已修改标题", patch: { title: "修改后的报告" } }
      : input.newItems
        ? { links: [] }
        : {
            summary: "合成验收",
            items: [
              {
                kind: "task",
                title: "提交测试报告",
                summary: "核对报告",
                facts: ["提交测试报告"],
                nextSteps: [],
                uncertainties: [],
                due: {
                  date: "2026-11-01",
                  time: "15:00",
                  sourceId: "input",
                  anchor: "2026年11月1日下午三点",
                },
                evidence: [{ sourceId: "input", quote: "提交测试报告" }],
              },
            ],
            warnings: [],
          };
    return r.fulfill({
      json: {
        model: body.model,
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(value) },
          },
        ],
      },
    });
  });
}
test("iPhone direct edition retains text, completion, chat, originals and merges private backups", async ({
  page,
  browser,
  baseURL,
}) => {
  await models(page);
  await page.goto("/admin-test/");
  await expect(page).toHaveTitle("拾序 · 管理员测试版");
  await expect(page.locator(".bucket-app > .admin-test-guide")).toHaveCount(0);
  await expect(page.getByLabel("往桶里放入内容")).toBeEnabled();
  await page.getByRole("button", { name: "连接与设置" }).click();
  await expect(
    page.getByText("使用说明与本机数据", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("DeepSeek API 密钥", { exact: true })
    .fill("fixture-secret-not-real");
  await page.getByLabel("在这台个人设备上记住密钥").check();
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page
    .getByLabel("往桶里放入内容")
    .fill("2026年11月1日下午三点提交测试报告");
  await page.locator("input[type=file]").setInputFiles({
    name: "合成附件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附件内容"),
  });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看 提交测试报告", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const scrollBody = page.locator(".results-workspace .card-open").first();
  expect(
    await scrollBody.evaluate(
      (el) => getComputedStyle(el.closest(".result-card")!).touchAction,
    ),
  ).toContain("pan-y");
  await scrollBody.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 101,
    button: 0,
    isPrimary: true,
    clientX: 150,
    clientY: 400,
  });
  await page.waitForTimeout(550);
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  await scrollBody.dispatchEvent("pointercancel", {
    pointerType: "touch",
    pointerId: 101,
  });
  await page
    .getByRole("button", { name: "查看 提交测试报告", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "事项详情" });
  await expect(
    detail.getByLabel("预览 合成附件.txt", { exact: true }),
  ).toContainText("附件内容");
  await detail.getByLabel("给 AI 的指令").fill("标题改成修改后的报告");
  await detail.getByRole("button", { name: "发送", exact: true }).click();
  await expect(detail.getByText("已修改标题", { exact: true })).toBeVisible();
  await detail.getByLabel("关闭事项详情").click();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "DDL 截止事项" }),
  ).toContainText("修改后的报告");
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "投递桶", exact: true }).click();
  await page.getByLabel("往桶里放入内容").fill("未投递的文字草稿");
  await expect(
    page.getByText("草稿已保存在此设备", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "连接与设置" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份全部本机资料" }).click();
  const download = await downloaded;
  const zip = await readFile((await download.path())!);
  const manifest = strFromU8(unzipSync(zip)["manifest.json"]);
  expect(manifest).not.toContain("fixture-secret-not-real");
  expect(manifest).toContain("未投递的文字草稿");
  // A separate browser/device starts empty; importing is explicit and add-only.
  const other = await browser.newContext();
  const q = await other.newPage();
  let calls = 0;
  await q.route("https://api.deepseek.com/**", (r) => {
    calls++;
    return r.abort();
  });
  await q.goto(baseURL + "/admin-test/");
  await expect(q.getByLabel("往桶里放入内容")).toHaveValue("");
  await q.getByRole("button", { name: "连接与设置" }).click();
  await q.getByLabel("选择管理员测试版备份").setInputFiles({
    name: "test.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await q.getByRole("button", { name: "确认合并恢复" }).click();
  await expect(q.getByLabel("往桶里放入内容")).toHaveValue("未投递的文字草稿");
  await q.getByRole("button", { name: "整理结果", exact: true }).click();
  await q.getByLabel("结果范围").selectOption("done");
  await expect(
    q.getByRole("button", { name: "查看 修改后的报告", exact: true }),
  ).toBeVisible();
  await q.getByRole("button", { name: "投递桶", exact: true }).click();
  await q.getByLabel("往桶里放入内容").fill("恢复后继续输入的新草稿");
  await expect(
    q.getByText("草稿已保存在此设备", { exact: true }),
  ).toBeVisible();
  await q.getByRole("button", { name: "连接与设置" }).click();
  await q.getByLabel("选择管理员测试版备份").setInputFiles({
    name: "again.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await q.getByRole("button", { name: "确认合并恢复" }).click();
  await expect(q.getByLabel("往桶里放入内容")).toHaveValue(
    "恢复后继续输入的新草稿",
  );
  await q.getByRole("button", { name: "整理结果", exact: true }).click();
  await q.getByLabel("结果范围").selectOption("done");
  await expect(
    q.locator(".results-workspace .result-card:visible"),
  ).toHaveCount(1);
  expect(calls).toBe(0);
  await other.close();
  // Close the actual tab and reopen in the same browser storage.
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(baseURL + "/admin-test/");
  await expect(reopened.getByLabel("往桶里放入内容")).toHaveValue(
    "未投递的文字草稿",
  );
  await reopened.goto(baseURL + "/");
  await expect(reopened.getByLabel("往桶里放入内容")).toHaveValue("");
  await reopened.goto(baseURL + "/admin-test/");
  expect(
    await reopened.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
