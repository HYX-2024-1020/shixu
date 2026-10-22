import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "msedge",
  headless: true,
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(process.env.APP_URL || "http://localhost:4173");
  await page.waitForSelector(".bucket-composer");
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Service worker timeout")), 20000),
      ),
    ]);
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Service worker control timeout")),
          10000,
        );
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector(".bucket-composer");
  await page.getByLabel("往桶里放入内容").fill("明天提交离线测试作业");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page.locator(".packet-pending").waitFor();
  await page.reload();
  await page.locator(".packet-pending").waitFor();
  await page.getByRole("button", { name: "原文与附件" }).click();
  assert.match(
    await page.locator(".packet-source").innerText(),
    /明天提交离线测试作业/,
  );
  assert.equal(await page.locator(".bucket-item").count(), 0);
  console.log(
    "PASS: production app reloads offline and preserves the original pending input without pretending to run AI",
  );
} finally {
  await browser.close();
}
