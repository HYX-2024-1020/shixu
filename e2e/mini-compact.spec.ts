import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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
      <view class="scrim detail-scrim"><view class="sheet detail-sheet"><view class="sheet-handle"></view><view class="section-top detail-toolbar"><view class="detail-heading"><text class="detail-kind">日程 / 活动</text><text class="detail-group">很长的课程分组</text></view><button class="icon-button detail-close">×</button></view><scroll-view class="sheet-scroll"><text class="detail-title">完整事项标题要清楚可读</text><text class="detail-summary">原文与完整要求保留。</text><text class="due-label">2026-10-27 15:00 → 2026-10-28 16:00</text><view class="button-row detail-actions">${["标记完成", "☆ 星标", "置顶", "编辑", "打开附件 · 1 份"].map((label) => `<button class="chip">${label}</button>`).join("")}</view><view class="detail-section"><text class="subheading">文件附件与原文</text><view class="draft-file"><text>这是一份文件名非常长的课程附件.pdf</text><button class="text-button">打开附件 ↗</button></view><text class="detail-line evidence">完整原文引用，内容可以选择和复制。</text></view><view class="detail-section detail-ai"><text class="subheading">和 AI 说一声</text><textarea class="edit-area" placeholder="只针对当前事项提问或修改"></textarea><button class="small-button">发送给当前事项</button></view></scroll-view></view></view>`);
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
      expect(rect!.width).toBeGreaterThanOrEqual(43.9);
      expect(rect!.x).toBeGreaterThan(sheet.x);
      expect(rect!.x + rect!.width).toBeLessThan(sheet.x + sheet.width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.locator(".detail-sheet").evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: `test-results/mini-detail-reference-${width}-${test.info().project.name}.png`,
    });
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

for (const width of [320, 375, 414, 427]) {
  test(`reference compact cards separate controls and reveal full content at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    const css = (
      readFileSync("miniprogram/app.wxss", "utf8") +
      readFileSync("miniprogram/pages/index/index.wxss", "utf8").replace(
        '@import "../../lib/generated/client-ui.wxss";',
        readFileSync("miniprogram/lib/generated/client-ui.wxss", "utf8"),
      )
    ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
    const title = "人工智能课程调整通知与一段很长很长的事项名称";
    const full = "完整摘要与要求，展开后应自然换行显示，不省略。".repeat(15);
    const card = (i: number) =>
      `<view class="item-card compact-card shadow-${i}"><view class="card-top compact-top"><button size="mini" class="done-button" aria-label="完成"><view class="completion-orbit"></view></button><text class="item-title compact-title">${title}</text><button class="icon-button" aria-label="星标">☆</button><button class="card-chevron" aria-label="展开">▸</button></view><view class="compact-info"><text class="compact-due">截止 2026-11-01 23:59</text><text class="compact-preview">${full}</text></view><view class="compact-expanded" hidden><text class="compact-summary">${full}</text><view class="compact-tags"><text>任务</text><text>课程</text></view><button class="card-attachment text-button">打开附件 · 1 份 ↗</button><view class="card-foot"><button class="card-source-link text-button">详情 ↗</button><view class="card-actions"><button class="icon-button" aria-label="向前移动">↑</button><button class="icon-button" aria-label="向后移动">↓</button><button class="compact-delete">删除</button><view class="drag-grip">⠿</view></view></view></view></view>`;
    await page.setContent(
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff9e6}view,text{display:block}button{box-sizing:border-box;border:0;background:transparent}[hidden]{display:none!important}${css}</style><view class="page"><view class="world"><view class="world-grid">${[0, 1, 2].map(card).join("")}</view></view></view>`,
    );
    const cards = page.locator(".compact-card");
    const boxes = await Promise.all(
      [0, 1, 2].map((i) => cards.nth(i).boundingBox()),
    );
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
    expect(boxes[0]!.height).toBeLessThan(120);
    const topButtons = cards.first().locator(".compact-top button");
    const targets = await Promise.all(
      (await topButtons.all()).map((el) => el.boundingBox()),
    );
    for (let i = 0; i < targets.length; i++) {
      expect(targets[i]!.width).toBeGreaterThanOrEqual(43.9);
      expect(targets[i]!.height).toBeGreaterThanOrEqual(43.9);
      if (i)
        expect(targets[i - 1]!.x + targets[i - 1]!.width).toBeLessThanOrEqual(
          targets[i]!.x,
        );
      const hit = await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest("button")
            ?.getAttribute("aria-label"),
        { x: targets[i]!.x + 22, y: targets[i]!.y + 22 },
      );
      expect(hit).toBe(["完成", "星标", "展开"][i]);
    }
    const titleSize = await cards
      .first()
      .locator(".compact-title")
      .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(titleSize.scroll).toBeGreaterThan(titleSize.width);
    await cards
      .first()
      .locator(".compact-expanded")
      .evaluate((el) => el.removeAttribute("hidden"));
    await expect(cards.first().locator(".compact-summary")).toHaveText(full);
    const textBox = await cards
      .first()
      .locator(".compact-summary")
      .evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    expect(textBox.scroll).toBeLessThanOrEqual(textBox.height + 1);
    for (const el of await cards
      .first()
      .locator(".card-foot button,.card-attachment,.drag-grip")
      .all()) {
      const box = (await el.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.9);
      expect(box.width).toBeGreaterThanOrEqual(43.9);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await cards
      .first()
      .locator(".compact-expanded")
      .evaluate(async (el) => {
        await Promise.all(
          el.getAnimations().map((a) => a.finished.catch(() => {})),
        );
      });
    await page.screenshot({
      path: `test-results/mini-reference-${width}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}

