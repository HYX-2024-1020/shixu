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

test("one input plus file becomes organized items without any classification form", async ({
  page,
}, info) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.goto("/");
  await connect(page);
  await page.getByLabel("往桶里放入内容").fill(INPUT);
  await page.locator("input[type=file]").setInputFiles({
    name: "课程要求.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(FILE),
  });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(page.locator(".bucket-item")).toHaveCount(3);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("不少于 2000 字", { exact: true })).toBeVisible();
  await expect(page.locator(".item-file-pill")).toContainText("课程要求.txt");
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].messages[1].content).sources).toHaveLength(2);
  expect(JSON.stringify(requests)).not.toContain(KEY);
  expect(await page.locator("body").innerText()).not.toContain(KEY);
  expect(await page.getByLabel("往桶里放入内容").inputValue()).toBe("");
  await page.reload();
  await expect(page.locator(".bucket-item")).toHaveCount(3);
  await page.getByRole("button", { name: "完成：提交课程报告" }).click();
  await expect(page.locator(".bucket-item").first()).toHaveClass(/item-done/);
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
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份桶里的内容" }).click();
  const download = await downloadPromise,
    path = await download.path();
  const zip = unzipSync(await readFile(path!));
  const manifest = strFromU8(zip["manifest.json"]);
  expect(manifest).not.toContain(KEY);
  expect(manifest).toContain("课程要求.txt");
  expect(
    Object.keys(zip).filter((key) => key.startsWith("files/")),
  ).toHaveLength(1);
});

test("model choice reaches requests and cumulative costs persist after deleting a packet", async ({
  page,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.route("https://api.deepseek.com/user/balance", (route) =>
    route.fulfill({
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
  await expect(page.getByLabel("整理模型", { exact: true })).toBeEnabled();
  await page
    .getByLabel("整理模型", { exact: true })
    .selectOption("deepseek-v4-pro");
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await page.getByLabel("往桶里放入内容").fill("明天交第一份报告");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(page.locator(".packet-ready")).toHaveCount(1);
  expect(requests[0].model).toBe("deepseek-v4-pro");
  await expect(page.locator(".packet-cost")).toContainText(
    "¥0.004980–0.009960",
  );
  await page.getByRole("button", { name: "选择模型与查看费用" }).click();
  await expect(page.getByLabel("整理模型", { exact: true })).toBeEnabled();
  await page
    .getByLabel("整理模型", { exact: true })
    .selectOption("deepseek-flash");
  await page.getByRole("button", { name: "刷新余额", exact: true }).click();
  await expect(page.locator(".usage-balance")).toContainText("CNY 98.12");
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await page.getByLabel("往桶里放入内容").fill("明天交第二份报告");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(page.locator(".packet-ready")).toHaveCount(2);
  expect(requests[1].model).toBe("deepseek-flash");
  await page.getByRole("button", { name: "原文与附件" }).first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除这一包" }).click();
  await expect(page.locator(".bucket-packet")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "选择模型与查看费用" }).click();
  await expect(page.locator(".usage-tokens")).toContainText("2 次调用");
  await expect(page.locator(".usage-amount")).toContainText(
    "¥0.006184 – 0.012368",
  );
  await expect(page.getByLabel("整理模型", { exact: true })).toHaveValue(
    "deepseek-flash",
  );
  await expect(page.locator(".bucket-usage")).toContainText("历史消耗无法补齐");
});

test("offline or unconfigured input is kept and starts automatically after connection", async ({
  page,
  context,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.goto("/");
  await page.getByLabel("往桶里放入内容").fill("明天交报告");
  await context.setOffline(true);
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await expect(page.locator(".packet-pending")).toBeVisible();
  await expect(page.locator(".bucket-item")).toHaveCount(0);
  expect(requests).toHaveLength(0);
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator(".packet-pending")).toBeVisible();
  await connect(page);
  await expect(page.locator(".packet-ready")).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "原文与附件" }).click();
  await expect(page.locator(".packet-source")).toContainText("明天交报告");
});

test("an unreadable attachment fails visibly and its original file remains downloadable", async ({
  page,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  await page.goto("/");
  await connect(page);
  await page.getByLabel("往桶里放入内容").fill("老师的要求在这个文件里");
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("not-a-zip"),
  });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(page.locator(".packet-error")).toContainText("broken.docx");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "原文与附件" }).click();
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "broken.docx", exact: true }).click();
  const download = await promise;
  expect((await readFile((await download.path())!)).toString()).toBe(
    "not-a-zip",
  );
});

test("the example is clearly labeled and separated from the personal bucket", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("往桶里放入内容").fill("只属于我的私人记录");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.goto("/?preview=bucket");
  await expect(page.locator(".bucket-demo-note")).toBeVisible();
  await expect(page.locator(".bucket-item")).toHaveCount(3);
  await expect(page.locator(".packet-note")).toContainText("未调用模型");
  await expect(page.locator("body")).not.toContainText("只属于我的私人记录");
  await page.getByRole("link", { name: "回到我的桶" }).click();
  await expect(page.locator(".packet-pending")).toHaveCount(1);
  await page.getByRole("button", { name: "原文与附件" }).click();
  await expect(page.locator(".packet-source")).toContainText(
    "只属于我的私人记录",
  );
});

test("deleting an in-flight packet does not resurrect it when the model responds", async ({
  page,
}) => {
  const requests: any[] = [];
  await modelRoutes(page, requests);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route(
    "https://api.deepseek.com/chat/completions",
    async (route) => {
      if (first) {
        first = false;
        await gate;
      }
      await route.fallback();
    },
  );
  await page.goto("/");
  await connect(page);
  await page.getByLabel("往桶里放入内容").fill("删除这条尚未整理完的记录");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(page.locator(".packet-processing")).toBeVisible();
  await page.getByRole("button", { name: "原文与附件" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除这一包" }).click();
  await expect(page.locator(".bucket-packet")).toHaveCount(0);
  await page.getByLabel("往桶里放入内容").fill("这条第二次投递要保留");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  release();
  await expect(page.locator(".packet-ready")).toHaveCount(1);
  await expect.poll(() => requests.length).toBe(2);
  await page.reload();
  await expect(page.locator(".bucket-packet")).toHaveCount(1);
  await page.getByRole("button", { name: "原文与附件" }).click();
  await expect(page.locator(".packet-source")).toContainText(
    "这条第二次投递要保留",
  );
});
