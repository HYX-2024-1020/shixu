import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Synthetic DOM with native adapter CSS: geometry only, not a WeChat gesture test.
for (const width of [320, 375, 414]) {
  test(`compact mini cards and DDL keep readable columns and separate targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    const read = (p: string) => readFileSync(p, "utf8");
    const css = (
      read("miniprogram/app.wxss") +
      read("miniprogram/pages/index/index.wxss").replace(
        '@import "../../lib/generated/client-ui.wxss";',
        read("miniprogram/lib/generated/client-ui.wxss"),
      )
    ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
    const title =
      "很长的合成事项标题 EnglishLongUnbrokenTitleABCDEFGHIJK 不应横向溢出";
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}view,text{display:block}button{box-sizing:border-box} ${css}</style>
      <view class="page"><view class="world"><view class="world-grid">${[
        0, 1, 2, 3,
      ]
        .map(
          (i) => `
        <view class="item-card shadow-${i}"><view class="card-top"><button size="mini" class="done-button" aria-label="完成"></button><text class="kind-label">任务</text><button class="icon-button" aria-label="星标">☆</button></view>
        <text class="item-title">${title}</text><text class="item-summary">摘要也很长，默认只显示一行，其余从详情查看。</text><view class="card-meta"><text>2026-10-26 14:00 → 2026-10-28 23:59</text><text>课程分组</text></view>
        <view class="card-foot"><button class="card-source-link">完整详情 ↗</button><view class="card-actions"><button class="compact-delete">删除</button></view></view></view>`,
        )
        .join("")}</view></view>
      <view class="ddl-workspace"><view class="ddl-item"><view class="ddl-time"><text>2026-10-26</text><text class="ddl-clock">23:59</text><text>核对 ↗</text></view><view class="ddl-row"><button size="mini" class="done-button"></button><view class="ddl-copy"><text class="item-title">${title}</text><text class="ddl-status">待完成 · 时间区间 · 详情 ↗</text></view><button class="compact-delete">删除</button></view></view></view></view>`);
    const cards = page.locator(".world .item-card");
    const boxes = await Promise.all(
      [0, 1].map((i) => cards.nth(i).boundingBox()),
    );
    if (width > 340) expect(boxes[0]!.y).toBe(boxes[1]!.y);
    else expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes[0]!.height).toBeLessThan(250);
    for (const button of await page
      .locator(".done-button,.icon-button,.compact-delete,.card-source-link")
      .all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(43.5);
      expect(box!.height).toBeGreaterThanOrEqual(43.5);
      const card = await button.evaluate((el) => {
        const a = el.getBoundingClientRect(),
          b = el.closest(".item-card,.ddl-item")!.getBoundingClientRect();
        return {
          left: a.left - b.left,
          right: b.right - a.right,
          bottom: b.bottom - a.bottom,
        };
      });
      expect(card.left).toBeGreaterThanOrEqual(0);
      expect(card.right).toBeGreaterThanOrEqual(0);
      expect(card.bottom).toBeGreaterThanOrEqual(0);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const ddl = await page.locator(".ddl-item").boundingBox();
    expect(ddl!.height).toBeLessThan(110);
  });
}
