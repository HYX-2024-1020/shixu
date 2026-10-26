import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");
const cssAt = (width: number) =>
  (
    read("miniprogram/app.wxss") +
    read("miniprogram/pages/index/index.wxss")
      .replace(
        '@import "./cards.wxss";',
        read("miniprogram/pages/index/cards.wxss"),
      )
      .replace(
        '@import "../../lib/generated/client-ui.wxss";',
        read("miniprogram/lib/generated/client-ui.wxss"),
      )
      .replace(
        '@import "./card-visuals.wxss";',
        read("miniprogram/pages/index/card-visuals.wxss"),
      )
  ).replace(/(-?[\d.]+)rpx/g, (_, n) => `${(Number(n) * width) / 750}px`);

// Render the actual WXML card subtrees with synthetic data for browser geometry.
// Native routing and WXS compilation are separately checked by mini:compile.
async function render(page: any, width: number, template: string, row: any) {
  const source = read("miniprogram/pages/index/index.wxml")
    .split(`<template name="${template}">`)[1]
    .split("</template>")[0];
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff6dc}view,text{display:block}button{box-sizing:border-box}${cssAt(width)}</style><view class="page"><view class="world"><view class="world-grid" id="cards"></view></view></view>`,
  );
  await page.evaluate(
    ({ source, row }: any) => {
      const data: any = {
        row,
        expandedCardId: "",
        checkingId: "",
        leavingId: "",
        dragId: "",
        dragView: {},
      };
      const evaluate = (s: string) => {
        try {
          return Function(
            ...Object.keys(data),
            `return (${s.replace(/^\{\{|\}\}$/g, "")})`,
          )(...Object.values(data));
        } catch {
          return "";
        }
      };
      const fill = (s: string) =>
        s.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(evaluate(e) ?? ""));
      const holder = document.createElement("div");
      holder.innerHTML = source;
      function walk(parent: Element) {
        let matched = false;
        for (const node of [...parent.childNodes]) {
          if (node.nodeType === 3) {
            node.textContent = fill(node.textContent || "");
            continue;
          }
          if (!(node instanceof Element)) continue;
          if (node.hasAttribute("wx:if")) {
            matched = !!evaluate(node.getAttribute("wx:if")!);
            if (!matched) {
              node.remove();
              continue;
            }
          } else if (node.hasAttribute("wx:elif")) {
            if (matched || !evaluate(node.getAttribute("wx:elif")!)) {
              node.remove();
              continue;
            }
            matched = true;
          } else if (node.hasAttribute("wx:else")) {
            if (matched) {
              node.remove();
              continue;
            }
            matched = true;
          } else matched = false;
          for (const attr of [...node.attributes]) {
            if (
              attr.name.startsWith("wx:") ||
              attr.name.startsWith("bind") ||
              attr.name.startsWith("catch")
            )
              node.removeAttribute(attr.name);
            else node.setAttribute(attr.name, fill(attr.value));
          }
          walk(node);
        }
      }
      walk(holder);
      document.querySelector("#cards")!.innerHTML = holder.innerHTML;
    },
    { source, row },
  );
}

for (const width of [320, 375, 414]) {
  test(`native sticker world keeps readable title and independent actions at ${width}px`, async ({
    page,
  }, info) => {
    const row = {
      id: "card",
      kind: "task",
      kindLabel: "任务",
      title: "完成品牌提案",
      summary: "整理核心概念与三张主视觉，准备下一轮评审。",
      timeLabel: "10-28 18:30",
      compactTimeLabel: "10-28 18:30",
      group: "品牌设计",
      shadowIndex: 1,
    };
    await render(page, width, "itemCard", row);
    await expect(page.locator(".xc-title")).toHaveCSS(
      "background-color",
      "rgb(255, 218, 50)",
    );
    await expect(page.locator(".xc-footer")).toHaveCSS(
      "background-color",
      "rgb(255, 218, 50)",
    );
    const shadow = await page
      .locator(".xc-card")
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("rgb(23, 23, 19)");
    expect(shadow).toContain("0px 0px");
    for (const target of await page
      .locator(".xc-hit,.xc-detail,.xc-delete")
      .all()) {
      const r = await target.boundingBox();
      expect(r!.width).toBeGreaterThanOrEqual(43.9);
      expect(r!.height).toBeGreaterThanOrEqual(43.9);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`mini-world-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await render(page, width, "itemCard", {
      ...row,
      kind: "event",
      kindLabel: "日程 / 活动",
      title:
        "很长的事项标题需要完整换行并保持足够的行距与清晰的阅读区域".repeat(3),
      group: "很长的课程分组名称",
    });
    await expect(page.locator(".xc-title")).toHaveCSS(
      "background-color",
      "rgb(195, 176, 255)",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
  test(`native sticker DDL keeps countdown, date and actions inside ${width}px`, async ({
    page,
  }, info) => {
    await render(page, width, "ddlCard", {
      id: "ddl",
      kind: "task",
      urgency: "today",
      title: "完成品牌提案",
      countdown: "今天截止",
      countdownStatus: "today",
      date: "2026-10-26",
      time: "18:30",
      group: "品牌设计",
    });
    await expect(page.locator(".ddl-countdown")).toHaveText("今天截止");
    await expect(page.locator(".ddl-countdown")).toHaveCSS(
      "background-color",
      "rgb(255, 218, 50)",
    );
    for (const target of await page
      .locator(
        ".ddl-verify-button,.ddl-detail-button,.compact-delete,.done-button",
      )
      .all()) {
      const r = await target.boundingBox();
      expect(r!.width).toBeGreaterThanOrEqual(43.9);
      expect(r!.height).toBeGreaterThanOrEqual(43.9);
    }
    const positions = await page.locator(".ddl-time > *").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i],
          b = positions[j];
        expect(
          a.right <= b.x + 0.5 ||
            b.right <= a.x + 0.5 ||
            a.bottom <= b.y + 0.5 ||
            b.bottom <= a.y + 0.5,
        ).toBe(true);
      }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`mini-ddl-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
