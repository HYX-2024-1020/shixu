import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(path.join(tmpdir(), "shixu-skins-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath: process.env.SHIXU_PACKAGED_EXE,
    args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
    env,
  });
let app;
const errors = [];
async function pageForApp() {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByLabel("往桶里放入内容", { exact: true }),
  ).toBeEnabled();
  return page;
}
try {
  await mkdir("release", { recursive: true });
  app = await launch();
  let page = await pageForApp();
  const version = await app.evaluate(({ app }) => app.getVersion());
  await page
    .getByLabel("往桶里放入内容", { exact: true })
    .fill("皮肤升级验证草稿，仅合成资料");
  await page.evaluate(() => window.flushDesktopDraft());
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await expect(page.locator(".skin-card")).toHaveCount(8);
  await page.getByRole("button", { name: "预览摸鱼小橘" }).click();
  await page.getByRole("button", { name: "试着喂一口" }).click();
  await expect(page.locator(".skin-market .skin-bubble")).toHaveText(
    "啊呜，这口是小鱼干味的！",
  );
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await page.screenshot({ path: "release/desktop-skin-market.png" });
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "cat",
  );
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(
    page.locator(".world-skin-art [aria-label='摸鱼小橘']"),
  ).toBeVisible();
  await app.close();
  app = await launch();
  page = await pageForApp();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "cat",
  );
  await expect(page.getByLabel("往桶里放入内容", { exact: true })).toHaveValue(
    "皮肤升级验证草稿，仅合成资料",
  );
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "自己做一个", exact: true }).click();
  // Synthetic PNG, never a user's image or profile.
  await page.getByLabel("上传皮肤图片", { exact: true }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("button", { name: "换一张图片" })).toBeEnabled();
  await page.getByLabel("伙伴的名字", { exact: true }).fill("桌面测试伙伴");
  await page.getByLabel("平时说什么", { exact: true }).fill("你好，桌面伙伴。");
  await page.getByLabel("被戳到时说什么", { exact: true }).fill("转一圈！");
  await page.getByLabel("吃到东西时说什么", { exact: true }).fill("接住啦！");
  await page.getByRole("button", { name: "保存到我的收藏" }).click();
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await app.close();
  app = await launch();
  page = await pageForApp();
  await expect(page.locator(".bucket-drawing .skin-art")).toHaveAttribute(
    "src",
    /^data:image\/webp;base64,/,
  );
  await expect(page.locator(".bucket-drawing .skin-bubble")).toHaveText(
    "你好，桌面伙伴。",
  );
  await expect(page.getByLabel("往桶里放入内容", { exact: true })).toHaveValue(
    "皮肤升级验证草稿，仅合成资料",
  );
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "编辑皮肤", exact: true }).click();
  await page.getByLabel("伙伴的名字", { exact: true }).fill("改名后的桌面伙伴");
  await page.getByRole("button", { name: "保存到我的收藏" }).click();
  await expect(
    page.getByRole("button", { name: "预览改名后的桌面伙伴" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "whale",
  );
  assert.deepEqual(errors, []);
  const report = {
    version,
    packaged: !!process.env.SHIXU_PACKAGED_EXE,
    checks: [
      "eight presets and feed preview",
      "home/world share the applied preset",
      "preset and draft survive process restart",
      "synthetic custom image survives process restart",
      "custom edit/delete restores whale",
      "no renderer exceptions",
    ],
    personalProfileRead: false,
    realModelCalls: false,
  };
  await writeFile(
    "release/skins-validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log("PASS:", report.checks.join("; "));
} finally {
  await app?.close();
}
