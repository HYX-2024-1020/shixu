import {
  packets,
  world,
  records,
  closeRecords,
  finished,
  capture,
  deleteReceipt,
} from "./current-ui";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
const KEY = "fixture-deepseek-key-not-real";
const INPUT =
  "明天下午三点前交报告，要求看附件。\n灵感：旧书地图。\n每天睡前读书十分钟。";
const FILE = "提交 PDF 报告，不少于 2000 字，附上访谈记录。";
async function modelRoutes(page: Page, requests: any[]) {
  await page.route("https://api.deepseek.com/models", (route) =>
    route.fulfill({
      json: { data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] },
    }),
  );
  await page.route(
    "https://api.deepseek.com/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (JSON.parse(body.messages[1].content).newItems) {
        await route.fulfill({
          json: {
            model: body.model,
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 100,
              prompt_cache_hit_tokens: 200,
              prompt_cache_miss_tokens: 800,
            },
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify({ links: [] }) },
              },
            ],
          },
        });
        return;
      }
      const input = JSON.parse(body.messages[1].content),
        sources = input.sources as { id: string; name: string; text: string }[],
        text = sources.find((s) => s.id === "input")!,
        file = sources.find((s) => s.id !== "input");
      const evidence = [
        {
          sourceId: "input",
          quote: text.text.includes("明天下午三点前")
            ? "明天下午三点前交报告"
            : text.text,
        },
      ];
      if (file) evidence.push({ sourceId: file.id, quote: file.text });
      const items: any[] = [
        {
          kind: "task",
          title: "提交课程报告",
          summary: "已把通知与附件要求放在一起。",
          facts: file
            ? ["提交 PDF 报告", "不少于 2000 字", "附上访谈记录"]
            : ["完成并提交报告"],
          nextSteps: ["先列出报告提纲"],
          uncertainties: [],
          due: text.text.includes("明天下午三点前")
            ? {
                date: "2026-10-23",
                time: "15:00",
                sourceId: "input",
                anchor: "明天下午三点前",
              }
            : null,
          evidence,
        },
      ];
      if (text.text.includes("旧书地图"))
        items.push({
          kind: "idea",
          title: "做一个旧书地图",
          summary: "让同学更容易找到愿意流转的旧书。",
          facts: [],
          nextSteps: ["先找三位同学了解需求，再画一张最简单的地图。"],
          uncertainties: [],
          due: null,
          evidence: [{ sourceId: "input", quote: "灵感：旧书地图" }],
        });
      if (text.text.includes("每天睡前"))
        items.push({
          kind: "habit",
          title: "睡前读书十分钟",
          summary: "把阅读放进睡前这段固定时间。",
          facts: ["每天睡前读十分钟"],
          nextSteps: ["可以先把书放在枕边。"],
          uncertainties: [],
          due: null,
          evidence: [{ sourceId: "input", quote: "每天睡前读书十分钟" }],
        });
      await route.fulfill({
        json: {
          model: body.model,
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 100,
            prompt_cache_hit_tokens: 200,
            prompt_cache_miss_tokens: 800,
          },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  summary: "已收好这次投递，文件和事项保留关联。",
                  items,
                  warnings: [],
                }),
              },
            },
          ],
        },
      });
    },
  );
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "连接与设置" }).click();
  await page.getByLabel("DeepSeek API 密钥", { exact: true }).fill(KEY);
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("mixed capture produces editable cards, original previews, durable completion and a private backup", async ({
  page,
}, info) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.goto("/");
  await connect(page);
  await capture(page, INPUT, { name: "课程要求.txt", text: FILE });
  await finished(page, 1);
  const current = page.getByLabel("这次投喂", { exact: true });
  await expect(current.locator(".result-card")).toHaveCount(3);
  await current
    .getByRole("button", { name: "查看 提交课程报告", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(
    detail.getByText("不少于 2000 字", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByLabel("预览 课程要求.txt", { exact: true }),
  ).toContainText(FILE);
  await detail.getByLabel("关闭事项详情", { exact: true }).click();
  await expect(detail).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].messages[1].content).sources).toHaveLength(2);
  expect(JSON.stringify(requests)).not.toContain(KEY);
  expect(await page.locator("body").innerText()).not.toContain(KEY);
  expect(await page.getByLabel("往桶里放入内容").inputValue()).toBe("");
  await page.reload();
  await expect(current).toHaveCount(0);
  await world(page);
  const cards = page.locator(".results-workspace .result-card:visible");
  await expect(cards).toHaveCount(3);
  await cards
    .filter({
      has: page.getByRole("button", { name: "查看 提交课程报告", exact: true }),
    })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await expect(cards).toHaveCount(2);
  await page.getByLabel("结果范围").selectOption("done");
  await expect(cards).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${info.project.name}-bucket.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "连接与设置" }).click();
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份桶里的内容" }).click();
  const download = await promise;
  const zip = unzipSync(await readFile((await download.path())!));
  const manifest = strFromU8(zip["manifest.json"]);
  expect(manifest).not.toContain(KEY);
  expect(manifest).toContain("课程要求.txt");
  expect(
    Object.keys(zip).filter((key) => key.startsWith("files/")),
  ).toHaveLength(1);
});
test("model selection, balance and cumulative usage survive whole-delivery deletion", async ({
  page,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.route("https://api.deepseek.com/user/balance", (r) =>
    r.fulfill({
      json: {
        is_available: true,
        balance_infos: [
          {
            currency: "CNY",
            total_balance: "98.12",
            granted_balance: "0",
            topped_up_balance: "98.12",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "连接与设置" }).click();
  await page.getByLabel("DeepSeek API 密钥", { exact: true }).fill(KEY);
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await page
    .getByLabel("整理模型", { exact: true })
    .selectOption("deepseek-v4-pro");
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await capture(page, "明天交第一份报告");
  await finished(page, 1);
  expect(requests[0].model).toBe("deepseek-v4-pro");
  await page.getByRole("button", { name: "连接与设置" }).click();
  await expect(page.locator(".usage-amount")).toContainText("0.004980");
  await page
    .getByLabel("整理模型", { exact: true })
    .selectOption("deepseek-flash");
  await page.getByRole("button", { name: "刷新余额", exact: true }).click();
  await expect(page.locator(".usage-balance")).toContainText("CNY 98.12");
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await capture(page, "明天交第二份报告");
  await finished(page, 2);
  expect(requests[1].model).toBe("deepseek-flash");
  await deleteReceipt(page);
  await expect
    .poll(
      async () => (await packets(page)).filter((p: any) => !p.deletedAt).length,
    )
    .toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "连接与设置" }).click();
  await expect(page.locator(".usage-tokens")).toContainText("3 次调用");
  await expect(page.locator(".usage-amount")).toContainText("0.007388");
  await expect(page.getByLabel("整理模型", { exact: true })).toHaveValue(
    "deepseek-flash",
  );
  await expect(page.locator(".bucket-usage")).toContainText("历史消耗无法补齐");
});
test("offline and unconfigured input is durable and starts after connection", async ({
  page,
  context,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.goto("/");
  await page.getByLabel("往桶里放入内容").waitFor();
  await context.setOffline(true);
  await capture(page, "明天交报告");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.getByLabel("这次投喂", { exact: true })).toContainText(
    "已收好",
  );
  expect(requests).toHaveLength(0);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel("这次投喂", { exact: true })).toHaveCount(0);
  await expect
    .poll(async () => (await packets(page))[0]?.status)
    .toBe("pending");
  await connect(page);
  await finished(page, 1);
  expect(requests).toHaveLength(1);
  await world(page);
  await page
    .getByRole("button", { name: "查看 提交课程报告", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "事项详情", exact: true }),
  ).toContainText("明天交报告");
});
test("unreadable files are reported without losing readable input or original bytes", async ({
  page,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.goto("/");
  await connect(page);
  await page.getByLabel("往桶里放入内容").fill("老师的要求在这个文件里");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "broken.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("not-a-zip"),
    });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await finished(page, 1);
  const [stored] = await packets(page);
  expect(
    stored.coverage.some(
      (c: any) => c.name === "broken.docx" && c.state === "failed",
    ),
  ).toBe(true);
  expect(requests).toHaveLength(1);
  const d = await records(page);
  await expect(d).toContainText("有未读内容");
  const r = d.locator(".delivery-receipt");
  await r.getByText("原文、遗漏与操作", { exact: true }).click();
  await r.getByLabel("更多材料操作 broken.docx", { exact: true }).click();
  const promise = page.waitForEvent("download");
  await r.getByRole("link", { name: "保存 broken.docx", exact: true }).click();
  expect((await readFile((await (await promise).path())!)).toString()).toBe(
    "not-a-zip",
  );
});
test("demo data is isolated from personal pending deliveries", async ({
  page,
}) => {
  await page.goto("/");
  await capture(page, "只属于我的私人记录");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.goto("/?preview=bucket");
  await expect(page.locator(".bucket-demo-note")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("只属于我的私人记录");
  await world(page);
  await expect(page.locator(".result-card:visible")).toHaveCount(3);
  await page.getByRole("button", { name: "投递桶", exact: true }).click();
  await page.getByRole("link", { name: "回到我的桶" }).click();
  const d = await records(page);
  await expect(d.locator(".delivery-receipt")).toHaveCount(1);
  await d.getByText("原文、遗漏与操作", { exact: true }).click();
  await expect(d).toContainText("只属于我的私人记录");
});
test("deleting an in-flight delivery does not resurrect it after its model response", async ({
  page,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let first = true;
  await page.route("https://api.deepseek.com/chat/completions", async (r) => {
    if (first) {
      first = false;
      await gate;
    }
    await r.fallback();
  });
  await page.goto("/");
  await connect(page);
  await capture(page, "删除这条尚未整理完的记录");
  await expect
    .poll(async () => (await packets(page))[0]?.status)
    .toBe("processing");
  await deleteReceipt(page);
  await capture(page, "这条第二次投递要保留");
  release();
  await finished(page, 1);
  await expect.poll(() => requests.length).toBe(2);
  await page.reload();
  const active = (await packets(page)).filter((p: any) => !p.deletedAt);
  expect(active).toHaveLength(1);
  expect(active[0].text).toBe("这条第二次投递要保留");
  await world(page);
  await page
    .getByRole("button", { name: "查看 提交课程报告", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "事项详情", exact: true }),
  ).toContainText("这条第二次投递要保留");
});
