import { chromium } from "playwright";
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "msedge",
  headless: true,
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(process.env.APP_URL || "http://localhost:4173");
  await page.waitForSelector(".welcome-card");
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  page.on("requestfailed", (request) =>
    console.log("Failed request:", request.url(), request.failure()?.errorText),
  );
  page.on("console", (message) => {
    if (message.type() === "error") console.log("Console:", message.text());
  });
  console.log("Production homepage loaded");
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Service worker install timeout")),
          20000,
        ),
      ),
    ]);
    if (!navigator.serviceWorker.controller)
      await Promise.race([
        new Promise((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            resolve,
            { once: true },
          ),
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Service worker control timeout")),
            10000,
          ),
        ),
      ]);
  });
  console.log("Service worker installed and controlling");
  await context.setOffline(true);
  await page.reload();
  try {
    await page.waitForSelector(".welcome-card", { timeout: 10000 });
  } catch (error) {
    console.log("Offline HTML:", (await page.content()).slice(0, 1600));
    console.log(
      "Cache entries:",
      await page.evaluate(async () => {
        const names = await caches.keys();
        return Promise.all(
          names.map(async (name) => ({
            name,
            urls: (await (await caches.open(name)).keys()).map((r) => r.url),
          })),
        );
      }),
    );
    throw error;
  }
  await page.getByRole("button", { name: "新建记录" }).click();
  await page.getByLabel("待整理的内容").fill("明天提交离线测试作业");
  await page.getByRole("button", { name: "本机提取整理", exact: true }).click();
  await page.getByRole("button", { name: "确认并收纳", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload();
  await page.getByLabel("搜索全部事项").fill("离线测试");
  await page.locator(".entry-row").waitFor();
  console.log(
    "PASS: fully offline reload, lazy capture, saving and persistence",
  );
} finally {
  await browser.close();
}
