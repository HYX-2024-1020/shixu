import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Browser geometry/CSS regression for native adapters, not a WeChat runtime test.
test("mini uses Windows looping motion, card palette and readable narrow world header", async ({
  page,
}) => {
  const width = 375;
  await page.setViewportSize({ width, height: 812 });
  const read = (file: string) => readFileSync(file, "utf8");
  const css = (
    read("miniprogram/app.wxss") +
    read("miniprogram/pages/index/index.wxss").replace(
      '@import "../../lib/generated/client-ui.wxss";',
      read("miniprogram/lib/generated/client-ui.wxss"),
    )
  ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>body {margin:0;background:#fff9e6} view,text {display:block} button {box-sizing:border-box} ${css}</style>
    <view class="page"><view class="world">
      <view class="world-heading"><view><text class="world-title"><text class="line-break">消化完了，</text>这是你的<text class="hero-highlight">世界。</text></text></view></view>
      ${[1, 2, 3, 4].map((i) => `<view class="item-card shadow-${i - 1}"><view class="card-top"><button size="mini" class="done-button"></button><text class="kind-label">任务</text></view><text class="item-title">合成事项 ${i}</text><text class="item-summary">保留原文与完整要求</text><view class="card-foot">输入原文 ↗</view></view>`).join("")}
      <view class="skin-mascot skin-interacting"><view class="skin-body skin-motion-bounce">角色</view><text class="skin-spark">✦</text></view>
    </view></view>`);
  const art = page.locator(".skin-body");
  await expect(art).toHaveCSS("animation-iteration-count", "infinite");
  await expect(art).toHaveCSS("animation-duration", "0.55s");
  const matrix = await art.evaluate((el) => {
    const animation = el.getAnimations()[0];
    animation.pause();
    animation.currentTime = 1375; // midpoint of third cycle
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { y: m.m42, xScale: m.a, yScale: m.d };
  });
  expect(matrix.y).toBeCloseTo(-16);
  expect(matrix.xScale).toBeCloseTo(0.96);
  expect(matrix.yScale).toBeCloseTo(1.04);
  const cards = page.locator(".item-card");
  for (const [i, color] of [
    "rgb(255, 212, 59)",
    "rgb(112, 72, 232)",
    "rgb(247, 131, 172)",
    "rgb(112, 72, 232)",
  ].entries()) {
    await expect(cards.nth(i)).toHaveCSS(
      "box-shadow",
      `${color} 5px 5px 0px 0px`,
    );
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
  await page.screenshot({
    path: `test-results/mini-ui-${test.info().project.name}.png`,
    fullPage: true,
  });
});
