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
    read("miniprogram/pages/index/index.wxss")
      .replace(
        '@import "../../lib/generated/client-ui.wxss";',
        read("miniprogram/lib/generated/client-ui.wxss"),
      )
      .replace(
        '@import "./card-visuals.wxss";',
        read("miniprogram/pages/index/card-visuals.wxss"),
      )
  ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>body {margin:0;background:#fff9e6} view,text {display:block} button {box-sizing:border-box} ${css}</style>
    <view class="page"><view class="world">
      <view class="world-heading"><view><text class="world-title"><text class="line-break">消化完了，</text>这是你的<text class="hero-highlight">世界。</text></text></view></view>
      ${["task", "event", "idea", "habit"].map((kind, i) => `<view class="item-card kind-${kind} shadow-${i}"><view class="card-top"><button size="mini" class="done-button"></button><text class="kind-label">${["任务", "日程 / 活动", "灵感", "习惯"][i]}</text></view><text class="item-title">合成事项 ${i}</text><text class="item-summary">保留原文与完整要求</text><view class="card-foot">输入原文 ↗</view></view>`).join("")}
      <view class="skin-mascot" data-motion="bounce"><view class="skin-body">角色</view><text class="skin-spark">✦</text></view>
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
    "rgb(115, 156, 255)",
    "rgb(255, 143, 171)",
    "rgb(96, 214, 170)",
  ].entries()) {
    await expect(cards.nth(i).locator(".card-top")).toHaveCSS(
      "background-color",
      color,
    );
    await expect(cards.nth(i)).toHaveCSS(
      "box-shadow",
      `${color} 5px 5px 0px 0px, rgb(17, 17, 17) 7px 7px 0px 0px`,
    );
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
  await page.screenshot({
    path: `test-results/mini-ui-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
});

test("mini deadline status bands stay legible at 320, 375 and 414 pixels", async ({
  page,
}, info) => {
  const read = (file: string) => readFileSync(file, "utf8");
  const native =
    read("miniprogram/app.wxss") +
    read("miniprogram/pages/index/index.wxss")
      .replace(
        '@import "../../lib/generated/client-ui.wxss";',
        read("miniprogram/lib/generated/client-ui.wxss"),
      )
      .replace(
        '@import "./card-visuals.wxss";',
        read("miniprogram/pages/index/card-visuals.wxss"),
      );
  for (const width of [320, 375, 414]) {
    await page.setViewportSize({ width, height: 812 });
    const css = native.replace(
      /(-?[\d.]+)rpx/g,
      (_, n) => `${(Number(n) * width) / 750}px`,
    );
    await page.setContent(
      `<style>body{margin:0;background:#fff9e6}view,text{display:block} ${css}</style><view class="page">${["overdue", "today", "soon", "later", "unsure", "done"].map((state, i) => `<view class="ddl-item urgency-${state}"><view class="ddl-time"><text class="ddl-status">${["已逾期", "今天截止", "即将截止", "提前安排", "日期待确认", "已完成"][i]}</text><text>2026-10-26</text><text class="ddl-clock">18:30</text><text>核对时间 ↗</text></view><view class="ddl-row"><view class="ddl-copy"><text class="item-title">完成设计方案，保留完整要求</text><text class="quiet">合成样例 · 原文已保留</text></view></view></view>`).join("")}</view>`,
    );
    const bands = page.locator(".ddl-time");
    const colors = [
      "rgb(255, 143, 171)",
      "rgb(255, 212, 59)",
      "rgb(181, 152, 255)",
      "rgb(115, 156, 255)",
      "rgb(255, 174, 98)",
      "rgb(96, 214, 170)",
    ];
    for (let i = 0; i < colors.length; i++)
      await expect(bands.nth(i)).toHaveCSS("background-color", colors[i]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`mini-ddl-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});
