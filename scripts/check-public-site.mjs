import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../website/public/", import.meta.url));
const screenshotIndex = process.argv.indexOf("--screenshots");
const output =
  screenshotIndex === -1 ? null : process.argv[screenshotIndex + 1];
if (screenshotIndex !== -1 && !output)
  throw new Error("Supply a screenshot directory");
const files = new Map([
  ["/", "index.html"],
  ["/guide/", "guide/index.html"],
  ["/privacy/", "privacy/index.html"],
  ["/404.html", "404.html"],
  ["/assets/site.css", "assets/site.css"],
  ["/assets/icon.svg", "assets/icon.svg"],
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap.xml"],
]);
for (const relative of files.values()) await access(path.join(root, relative));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};
const server = createServer(async (req, res) => {
  try {
    const relative = files.get(new URL(req.url, "http://localhost").pathname);
    const status = relative ? 200 : 404;
    const target = relative || "404.html";
    res.writeHead(status, { "Content-Type": types[path.extname(target)] });
    res.end(await readFile(path.join(root, target)));
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push(r.url()));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin + "/"))
      errors.push("Unexpected external request: " + r.url());
  });
  if (output) await mkdir(path.resolve(output), { recursive: true });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1080 : 844 });
    for (const route of ["/", "/guide/", "/privacy/"]) {
      const response = await page.goto(origin + route, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      assert.equal(
        await page.locator('a[href="https://beian.miit.gov.cn/"]').count(),
        1,
      );
      assert.match(
        await page.locator("footer").innerText(),
        /豫ICP备2026057621号-1/,
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        route + " horizontal overflow at " + width,
      );
      assert.equal(
        await page.locator("script, form, input, iframe").count(),
        0,
      );
      for (const link of await page
        .locator("a[href]")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
        if (link.startsWith("/") && !link.startsWith("//")) {
          assert.equal(
            (await page.request.get(origin + link.split("#")[0])).status(),
            200,
            link,
          );
        }
      }
      if (route === "/" && width === 390) {
        await page.getByRole("link", { name: "看看它能做什么" }).click();
        assert.equal(new URL(page.url()).hash, "#features");
      }
      if (output && (route === "/" || width === 390)) {
        const name = route === "/" ? "home" : route.split("/")[1];
        await page.screenshot({
          path: path.join(path.resolve(output), `${name}-${width}.png`),
          fullPage: true,
        });
      }
      console.log(`Verified ${route} at ${width}px`);
    }
  }
  assert.equal((await page.request.get(origin + "/admin/")).status(), 404);
  assert.equal((await page.request.get(origin + "/api/")).status(), 404);
  assert.deepEqual(errors, []);
  console.log(
    "Public site: links, content, responsive layout and isolated browser checks passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
