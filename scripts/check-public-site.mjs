import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../website/public/", import.meta.url));
const config = await readFile(
  new URL("../deploy/website/nginx.conf", import.meta.url),
  "utf8",
);
const csp = config.match(
  /add_header Content-Security-Policy "([^"]+)" always;/,
)?.[1];
assert(csp, "Validate with the actual production CSP");
const flow = [
  ["flow-catch", "panel-catch"],
  ["flow-world", "panel-world"],
  ["flow-check", "panel-check"],
  ["flow-ddl", "panel-ddl"],
];
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
    res.writeHead(status, {
      "Content-Type": types[path.extname(target)],
      "Content-Security-Policy": csp,
      "Cache-Control": "no-cache",
    });
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
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) => errors.push(r.url()));
  page.on("request", (r) => {
    if (!r.url().startsWith(origin + "/"))
      errors.push("Unexpected external request: " + r.url());
  });
  if (output) await mkdir(path.resolve(output), { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1080 : 844 });
    for (const route of ["/", "/guide/", "/privacy/", "/404.html"]) {
      const response = await page.goto(origin + route, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator("main").count(), 1);
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      if (route !== "/404.html") {
        assert.equal(
          await page.locator('a[href="https://beian.miit.gov.cn/"]').count(),
          1,
        );
        assert.match(
          await page.locator("footer").innerText(),
          /豫ICP备2026057621号-1/,
        );
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        route + " horizontal overflow at " + width,
      );
      assert.equal(
        await page.locator("script, form, iframe, style, [style]").count(),
        0,
      );
      const controls = await page
        .locator("input, button, textarea, select")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            tag: n.tagName,
            type: n.getAttribute("type"),
            id: n.id,
            name: n.getAttribute("name"),
          })),
        );
      // Only these exact four browser-local CSS demo radios are permitted.
      assert.deepEqual(
        controls,
        route === "/"
          ? flow.map(([id]) => ({
              tag: "INPUT",
              type: "radio",
              id,
              name: "flow",
            }))
          : [],
      );
      assert.equal(await page.locator('img[src*="anime-hero"]').count(), 0);
      assert(
        await page
          .locator("img")
          .evaluateAll((nodes) =>
            nodes.every((n) => n.complete && n.naturalWidth > 0),
          ),
      );
      for (const link of await page
        .locator("a[href]")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")))) {
        if (
          (link.startsWith("/") && !link.startsWith("//")) ||
          link.startsWith("#")
        ) {
          const url = new URL(link, origin + route);
          const linked = await page.request.get(url.origin + url.pathname);
          assert.equal(linked.status(), 200, link);
          if (url.hash)
            assert(
              await page.evaluate(
                ({ html, id }) =>
                  !!new DOMParser()
                    .parseFromString(html, "text/html")
                    .getElementById(id),
                {
                  html: await linked.text(),
                  id: decodeURIComponent(url.hash.slice(1)),
                },
              ),
              link,
            );
        }
      }
      if (route === "/" && width === 390) {
        await page.locator('a[href="#flow-lab"]').click();
        assert.equal(new URL(page.url()).hash, "#flow-lab");
        await page.evaluate(() => window.scrollTo(0, 0));
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
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  for (const [id, panel] of flow) {
    await page.locator(`label[for="${id}"]`).click();
    assert(await page.locator("#" + id).isChecked());
    await page.waitForFunction((name) => {
      const visible = [...document.querySelectorAll(".flow-panel")].filter(
        (p) =>
          getComputedStyle(p).visibility === "visible" &&
          getComputedStyle(p).opacity === "1",
      );
      return visible.length === 1 && visible[0].classList.contains(name);
    }, panel);
  }
  await page.locator('label[for="flow-catch"]').click();
  await page.locator("#flow-catch").focus();
  for (const [id] of flow.slice(1)) {
    await page.keyboard.press("ArrowRight");
    assert(await page.locator("#" + id).isChecked());
  }
  assert(
    await page
      .locator(".ice-stack i")
      .first()
      .evaluate(
        (el) => parseFloat(getComputedStyle(el).animationDuration) <= 0.001,
      ),
    "Respect reduced motion",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert(
    await page
      .locator(".ice-stack i")
      .first()
      .evaluate(
        (el) =>
          getComputedStyle(el).animationName !== "none" &&
          getComputedStyle(el).animationPlayState === "running",
      ),
  );
  assert.equal((await page.request.get(origin + "/admin/")).status(), 404);
  assert.equal((await page.request.get(origin + "/api/")).status(), 404);
  assert.deepEqual(errors, []);
  console.log(
    "Public site: four pages, links, responsive layout, exact CSS demo controls, keyboard, motion and production CSP passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
