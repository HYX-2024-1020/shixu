import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { installAudioClock } from "./desktop-audio-test.mjs";

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
  const audioClock = !!(process.env.CI || process.env.SHIXU_SYNTHETIC_AUDIO);
  if (audioClock) {
    await installAudioClock(page);
    await expect(
      page.getByLabel("往桶里放入内容", { exact: true }),
    ).toBeEnabled();
  }
  // Use the actual bundled MP3 and Chromium media pipeline. A greeting must
  // restart on every click and continue beyond the previous 3.2s cutoff.
  await page.evaluate(() => {
    window.__mediaPlays = 0;
    if (window.__syntheticAudio) return;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__greetingAudio = this;
      window.__mediaPlays++;
      return play.call(this);
    };
  });
  const whale = page.locator(".bucket-drawing.skin-mascot");
  await whale.click();
  assert.equal(
    await page.evaluate(() =>
      window.__greetingAudio.src.endsWith("/laugh.mp3"),
    ),
    true,
  );
  await expect
    .poll(() => page.evaluate(() => window.__greetingAudio.currentTime))
    .toBeGreaterThan(0.15);
  for (let i = 0; i < 3; i++) await whale.click();
  assert.equal(await page.evaluate(() => window.__mediaPlays), 4);
  assert.equal(
    await page.evaluate(() => window.__greetingAudio.currentTime < 0.5),
    true,
    "each tap restarts from the beginning",
  );
  await expect
    .poll(() => page.evaluate(() => window.__greetingAudio.currentTime))
    .toBeGreaterThan(3.3);
  assert.equal(await page.evaluate(() => window.__greetingAudio.paused), false);
  await expect
    .poll(() => page.evaluate(() => window.__greetingAudio.ended), {
      timeout: 20000,
    })
    .toBe(true);
  await expect(whale).toHaveAttribute("data-motion", "idle");
  const version = await app.evaluate(({ app }) => app.getVersion());
  const settingsPoint = await page.locator(".bucket-settings").boundingBox();
  await page.locator(".bucket-settings").click();
  await expect(
    page.getByRole("button", { name: "关闭设置", exact: true }),
  ).toBeVisible();
  await page.mouse.click(
    settingsPoint.x + settingsPoint.width / 2,
    settingsPoint.y + settingsPoint.height / 2,
  );
  await expect(page.locator("dialog.bucket-dialog")).toHaveCount(0);
  await page.locator(".bucket-settings").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.bucket-dialog")).toHaveCount(0);
  await page
    .getByLabel("往桶里放入内容", { exact: true })
    .fill("皮肤升级验证草稿，仅合成资料");
  await page.evaluate(() => window.flushDesktopDraft());
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await expect(page.locator(".skin-card")).toHaveCount(2);
  await page.getByRole("button", { name: "预览冰冰冰" }).click();
  await page.getByRole("button", { name: "声音二", exact: true }).click();
  await page.getByRole("button", { name: "试着喂一口" }).click();
  await expect(page.locator(".skin-market .skin-bubble")).toHaveText(
    "咔嚓，烦恼冻住啦！",
  );
  await page.getByRole("button", { name: "就选这个朋友" }).click();
  await page.screenshot({ path: "release/desktop-skin-market.png" });
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "ice",
  );
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(page.locator(".world-skin-art [alt='冰冰冰']")).toBeVisible();
  await app.close();
  app = await launch();
  page = await pageForApp();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "ice",
  );
  await expect(page.getByLabel("往桶里放入内容", { exact: true })).toHaveValue(
    "皮肤升级验证草稿，仅合成资料",
  );
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await expect(
    page.getByRole("button", { name: "声音二", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
    audioMode: audioClock
      ? "real MP3 decode with playback clock adapter (no physical output)"
      : "actual HTMLMediaElement playback",
    checks: [
      "two presets and feed preview",
      "settings dismisses on the second header-position click and Escape",
      audioClock
        ? "real MP3 decoded; playback clock adapter verifies every-click restart, no 3.2s cutoff and natural-duration completion"
        : "actual whale MP3 restarts on every click and plays through its natural end beyond 3.2 seconds",
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
