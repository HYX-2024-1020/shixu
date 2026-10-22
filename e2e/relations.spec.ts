import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const KEY = "fixture-relations-key-not-real";
async function setup(page: Page) {
  const calls: { kind: string; payload: any }[] = [],
    control = { invalid: false };
  await page.route("https://api.deepseek.com/models", (r) =>
    r.fulfill({ json: { data: [{ id: "deepseek-flash" }] } }),
  );
  await page.route(
    "https://api.deepseek.com/chat/completions",
    async (route) => {
      const request = route.request().postDataJSON(),
        body = JSON.parse(request.messages[1].content);
      let result;
      if (body.newItems) {
        calls.push({ kind: "relation", payload: body });
        const fresh = body.newItems[0],
          isPython = fresh.title.includes("Python"),
          lesson = fresh.title.includes("第一课") ? "第一课" : "第二课";
        const same = body.openItems.find(
          (o: any) => o.title.includes("Python") && o.title.includes(lesson),
        );
        const other = body.openItems.find((o: any) =>
          o.title.includes("Python"),
        );
        const target = same || (!fresh.title.includes("第一课") ? other : null);
        result = {
          links:
            isPython && target
              ? [
                  {
                    from: fresh.ref,
                    target: control.invalid ? "invented#0" : target.ref,
                    relation: same ? "same" : "related",
                    title:
                      same && !target.group
                        ? "Python第一课作业"
                        : "Python第一、二课作业",
                    confidence: 0.99,
                    newEvidence: fresh.evidence[0],
                    oldEvidence: target.evidence[0],
                  },
                ]
              : [],
        };
      } else {
        calls.push({ kind: "organize", payload: body });
        const input = body.sources.find((s: any) => s.id === "input"),
          file = body.sources.find((s: any) => s.id !== "input");
        const text = input.text,
          isPython = /python/i.test(text),
          lesson = text.includes("第一课") ? "第一课" : "第二课";
        const anchor = text.match(/2026年10月\d{2}日\d{2}:\d{2}/)?.[0];
        result = {
          summary: "已保存这次作业要求",
          items: [
            {
              kind: "task",
              title: isPython ? `做 Python ${lesson}作业` : "做数学第一课作业",
              summary: text,
              facts: file ? [file.text] : [],
              nextSteps: [],
              uncertainties: [],
              due: anchor
                ? {
                    date: "2026-10-23",
                    time: "18:00",
                    anchor,
                    sourceId: "input",
                  }
                : null,
              evidence: [
                { sourceId: "input", quote: text },
                ...(file ? [{ sourceId: file.id, quote: file.text }] : []),
              ],
            },
          ],
          warnings: [],
        };
      }
      await route.fulfill({
        json: {
          model: request.model,
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 100,
            prompt_cache_hit_tokens: 200,
            prompt_cache_miss_tokens: 800,
          },
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(result) },
            },
          ],
        },
      });
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "连接与设置" }).click();
  await page.getByLabel("DeepSeek API 密钥", { exact: true }).fill(KEY);
  await page
    .getByRole("checkbox", { name: "在这台个人设备上记住密钥" })
    .check();
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  return { calls, control };
}
async function capture(
  page: Page,
  text: string,
  file?: { name: string; text: string },
) {
  await page.getByLabel("往桶里放入内容").fill(text);
  if (file)
    await page.locator("input[type=file]").setInputFiles({
      name: file.name,
      mimeType: "text/plain",
      buffer: Buffer.from(file.text),
    });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(page.locator(".packet-processing")).toHaveCount(0);
}
test("across-day lessons form one group; duplicate requirements, files and completion survive reload and splitting", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-21T10:00:00+08:00"));
  const { calls } = await setup(page);
  await capture(page, "做python第一课作业，2026年10月23日18:00前交", {
    name: "第一课.txt",
    text: "第一课提交 Python 源文件",
  });
  await expect(
    page.locator('.packet-ready[data-association-state="ready"]'),
  ).toHaveCount(1);
  await page.clock.setFixedTime(new Date("2026-10-22T10:00:00+08:00"));
  await capture(page, "做python第二课作业，2026年10月25日23:59前交", {
    name: "第二课.txt",
    text: "第二课附上运行截图",
  });
  const group = page.locator(".bucket-group");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".group-unit")).toHaveCount(2);
  await expect(group.locator("h3").first()).toHaveText("Python第一、二课作业");
  await expect(group.locator(".group-unit-due").first()).toContainText(
    "10月23日",
  );
  await expect(group.locator(".group-unit-due").last()).toContainText(
    "10月25日",
  );
  expect(
    calls.find((c) => c.kind === "relation")?.payload.openItems[0].title,
  ).toContain("第一课");
  expect(
    calls
      .filter((c) => c.kind === "organize")
      .map((c) => c.payload.captureDate),
  ).toEqual(["2026-10-21", "2026-10-22"]);
  await capture(page, "做python第一课作业，补充要求见附件", {
    name: "补充.txt",
    text: "第一课增加一份说明文档",
  });
  await expect(group.locator(".group-repeat")).toContainText("2 次补充");
  await expect(group.locator(".group-unit")).toHaveCount(2);
  await expect(group.locator(".group-unit").first()).toContainText(
    "第一课增加一份说明文档",
  );
  await group
    .getByRole("button", { name: "完成：做 Python 第一课作业", exact: true })
    .click();
  await expect(group.locator(".unit-done")).toHaveCount(1);
  await page.reload();
  await expect(group.locator(".unit-done")).toHaveCount(1);
  await group.locator(".group-details > summary").click();
  const original = group.locator(".bucket-packet").first();
  await original.getByRole("button", { name: "原文与附件" }).click();
  const promise = page.waitForEvent("download");
  await original
    .locator(".packet-source")
    .getByRole("button", { name: "第一课.txt", exact: true })
    .click();
  const file = await promise;
  expect((await readFile((await file.path())!)).toString()).toBe(
    "第一课提交 Python 源文件",
  );
  await group.getByRole("button", { name: "拆开这一组" }).click();
  await expect(group).toHaveCount(0);
  await expect(page.locator(".bucket-packet")).toHaveCount(3);
  await expect(page.locator(".item-done")).toHaveCount(2);
  await page.reload();
  await expect(group).toHaveCount(0);
  await expect(page.locator(".item-done")).toHaveCount(2);
  expect(JSON.stringify(calls)).not.toContain(KEY);
});
test("unrelated courses and completed work remain independent", async ({
  page,
}) => {
  const { calls } = await setup(page);
  await capture(page, "做python第一课作业");
  await expect(
    page.locator('.packet-ready[data-association-state="ready"]'),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "完成：做 Python 第一课作业" })
    .click();
  await capture(page, "做python第二课作业");
  await expect(
    page.locator('.packet-ready[data-association-state="ready"]'),
  ).toHaveCount(2);
  expect(calls.filter((c) => c.kind === "relation")).toHaveLength(0);
  await capture(page, "做数学第一课作业");
  await expect(
    page.locator('.packet-ready[data-association-state="ready"]'),
  ).toHaveCount(3);
  await expect(page.locator(".bucket-group")).toHaveCount(0);
  await expect(page.locator(".item-done")).toHaveCount(1);
});
test("failed associations keep the good extraction; retry only repeats association, and deletion removes its references", async ({
  page,
}) => {
  const { calls, control } = await setup(page);
  await capture(page, "做python第一课作业");
  await expect(
    page.locator('.packet-ready[data-association-state="ready"]'),
  ).toHaveCount(1);
  control.invalid = true;
  await capture(page, "做python第二课作业");
  await expect(page.locator(".association-warning")).toContainText(
    "关联依据不可靠",
  );
  await expect(page.locator(".packet-ready")).toHaveCount(2);
  await expect(page.locator(".bucket-group")).toHaveCount(0);
  control.invalid = false;
  await page.getByRole("button", { name: "仅重试关联" }).click();
  await expect(page.locator(".bucket-group")).toHaveCount(1);
  expect(calls.filter((c) => c.kind === "organize")).toHaveLength(2);
  expect(calls.filter((c) => c.kind === "relation")).toHaveLength(2);
  await page.locator(".group-details > summary").click();
  const first = page.locator(".bucket-group .bucket-packet").first();
  await first.getByRole("button", { name: "原文与附件" }).click();
  page.once("dialog", (d) => d.accept());
  await first.getByRole("button", { name: "删除这一包" }).click();
  await expect(page.locator(".bucket-group")).toHaveCount(0);
  await expect(page.locator(".packet-ready")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".packet-ready")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("做 Python 第一课作业");
});
