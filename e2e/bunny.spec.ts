import { test, expect } from "@playwright/test";

for (const width of [375, 810, 1440]) {
  test(`fox stays visible at home during playback with space above change button at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, body: "unavailable" }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "打开皮肤市场" }).click();
    await page.getByRole("button", { name: "使用绯樱狐" }).click();
    const stage = await page.locator(".skin-preview-stage").boundingBox();
    const preview = await page
      .locator(".skin-preview-stage .bunny-art")
      .boundingBox();
    expect(preview!.height).toBeLessThan(stage!.height);
    await expect(
      page.locator(
        ".skin-stage-label,.skin-motion-label,.skin-preview-copy p,.skin-preview-panel > .skin-eyebrow",
      ),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "关闭皮肤市场" }).click();
    const mascot = page.locator(".bucket-drawing");
    const before = await mascot.locator(".bunny-art").boundingBox();
    const change = page.locator(".skin-home-change");
    const button = await change.boundingBox();
    expect(button!.y - before!.y - before!.height).toBeGreaterThanOrEqual(14);
    await mascot.click();
    await expect(mascot.locator("video.bunny-video")).toBeVisible();
    const playing = await mascot.locator("video.bunny-video").boundingBox();
    expect(playing!.height).toBeGreaterThanOrEqual(340);
    expect(Math.abs(playing!.height - before!.height)).toBeLessThan(1);
    expect(Math.abs(playing!.width - before!.width)).toBeLessThan(1);
    await expect(change).toContainText("绯樱狐");
    await page.screenshot({
      path: info.outputPath(`fox-home-${width}.png`),
      fullPage: true,
    });
  });
}

test("market wheel scroll moves filters together with cards instead of overlaying them", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 810, height: 650 });
  await page.goto("/");
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  const panel = page.locator(".skin-collection-panel");
  const toolbar = page.locator(".skin-collection-toolbar");
  await expect(toolbar).toHaveCSS("position", "static");
  const initial = await toolbar.boundingBox();
  await panel.hover();
  await page.mouse.wheel(0, 650);
  await expect
    .poll(() => panel.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  const after = await toolbar.boundingBox();
  expect(after!.y).toBeLessThan(initial!.y - 100);
  const top = await panel.boundingBox();
  expect(after!.y + after!.height).toBeLessThanOrEqual(top!.y);
  await page.screenshot({ path: info.outputPath("fox-market-scrolled.png") });
});

test("bunny plays original audio and atlas once, persists, and removes the DDL caption", async ({
  page,
}, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "unavailable" }),
  );
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.tagName === "AUDIO") (window as any).__bunnyAudio = this;
      return play.call(this);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "使用绯樱狐" }).click();
  const mascot = page.locator(".skin-market .skin-mascot");
  await mascot.locator("video").evaluate((v: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 69;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    (window as any).__foxFrames = [];
    const sample = () => {
      if (!v.paused && v.readyState >= 2) {
        ctx.clearRect(0, 0, 48, 69);
        ctx.drawImage(v, 0, 0, 48, 69);
        const rgba = ctx.getImageData(0, 0, 48, 69).data;
        let visible = 0,
          clear = 0;
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i] > 200) visible++;
          if (rgba[i] === 0) clear++;
        }
        (window as any).__foxFrames.push({ visible, clear });
      }
      if (v.isConnected) v.requestVideoFrameCallback(sample);
    };
    v.requestVideoFrameCallback(sample);
  });
  await mascot.click();
  await expect(mascot.locator("video.bunny-video")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__bunnyAudio.currentTime))
    .toBeGreaterThan(1.4);
  await expect
    .poll(() =>
      mascot
        .locator("video.bunny-video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(1.4);
  await page
    .locator(".skin-market")
    .screenshot({ path: info.outputPath("bunny-market.png") });
  await mascot.click();
  expect(
    await page.evaluate(() => (window as any).__bunnyAudio.currentTime),
  ).toBeLessThan(0.5);
  await expect
    .poll(() => page.evaluate(() => (window as any).__bunnyAudio.ended), {
      timeout: 12000,
    })
    .toBe(true);
  await expect(mascot.locator(".bunny-art")).toBeVisible();
  const samples = await page.evaluate(() => (window as any).__foxFrames);
  expect(samples.length).toBeGreaterThan(60);
  expect(samples.every((s: any) => s.visible > 300 && s.clear > 300)).toBe(
    true,
  );
  await expect
    .poll(() =>
      mascot
        .locator("video.bunny-video")
        .evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
  await mascot.click();
  await page.getByRole("button", { name: "关闭皮肤市场" }).click();
  expect(await page.evaluate(() => (window as any).__bunnyAudio.paused)).toBe(
    true,
  );
  await page.reload();
  await expect(page.locator(".bucket-drawing")).toHaveAttribute(
    "data-skin",
    "bunny",
  );
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await expect(page.locator(".ddl-head img")).toHaveAttribute("alt", "绯樱狐");
  await expect(page.locator(".ddl-head")).not.toContainText("优先采用");
  await page.screenshot({
    path: info.outputPath("bunny-ddl.png"),
    fullPage: true,
  });
});
