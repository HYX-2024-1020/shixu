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
        <view class="item-card shadow-${i}"><view class="card-top"><button size="mini" class="done-button" aria-label="完成"><view class="completion-orbit"></view></button><text class="kind-label">任务</text><button class="icon-button" aria-label="星标">☆</button></view>
        <view class="card-content"><text class="item-title">${title}</text><text class="item-summary">摘要也很长，默认只显示一行，其余从详情查看。</text></view><view class="card-meta"><view class="card-deadline"><text class="card-meta-label">截止</text><text class="card-meta-value">2026-10-26 14:00 → 2026-10-28 23:59</text></view><view class="card-meta-notes"><text>置顶</text><text>今日待打卡</text><text class="card-group">很长的课程分组</text></view></view>
        <view class="card-foot"><button class="card-source-link text-button">详情 ↗</button><view class="card-actions"><button class="compact-delete">删除</button><view class="drag-grip">⠿</view></view></view></view>`,
        )
        .join("")}</view></view>
      <view class="ddl-workspace"><view class="ddl-item"><view class="ddl-time"><text class="ddl-countdown cd-future">还剩 13 天</text><text class="ddl-date">2026-10-26</text><text class="ddl-clock">23:59</text><button class="ddl-verify-button">核对时间 ↗</button></view><view class="ddl-row"><button size="mini" class="done-button"><view class="completion-orbit"></view></button><view class="ddl-copy"><text class="item-title">${title}</text><text class="ddl-status">待完成 · 时间区间 · 详情 ↗</text></view><button class="compact-delete">删除</button></view></view></view></view>`);
    const cards = page.locator(".world .item-card");
    await cards.evaluateAll(async (elements) => {
      await Promise.all(
        elements
          .flatMap((element) => element.getAnimations())
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const boxes = await Promise.all(
      [0, 1].map((i) => cards.nth(i).boundingBox()),
    );
    if (width > 340) expect(boxes[0]!.y).toBe(boxes[1]!.y);
    else expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
    // A full two-line interval plus status notes may grow beyond the old clipped fixed height.
    expect(boxes[0]!.height).toBeLessThan(270);
    for (const button of await page
      .locator(
        ".done-button,.icon-button,.compact-delete,.card-source-link,.ddl-verify-button",
      )
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
    for (const orbit of await page.locator(".completion-orbit").all()) {
      const visual = await orbit.boundingBox();
      expect(visual!.width).toBe(22);
      expect(visual!.height).toBe(22);
    }
    for (const meta of await page
      .locator(".world .card-meta, .world .card-meta text")
      .all()) {
      await expect(meta).toHaveCSS("box-shadow", "none");
    }
    const ddl = await page.locator(".ddl-item").boundingBox();
    expect(ddl!.height).toBeLessThan(150);
    const countdown = (await page.locator(".ddl-countdown").boundingBox())!;
    const date = (await page.locator(".ddl-date").boundingBox())!;
    expect(countdown.y + countdown.height).toBeLessThanOrEqual(date.y + 0.1);
    expect(countdown.x + countdown.width).toBeLessThanOrEqual(
      ddl!.x + ddl!.width,
    );
    const timeRail = (await page.locator(".ddl-time").boundingBox())!;
    const bodyRow = (await page.locator(".ddl-row").boundingBox())!;
    expect(timeRail.y + timeRail.height).toBeLessThanOrEqual(bodyRow.y + 0.1);
    const timeFields = await Promise.all(
      [".ddl-date", ".ddl-clock", ".ddl-verify-button"].map((selector) =>
        page.locator(selector).boundingBox(),
      ),
    );
    for (let i = 0; i < timeFields.length; i++) {
      const box = timeFields[i]!;
      expect(box.x).toBeGreaterThanOrEqual(ddl!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(ddl!.x + ddl!.width);
      if (i)
        expect(
          timeFields[i - 1]!.x + timeFields[i - 1]!.width,
        ).toBeLessThanOrEqual(box.x + 0.1);
    }
    await page.screenshot({
      path: `test-results/mini-polish-${width}-${test.info().project.name}.png`,
      fullPage: true,
    });
    const titleBox = (await page.locator(".ddl-copy").boundingBox())!;
    expect(titleBox.width).toBeGreaterThan(130);
  });
}

for (const width of [320, 375]) {
  test(`mini detail keeps its close target right-aligned and actions inside the sheet at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    const read = (file: string) => readFileSync(file, "utf8");
    const css = (
      read("miniprogram/app.wxss") +
      read("miniprogram/pages/index/index.wxss").replace(
        '@import "../../lib/generated/client-ui.wxss";',
        read("miniprogram/lib/generated/client-ui.wxss"),
      )
    ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}view,text,scroll-view{display:block}button{box-sizing:border-box}scroll-view{overflow:auto} ${css}</style>
      <view class="scrim detail-scrim"><view class="sheet detail-sheet"><view class="section-top detail-toolbar"><text class="kind-label">日程 / 活动 · 很长的课程分组</text><button class="icon-button detail-close">×</button></view><scroll-view class="sheet-scroll"><text class="detail-title">完整事项标题要清楚可读</text><text class="detail-summary">原文与完整要求保留。</text><text class="due-label">2026-10-27 15:00 → 2026-10-28 16:00</text><view class="button-row detail-actions">${["标记完成", "☆ 星标", "置顶", "编辑", "开始处理"].map((label) => `<button class="chip">${label}</button>`).join("")}</view><view class="detail-section"><text class="subheading">同行材料</text><textarea></textarea></view></scroll-view></view></view>`);
    const sheet = (await page.locator(".detail-sheet").boundingBox())!;
    const close = (await page.locator(".detail-close").boundingBox())!;
    expect(close.width).toBeCloseTo(44, 3);
    expect(close.height).toBeCloseTo(44, 3);
    expect(sheet.x + sheet.width - close.x - close.width).toBeLessThan(20);
    const buttons = await page.locator(".detail-actions button").all();
    const rects = await Promise.all(
      buttons.map((button) => button.boundingBox()),
    );
    expect(rects[0]!.y).toBe(rects[1]!.y);
    for (const rect of rects) {
      expect(rect!.height).toBeGreaterThanOrEqual(43.9);
      expect(rect!.width).toBeCloseTo(rects[0]!.width, 0);
      expect(rect!.x).toBeGreaterThan(sheet.x);
      expect(rect!.x + rect!.width).toBeLessThan(sheet.x + sheet.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

for (const width of [320, 375]) {
  test(`mini capture previews are bounded while detail and records retain full text at ${width}px`, async ({
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
    const full = Array.from(
      { length: 20 },
      (_, i) => `第${i + 1}行合成原文与摘要，完整内容始终保留。`,
    ).join("\n");
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}view,text{display:block}${css}</style>
      <view class="page"><view class="current-delivery"><view class="card-paper"><text class="source-preview">${full}</text><text class="item-summary">${full}</text></view>
      <view class="item-card"><text class="item-title">${full}</text><text class="item-summary">${full}</text></view></view></view>
      <view class="sheet"><text class="source-preview record-original">${full}</text><text class="item-summary record-summary">${full}</text></view>
      <view class="detail-sheet"><text class="detail-summary">${full}</text><text class="detail-line">${full}</text></view>`);
    const limits: [string, number][] = [
      [".current-delivery .source-preview", 5],
      [".current-delivery > .card-paper > .item-summary", 4],
      [".current-delivery .item-card .item-title", 2],
      [".current-delivery .item-card .item-summary", 3],
    ];
    for (const [selector, lines] of limits) {
      const el = page.locator(selector);
      await expect(el).toHaveText(full);
      const box = await el.evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(node).lineHeight),
        clamp: getComputedStyle(node).webkitLineClamp,
        scroll: node.scrollHeight,
      }));
      expect(box.clamp).toBe(String(lines));
      expect(box.height).toBeLessThanOrEqual(box.line * lines + 0.2);
      expect(box.height).toBeGreaterThanOrEqual(box.line * lines - 0.2);
      expect(box.scroll).toBeGreaterThan(box.height);
    }
    for (const selector of [
      ".record-original",
      ".record-summary",
      ".detail-summary",
      ".detail-line",
    ]) {
      await expect(page.locator(selector)).toHaveText(full);
      await expect(page.locator(selector)).toHaveCSS(
        "-webkit-line-clamp",
        "none",
      );
    }
    await expect(
      page.locator(".current-delivery .item-summary").first(),
    ).toHaveCSS("color", "rgb(92, 88, 74)");
    await page.locator(".page").screenshot({
      path: `test-results/mini-typography-${width}-${test.info().project.name}.png`,
    });
  });
}

for (const width of [375, 427]) {
  test(`mini short cards have natural text rhythm without date underlines at ${width}px`, async ({
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
    const cards = [
      ["1", "", "2026-11-01 23:59"],
      ["2", "", "2026-11-02 23:59"],
      ["下午三点前", "整理好材料，提交课程报告", "2026-11-02 15:00"],
    ];
    await page.setContent(
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff9e6}view,text{display:block}button{box-sizing:border-box;border:0;background:transparent}button::after{border:0}${css}</style><view class="page"><view class="world"><view class="world-heading"><view><text class="world-title">这是你的<text class="hero-highlight">世界。</text></text><text class="quiet">点开查看完整内容 · 长按卡片移动</text></view></view><view class="world-grid">${cards.map(([title, summary, date], i) => `<view class="item-card shadow-${i}"><view class="card-top"><button class="done-button"><view class="completion-orbit"></view></button><text class="kind-label">任务</text><button class="icon-button">☆</button></view><view class="card-content"><text class="item-title">${title}</text>${summary ? `<text class="item-summary">${summary}</text>` : ""}</view><view class="card-meta"><view class="card-deadline"><text class="card-meta-label">截止</text><text class="card-meta-value">${date}</text></view></view><view class="card-foot"><button class="card-source-link text-button">详情 ↗</button><view class="card-actions"><button class="compact-delete">删除</button><view class="drag-grip">⠿</view></view></view></view>`).join("")}</view></view></view>`,
    );
    await page.locator(".item-card").evaluateAll(async (elements) => {
      await Promise.all(
        elements
          .flatMap((el) => el.getAnimations())
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const cardBoxes = await Promise.all(
      (await page.locator(".item-card").all()).map((el) => el.boundingBox()),
    );
    expect(
      Math.max(...cardBoxes.map((b) => b!.height)) -
        Math.min(...cardBoxes.map((b) => b!.height)),
    ).toBeLessThan(0.2);
    expect(cardBoxes[0]!.height).toBeLessThan(210);
    // Equal grid tracks keep the drag engine's measured slots stable despite different text lengths.
    await page
      .locator(".world-grid")
      .evaluate((grid) => grid.prepend(grid.lastElementChild!));
    await page.locator(".item-card").evaluateAll(async (elements) => {
      await Promise.all(
        elements
          .flatMap((el) => el.getAnimations())
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const movedBoxes = await Promise.all(
      (await page.locator(".item-card").all()).map((el) => el.boundingBox()),
    );
    for (let i = 0; i < cardBoxes.length; i++) {
      expect(movedBoxes[i]!.x).toBeCloseTo(cardBoxes[i]!.x, 1);
      expect(movedBoxes[i]!.y).toBeCloseTo(cardBoxes[i]!.y, 1);
      expect(movedBoxes[i]!.height).toBeCloseTo(cardBoxes[i]!.height, 1);
    }
    await page
      .locator(".world-grid")
      .evaluate((grid) => grid.append(grid.firstElementChild!));
    await page.locator(".item-card").evaluateAll(async (elements) => {
      await Promise.all(
        elements
          .flatMap((el) => el.getAnimations())
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const first = page.locator(".item-card").first();
    const titleBox = (await first.locator(".item-title").boundingBox())!;
    const deadline = (await first.locator(".card-deadline").boundingBox())!;
    expect(titleBox.height).toBeLessThan(25);
    expect(deadline.y - titleBox.y - titleBox.height).toBeLessThan(12);
    await expect(first.locator(".card-meta-value")).toHaveText(
      "2026-11-01 23:59",
    );
    for (const el of await page.locator(".card-meta, .card-meta text").all())
      await expect(el).toHaveCSS("box-shadow", "none");
    for (const el of await page.locator(".card-meta-value").all()) {
      const extent = await el.evaluate((node) => ({
        width: node.clientWidth,
        scroll: node.scrollWidth,
        height: node.clientHeight,
        content: node.scrollHeight,
      }));
      expect(extent.scroll).toBeLessThanOrEqual(extent.width + 1);
      expect(extent.content).toBeLessThanOrEqual(extent.height + 1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.locator(".world").screenshot({
      path: `test-results/mini-card-rhythm-${width}-${test.info().project.name}.png`,
    });
  });
}
