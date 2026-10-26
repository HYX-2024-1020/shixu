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
  const wxml = read("miniprogram/pages/index/index.wxml");
  const marketStart = wxml.indexOf('<view wx:if="{{skinOpen}}"');
  const marketHeadStart = wxml.indexOf(
    '    ><view class="section-top skin-market-header"',
    marketStart,
  );
  const marketHeadEnd = wxml.indexOf(
    '    ><scroll-view scroll-y class="sheet-scroll"',
    marketHeadStart,
  );
  const marketPreviewStart = wxml.indexOf(
    '        ><view class="skin-preview ',
    marketHeadEnd,
  );
  const marketPreviewEnd = wxml.indexOf(
    '        ><view class="skin-grid"',
    marketPreviewStart,
  );
  const source =
    template === "home"
      ? wxml.slice(
          wxml.indexOf('      <view class="home-character'),
          wxml.indexOf('      <view class="count-line'),
        )
      : template === "market"
        ? wxml.slice(marketHeadStart, marketHeadEnd).trim().slice(1) +
          ">" +
          wxml.slice(marketPreviewStart, marketPreviewEnd).trim().slice(1) +
          ">"
        : wxml
            .split(`<template name="${template}">`)[1]
            .split("</template>")[0];
  await page.setViewportSize({ width, height: 900 });
  const host =
    template === "home"
      ? '<view class="page"><view class="hero" id="cards"></view></view>'
      : template === "market"
        ? '<view class="sheet skin-market-sheet" id="cards"></view>'
        : '<view class="page"><view class="world"><view class="world-grid" id="cards"></view></view></view>';
  await page.setContent(
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff6dc}view,text{display:block}button{box-sizing:border-box}${cssAt(width)}</style>${host}`,
  );
  await page.evaluate(
    ({ source, row }: any) => {
      const data: any = {
        row,
        activeSkin: {
          id: row.skin || "ice",
          name: row.skin === "bunny" ? "绯樱狐" : row.skin || "ice",
          image: row.image,
          motion: "wiggle",
          hello: "hello",
        },
        previewSkin: {
          id: row.skin || "ice",
          image: row.image,
          art: row.skin || "ice",
          motion: "wiggle",
          name: row.skin || "ice",
          description: "合成预览",
          color: "#dcecff",
        },
        skinOpen: false,
        skinAnimating: !!row.playing,
        bunnySheet: row.sheet || "",
        bunnyPosition: row.position || "left:0%;top:0%",
        skinNativeMotion: false,
        skinAnimation: null,
        skinMessage: "hello",
        iceVoice: "voice-1",
        iceVoices: [
          { id: "voice-1", label: "声音一" },
          { id: "voice-2", label: "声音二" },
        ],
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
      holder.innerHTML = source.replace(/<image\b([^>]*)\/>/g, "<img$1>");
      function walk(parent: Element) {
        let matched = false;
        for (const node of [...parent.childNodes]) {
          if (node.nodeType === 3) {
            node.textContent = fill(node.textContent || "");
            continue;
          }
          if (!(node instanceof Element)) continue;
          if (node.hasAttribute("wx:for")) {
            const values = evaluate(node.getAttribute("wx:for")!) || [];
            const key = node.getAttribute("wx:for-item") || "item";
            const saved = data[key];
            for (const value of values) {
              data[key] = value;
              const copy = node.cloneNode(true) as Element;
              copy.removeAttribute("wx:for");
              const wrapper = document.createElement("div");
              wrapper.append(copy);
              walk(wrapper);
              node.before(...wrapper.childNodes);
            }
            data[key] = saved;
            node.remove();
            continue;
          }
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

test("native bunny timeline keeps the same crop in home and market", async ({
  page,
}, info) => {
  const sheet =
    "data:image/webp;base64," +
    readFileSync("public/fox-atlas.webp").toString("base64");
  const image =
    "data:image/png;base64," +
    readFileSync("public/bunny.png").toString("base64");
  for (const template of ["home", "market"]) {
    await render(page, 375, template, {
      skin: "bunny",
      image,
      sheet,
      playing: true,
      position: "left:-100%;top:-200%",
    });
    const viewport = page.locator(".bunny-window");
    await expect(viewport).toBeVisible();
    await expect(viewport).toHaveCSS("overflow", "hidden");
    const box = await viewport.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(160 / 232, 2);
    const inner = await page.locator(".bunny-sheet").boundingBox();
    expect(inner!.width / box!.width).toBeCloseTo(10, 1);
    expect(inner!.height / box!.height).toBeCloseTo(11, 1);
    if (template === "home") {
      const button = await page.locator(".skin-home-change").boundingBox();
      expect(button!.y - box!.y - box!.height).toBeGreaterThanOrEqual(14);
      await expect(page.locator(".skin-home-change")).toContainText("绯樱狐");
    }
    await expect(page.locator(".skin-bubble,.skin-spark")).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: info.outputPath(`native-bunny-${template}.png`),
      fullPage: true,
    });
  }
});

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
      cardFiles: [
        {
          id: "f",
          name: "完整交付清单-长文件名用于手机换行测试.pdf",
          extension: "PDF",
        },
      ],
      kind: "task",
      urgency: "today",
      title: "完成品牌提案",
      countdown: "今天截止",
      countdownStatus: "today",
      date: "2026-10-26",
      time: "18:30",
      group: "品牌设计",
    });
    await expect(page.locator(".card-file")).toContainText("完整交付清单");
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

for (const width of [320, 375, 414]) {
  test(`native home centers the actual ice image without an oversized air box at ${width}px`, async ({
    page,
  }, info) => {
    const whale =
      "data:image/png;base64," +
      readFileSync("public/mascot.png").toString("base64");
    const ice =
      "data:image/png;base64," +
      readFileSync("public/ice.png").toString("base64");
    await render(page, width, "home", { skin: "whale", image: whale });
    await page.locator(".mascot").evaluate((img: any) => img.decode());
    const whaleArt = await page.locator(".mascot").boundingBox();
    const whaleBox = await page.locator(".home-character").boundingBox();
    await render(page, width, "home", { skin: "ice", image: ice });
    await page.locator(".mascot").evaluate((img: any) => img.decode());
    const art = await page.locator(".mascot").boundingBox();
    const anchor = await page.locator(".home-character").boundingBox();
    const controls = await page.locator(".ice-home-voices").boundingBox();
    expect(Math.abs(art!.x + art!.width / 2 - width / 2)).toBeLessThan(1);
    expect(art!.width / whaleArt!.width).toBeGreaterThanOrEqual(1);
    expect(art!.width / whaleArt!.width).toBeLessThan(1.1);
    expect(anchor!.height).toBeLessThanOrEqual(whaleBox!.height + 2);
    expect(controls!.x).toBeGreaterThan(art!.x + art!.width - 2);
    expect(controls!.x + controls!.width).toBeLessThan(width);
    await expect(
      page.getByRole("button", { name: "声音一", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".home-character")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await page
      .locator(".hero")
      .screenshot({ path: info.outputPath("native-ice-home.png") });
  });
}

for (const width of [320, 375, 414]) {
  test(`native market shares preview frames and keeps close at top right at ${width}px`, async ({
    page,
  }, info) => {
    for (const skin of ["whale", "ice"]) {
      const image =
        "data:image/png;base64," +
        readFileSync(
          `public/${skin === "ice" ? "ice" : "mascot"}.png`,
        ).toString("base64");
      await render(page, width, "market", { skin, image });
      const sheet = await page.locator(".skin-market-sheet").boundingBox();
      const close = await page
        .getByRole("button", { name: "关闭皮肤市场" })
        .boundingBox();
      expect(sheet!.x + sheet!.width - close!.x - close!.width).toBeLessThan(
        23,
      );
      expect(close!.x).toBeGreaterThan(width * 0.75);
      await expect(page.locator(".skin-preview")).toHaveCSS(
        "background-color",
        "rgb(220, 236, 255)",
      );
      await expect(page.locator(".skin-preview")).toHaveCSS(
        "border-top-style",
        "solid",
      );
      await expect(page.locator(".skin-preview")).not.toHaveCSS(
        "box-shadow",
        "none",
      );
    }
    await page
      .locator(".skin-market-sheet")
      .screenshot({ path: info.outputPath("native-skin-market.png") });
  });
}
