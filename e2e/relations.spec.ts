import {
  packets,
  world,
  records,
  closeRecords,
  finished,
  capture,
  deleteReceipt,
} from "./current-ui";
import { buildGroups } from "../shared/relations.mjs";
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

test("cross-day grouping, duplicate units, original previews, splitting and completion stay durable", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-21T10:00:00+08:00"));
  const { calls } = await setup(page);
  await capture(page, "做python第一课作业，2026年10月23日18:00前交", {
    name: "第一课.txt",
    text: "第一课提交 Python 源文件",
  });
  await finished(page, 1);
  await page.clock.setFixedTime(new Date("2026-10-22T10:00:00+08:00"));
  await capture(page, "做python第二课作业，2026年10月25日23:59前交", {
    name: "第二课.txt",
    text: "第二课附上运行截图",
  });
  await finished(page, 2);
  let ps = await packets(page),
    groups = buildGroups(ps);
  expect(groups).toHaveLength(1);
  expect(groups[0].units).toHaveLength(2);
  expect(groups[0].units.map((u: any) => u.item.due.date).sort()).toEqual([
    "2026-10-23",
    "2026-10-25",
  ]);
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
  await finished(page, 3);
  groups = buildGroups(await packets(page));
  expect(groups[0].units).toHaveLength(2);
  expect(
    groups[0].units.some(
      (u: any) =>
        u.refs.length === 2 && u.item.facts.includes("第一课增加一份说明文档"),
    ),
  ).toBe(true);
  await world(page);
  await page.getByRole("button", { name: "按分组查看", exact: true }).click();
  await expect(page.locator(".collection-heading")).toHaveCount(1);
  const original = page
    .locator(".result-card:visible")
    .filter({
      has: page.getByRole("button", {
        name: "查看 做 Python 第一课作业",
        exact: true,
      }),
    })
    .first();
  await original.locator(".card-source-link").click();
  const d = page.getByRole("dialog", { name: "同行材料", exact: true });
  await expect(d.getByLabel("预览 第一课.txt", { exact: true })).toContainText(
    "第一课提交 Python 源文件",
  );
  await d.getByLabel("关闭同行材料", { exact: true }).click();
  await expect(d).toHaveCount(0);
  await page.getByRole("button", { name: "拆开此分组", exact: true }).click();
  await expect(page.locator(".collection-heading")).toHaveCount(0);
  expect(buildGroups(await packets(page))).toHaveLength(0);
  await expect(page.locator(".result-card:visible")).toHaveCount(3);
  await original.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".result-card:visible")).toHaveCount(2);
  await page.reload();
  await world(page);
  await page.getByLabel("结果范围").selectOption("done");
  await expect(page.locator(".result-card:visible")).toHaveCount(1);
  expect(buildGroups(await packets(page))).toHaveLength(0);
  expect(JSON.stringify(calls)).not.toContain(KEY);
});
test("completed work and unrelated courses are excluded from new associations", async ({
  page,
}) => {
  const { calls } = await setup(page);
  await capture(page, "做python第一课作业");
  await finished(page, 1);
  await page
    .getByLabel("这次投喂", { exact: true })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await expect
    .poll(async () => (await packets(page))[0].doneIds.length)
    .toBe(1);
  await capture(page, "做python第二课作业");
  await finished(page, 2);
  expect(calls.filter((c) => c.kind === "relation")).toHaveLength(0);
  await capture(page, "做数学第一课作业");
  await finished(page, 3);
  const ps = await packets(page);
  expect(buildGroups(ps)).toHaveLength(0);
  expect(ps.reduce((n: number, p: any) => n + p.doneIds.length, 0)).toBe(1);
  await world(page);
  await expect(page.locator(".result-card:visible")).toHaveCount(2);
});
test("association retry preserves extraction, and deleting a referenced delivery removes stale links", async ({
  page,
}) => {
  const { calls, control } = await setup(page);
  await capture(page, "做python第一课作业");
  await finished(page, 1);
  control.invalid = true;
  await capture(page, "做python第二课作业");
  await finished(page, 2);
  expect(
    (await packets(page)).some((p: any) => p.association?.state === "error"),
  ).toBe(true);
  expect(buildGroups(await packets(page))).toHaveLength(0);
  control.invalid = false;
  const d = await records(page);
  await expect(d).toContainText("跨次关联尚未完成");
  await d.getByRole("button", { name: "仅重试关联", exact: true }).click();
  await expect
    .poll(async () => buildGroups(await packets(page)).length)
    .toBe(1);
  await closeRecords(page);
  expect(calls.filter((c) => c.kind === "organize")).toHaveLength(2);
  expect(calls.filter((c) => c.kind === "relation")).toHaveLength(2);
  await deleteReceipt(page, 1);
  await page.reload();
  const ps = await packets(page);
  expect(ps.filter((p: any) => !p.deletedAt)).toHaveLength(1);
  expect(buildGroups(ps)).toHaveLength(0);
  await world(page);
  await expect(page.locator(".result-card:visible")).toHaveCount(1);
  await expect(page.locator(".result-card:visible")).toContainText("第二课");
});
