// Optional independent browser oracle. Project-authored fixtures, headless only.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const server = createServer((request, response) =>
  response.end("<!doctype html>"),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.CI ? undefined : "msedge",
    headless: true,
  });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port);
  const report = {
    generator:
      "Edge/Chromium " +
      browser.version() +
      " ImageDecoder + canvas white composite",
    synthetic: true,
    files: {},
  };
  for (const name of ["apng-animation.png", "apng-poster.png"]) {
    const bytes = await readFile(
        new URL("../server/reading/fixtures/" + name, import.meta.url),
      ),
      poster = name.includes("poster");
    const frames = await page.evaluate(
      async ({ base64, poster }) => {
        const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
          out = [];
        for (const preferAnimation of [true]) {
          const decoder = new ImageDecoder({
            data,
            type: "image/png",
            preferAnimation,
          });
          await decoder.tracks.ready;
          for (let i = 0; i < decoder.tracks.selectedTrack.frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            const canvas = new OffscreenCanvas(
                image.displayWidth,
                image.displayHeight,
              ),
              ctx = canvas.getContext("2d");
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0);
            out.push({
              pixels: [
                ...ctx.getImageData(0, 0, canvas.width, canvas.height).data,
              ],
              delayMs: preferAnimation ? image.duration / 1000 : 0,
            });
            image.close();
          }
          decoder.close();
        }
        return out;
      },
      { base64: bytes.toString("base64"), poster },
    );
    const result = frames.map((f) => ({
      pixelsHash: hash(Buffer.from(f.pixels)),
      delayMs: f.delayMs,
    }));
    if (poster) {
      const pillow = JSON.parse(
        await readFile(
          new URL(
            "../server/reading/fixtures/apng-pillow-observed.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ).files[name];
      if (pillow.sha256 !== hash(bytes)) throw Error("POSTER_SOURCE_CHANGED");
      result.unshift({ pixelsHash: pillow.frames[0].pixelsHash, delayMs: 0 });
    }
    report.files[name] = {
      sha256: hash(bytes),
      poster,
      loops: 2,
      posterOracle: poster
        ? "Pillow opaque static image, no animation compositing"
        : null,
      frames: result.map((f, i) => ({ frame: i + 1, ...f })),
    };
  }
  await writeFile(
    new URL("../server/reading/fixtures/apng-goldens.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