for (const width of [320, 375, 414]) {
  test(`DDL countdown clock verification and controls remain separate at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    const css = (
      readFileSync("miniprogram/app.wxss", "utf8") +
      readFileSync("miniprogram/pages/index/index.wxss", "utf8").replace(
        '@import "../../lib/generated/client-ui.wxss";',
        readFileSync("miniprogram/lib/generated/client-ui.wxss", "utf8"),
      )
    ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);
    await page.setContent(
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}view,text{display:block}button{box-sizing:border-box}${css}</style><view class="page"><view class="ddl-workspace"><view class="ddl-item"><view class="ddl-time"><text class="ddl-countdown cd-future">还剩 13 天</text><text class="ddl-date">2026-11-08</text><text class="ddl-clock">23:59</text><button class="ddl-verify-button">核对时间 ↗</button></view><view class="ddl-row"><button size="mini" class="done-button"><view class="completion-orbit"></view></button><view class="ddl-copy"><text class="item-title">很长的合成事项标题需要自然换行而不能挤住操作</text><text class="ddl-status">待完成 · 时间区间 · 详情 ↗</text></view><button class="compact-delete">删除</button></view></view></view></view>`,
    );
    const card = (await page.locator(".ddl-item").boundingBox())!;
    const rail = (await page.locator(".ddl-time").boundingBox())!;
    const row = (await page.locator(".ddl-row").boundingBox())!;
    expect(rail.y + rail.height).toBeLessThanOrEqual(row.y + 0.1);
    const fields = await Promise.all(
      [".ddl-date", ".ddl-clock", ".ddl-verify-button"].map((s) =>
        page.locator(s).boundingBox(),
      ),
    );
    for (let i = 0; i < fields.length; i++) {
      const box = fields[i]!;
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
      if (i)
        expect(fields[i - 1]!.x + fields[i - 1]!.width).toBeLessThanOrEqual(
          box.x + 0.1,
        );
    }
    for (const el of await page.locator("button").all()) {
      const b = (await el.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(43.9);
      expect(b.height).toBeGreaterThanOrEqual(43.9);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
