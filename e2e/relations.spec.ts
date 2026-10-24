import {
  capture,
  waitReady,
  snapshot,
  openResults,
  openRecords,
  closeDialog,
  deleteReceipt,
} from "./helpers";
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

test("across-day grouping preserves dates, duplicate evidence, files and completion when split", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-21T10:00:00+08:00"));
  const { calls } = await setup(page);
  await capture(page, "做python第一课作业，2026年10月23日18:00前交", {
    name: "第一课.txt",
    text: "第一课提交 Python 源文件",
  });
  await waitReady(page, 1);
  await page.clock.setFixedTime(new Date("2026-10-22T10:00:00+08:00"));
  await capture(page, "做python第二课作业，2026年10月25日23:59前交", {
    name: "第二课.txt",
    text: "第二课附上运行截图",
  });
  await waitReady(page, 2);
  await expect.poll(async () => (await snapshot(page)).groups.length).toBe(1);
  const packets = (await snapshot(page)).packets;
  expect(
    packets.find((p: any) => p.text.includes("第一课"))?.result.items[0].due
      .date,
  ).toBe("2026-10-23");
  expect(
    packets.find((p: any) => p.text.includes("第二课"))?.result.items[0].due
      .date,
  ).toBe("2026-10-25");
  expect(
    calls
      .filter((c) => c.kind === "organize")
      .map((c) => c.payload.captureDate),
  ).toEqual(["2026-10-21", "2026-10-22"]);
  await capture(page, "做python第一课作业，补充要求见附件", {
    name: "补充.txt",
    text: "第一课增加一份说明文档",
  });
  await waitReady(page, 3);
  expect((await snapshot(page)).groups[0].units).toHaveLength(2);
  await openResults(page);
  await page.getByRole("button", { name: "按分组查看", exact: true }).click();
  await expect(page.locator(".collection-heading")).toHaveCount(1);
  const first = page
    .locator(".result-card")
    .filter({
      has: page.getByRole("button", {
        name: "查看 做 Python 第一课作业",
        exact: true,
      }),
    })
    .first();
  await first.getByRole("button", { name: /同行材料/ }).click();
  const materials = page.getByRole("dialog", { name: "同行材料" });
  await expect(
    materials.getByRole("button", { name: "第一课.txt", exact: true }),
  ).toBeVisible();
  await materials.getByLabel("更多材料操作 第一课.txt").click();
  const promise = page.waitForEvent("download");
  await materials
    .getByRole("link", { name: "保存 第一课.txt", exact: true })
    .click();
  expect((await readFile((await (await promise).path())!)).toString()).toBe(
    "第一课提交 Python 源文件",
  );
  await closeDialog(page);
  await first.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByLabel("结果范围", { exact: true }).selectOption("done");
  await expect(page.locator(".result-card.is-done")).toHaveCount(1);
  await page.reload();
  await openResults(page);
  await page.getByLabel("结果范围", { exact: true }).selectOption("done");
  await expect(page.locator(".result-card.is-done")).toHaveCount(1);
  await page.getByLabel("结果范围", { exact: true }).selectOption("active");
  await page.getByRole("button", { name: "按分组查看", exact: true }).click();
  await page.getByRole("button", { name: "拆开此分组", exact: true }).click();
  await expect(page.locator(".collection-heading")).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.packets).toHaveLength(3);
  expect(after.packets.flatMap((p: any) => p.attachments)).toHaveLength(3);
  expect(after.packets.flatMap((p: any) => p.doneIds)).toHaveLength(1);
  expect(JSON.stringify(after.packets)).toContain("第一课增加一份说明文档");
});

test("completed work and unrelated courses do not become association targets", async ({
  page,
}) => {
  const { calls } = await setup(page);
  await capture(page, "做python第一课作业");
  await waitReady(page, 1);
  await openResults(page);
  await page
    .locator(".result-card")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await expect(page.locator(".result-card")).toHaveCount(0);
  await capture(page, "做python第二课作业");
  await waitReady(page, 2);
  expect(calls.filter((c) => c.kind === "relation")).toHaveLength(0);
  await capture(page, "做数学第一课作业");
  await waitReady(page, 3);
  expect((await snapshot(page)).groups).toHaveLength(0);
  await openResults(page);
  await expect(page.locator(".result-card")).toHaveCount(2);
  await page.getByLabel("结果范围", { exact: true }).selectOption("done");
  await expect(page.locator(".result-card.is-done")).toHaveCount(1);
});

test("association retries preserve extraction and deleted targets stay removed", async ({
  page,
}) => {
  const { calls, control } = await setup(page);
  await capture(page, "做python第一课作业");
  await waitReady(page, 1);
  control.invalid = true;
  await capture(page, "做python第二课作业");
  await expect
    .poll(
      async () =>
        (await snapshot(page)).packets.filter(
          (p: any) => p.association?.state === "error",
        ).length,
    )
    .toBe(1);
  const records = await openRecords(page);
  await expect(records).toContainText("关联依据不可靠");
  control.invalid = false;
  await records
    .getByRole("button", { name: "仅重试关联", exact: true })
    .click();
  await waitReady(page, 2);
  expect((await snapshot(page)).groups).toHaveLength(1);
  expect(calls.filter((c) => c.kind === "organize")).toHaveLength(2);
  expect(calls.filter((c) => c.kind === "relation")).toHaveLength(2);
  await closeDialog(page);
  await deleteReceipt(page, "做python第一课作业");
  await page.reload();
  expect((await snapshot(page)).groups).toHaveLength(0);
  const visible = (await snapshot(page)).packets.filter(
    (p: any) => !p.deletedAt,
  );
  expect(visible).toHaveLength(1);
  expect(visible[0].text).toBe("做python第二课作业");
  await openResults(page);
  await expect(page.locator(".result-card")).toHaveCount(1);
});
