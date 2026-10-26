import { test, expect } from "@playwright/test";

test("bunny plays original audio and atlas once, persists, and removes the DDL caption", async ({
  page,
}, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "unavailable" }),
  );
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as any).__bunnyAudio = this;
      return play.call(this);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开皮肤市场" }).click();
  await page.getByRole("button", { name: "使用兔耳小桃" }).click();
  const mascot = page.locator(".skin-market .skin-mascot");
  await mascot.click();
  await expect(mascot.locator(".bunny-frame")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__bunnyAudio.currentTime))
    .toBeGreaterThan(1.4);
  await expect
    .poll(() => mascot.locator(".bunny-frame").getAttribute("style"))
    .toMatch(/bunny-motion-01/);
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
  await expect(mascot.locator("img.bunny-art")).toBeVisible();
  await expect(mascot.locator(".bunny-frame")).toHaveCount(0);
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
  await expect(page.locator(".ddl-head img")).toHaveAttribute(
    "alt",
    "兔耳小桃",
  );
  await expect(page.locator(".ddl-head")).not.toContainText("优先采用");
  await page.screenshot({
    path: info.outputPath("bunny-ddl.png"),
    fullPage: true,
  });
});
