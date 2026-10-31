import test from "node:test";
import assert from "node:assert/strict";
import { readMaterial, sha256 } from "./material.mjs";
import { readPdfVisual, validatePdfVisualWindow } from "./pdf-visual.mjs";
import { scanPattern, scannedPdfBytes } from "./pdf-visual-fixtures.mjs";
import { decodePng } from "./image.mjs";
import { ReadingWindows } from "./windows.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import {
  FIRST_ARCHIVE_WINDOW,
  validateArchiveWindow,
} from "./archive-window.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
import { readFile } from "node:fs/promises";
import { mkdtemp, copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { decodeJpeg } from "./jpeg.mjs";

const descriptor = (body, name = "scan.pdf") => ({
  id: "scan",
  name,
  body,
  size: body.length,
  hash: sha256(body),
});
const parse = (body, pdfVisualWindow = { page: 1, tile: 1, offset: 0 }) =>
  readMaterial(descriptor(body), { pdfVisualWindow });
const rgba = (scan, rotation = 0, crop) => {
  const width = crop?.width || (rotation % 180 ? scan.height : scan.width),
    height = crop?.height || (rotation % 180 ? scan.width : scan.height);
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sx = x,
        sy = y;
      if (rotation === 90) {
        sx = y;
        sy = scan.height - 1 - x;
      }
      if (rotation === 180) {
        sx = scan.width - 1 - x;
        sy = scan.height - 1 - y;
      }
      if (rotation === 270) {
        sx = scan.width - 1 - y;
        sy = x;
      }
      if (crop) {
        sx += crop.x;
        sy += crop.y;
      }
      scan.pixels.copy(
        pixels,
        (y * width + x) * 4,
        (sy * scan.width + sx) * 3,
        (sy * scan.width + sx) * 3 + 3,
      );
    }
  return { width, height, pixels };
};
test("scanned page rendering matches every independently specified RGB pixel under all rotations and CropBox", async () => {
  for (const scan of [scanPattern(), scanPattern(23, 17)])
    for (const rotation of [0, 90, 180, 270]) {
      const m = await parse(scannedPdfBytes([{ ...scan, rotation }]));
      ReadingWindows.prototype.verifyPdfVisual(m, {
        page: 1,
        tile: 1,
        offset: 0,
      });
      assert.equal(m.state, "read");
      assert.equal(m.segments.length, 1);
      const actual = decodePng(Buffer.from(m.segments[0].image.data, "base64")),
        expected = rgba(scan, rotation);
      assert.equal(actual.width, expected.width);
      assert.equal(actual.height, expected.height);
      assert.deepEqual(actual.pixels, expected.pixels);
    }
  const scan = scanPattern();
  const crop = await parse(
    scannedPdfBytes([{ ...scan, cropBox: [16, 8, 48, 32] }]),
  );
  const expected = rgba(scan, 0, { x: 24, y: 12, width: 48, height: 36 });
  assert.deepEqual(
    decodePng(Buffer.from(crop.segments[0].image.data, "base64")).pixels,
    expected.pixels,
  );
});

test("multi-tile scanned pages and the ZIP trailing member retain complete ordered pixels and strict cursors", async () => {
  const scan = scanPattern(1536, 768),
    tail = scanPattern(96, 60),
    pdf = scannedPdfBytes([scan, tail]);
  const body = zipBytes({
    "扫描/通知.pdf": pdf,
    "尾件.txt": Buffer.from("尾部唯一标记"),
  });
  let cursor = validateArchiveWindow({
      ...FIRST_ARCHIVE_WINDOW,
      tile: 1,
      visual: 1,
    }),
    n = 0,
    text = "";
  const pixels = Buffer.alloc(scan.width * scan.height * 4),
    seen = [];
  do {
    const m = await readMaterial(descriptor(body, "scan.zip"), {
      archiveWindow: cursor,
    });
    ReadingWindows.prototype.verifyArchive.call(
      ReadingWindows.prototype,
      m,
      cursor,
    );
    for (const segment of m.segments) {
      if (segment.image) {
        const r = segment.range,
          actual = decodePng(Buffer.from(segment.image.data, "base64"));
        seen.push([r.archivePath, r.page, r.tile]);
        if (r.page === 1)
          for (let y = 0; y < r.height; y++)
            actual.pixels.copy(
              pixels,
              ((y + r.y) * scan.width + r.x) * 4,
              y * r.width * 4,
              (y + 1) * r.width * 4,
            );
        else assert.deepEqual(actual.pixels, rgba(tail).pixels);
      } else text += segment.text;
    }
    cursor = m.archivePagination.next;
    assert.ok(++n <= 4);
  } while (cursor);
  assert.equal(n, 4);
  assert.deepEqual(pixels, rgba(scan).pixels);
  assert.equal(text, "尾部唯一标记");
  assert.deepEqual(seen, [
    ["扫描/通知.pdf", 1, 1],
    ["扫描/通知.pdf", 1, 2],
    ["扫描/通知.pdf", 2, 1],
  ]);
  const material = await parse(pdf);
  const forged = structuredClone(material);
  forged.pdfVisualPagination.next.page = 2;
  assert.throws(
    () =>
      ReadingWindows.prototype.verifyPdfVisual(forged, {
        page: 1,
        tile: 1,
        offset: 0,
      }),
    /INVALID_READER_WINDOW/,
  );
  assert.throws(
    () =>
      validatePdfVisualWindow({
        page: 1,
        tile: 1,
        offset: 0,
        path: "/etc/passwd",
      }),
    /INVALID_PDF_VISUAL_WINDOW/,
  );
});

test("broken raster pages and missing font outlines remain unread while later complete scans are reachable", async () => {
  const body = scannedPdfBytes([
    { ...scanPattern(), broken: true },
    scanPattern(),
  ]);
  const first = await parse(body);
  assert.equal(first.segments.length, 0);
  assert.equal(first.pdfVisualPagination.failedPage, true);
  assert.ok(
    first.reasons.includes("PDF_VISUAL_RENDER_WARNING") ||
      first.reasons.includes("PDF_VISUAL_RENDER_FAILED") ||
      first.reasons.includes("PDF_VISUAL_RGB_BOUNDS"),
  );
  ReadingWindows.prototype.verifyPdfVisual(first, {
    page: 1,
    tile: 1,
    offset: 0,
  });
  const second = await parse(body, first.pdfVisualPagination.next);
  assert.equal(second.state, "read");
  assert.equal(second.covered[0].page, 2);
  const fontPdf = Buffer.from(
    pdfBytes([{ text: "合成缺失字体文字" }])
      .toString("latin1")
      .replace("/MediaBox [0 0 10000 10000]", "/MediaBox [0 0 00100 00100]")
      .replace(" 9000 Tm", " 0090 Tm")
      .replace("/F1 12 Tf", "/F1 05 Tf"),
    "latin1",
  );
  const font = await parse(fontPdf);
  assert.equal(
    font.segments.some((s) => s.image),
    false,
  );
  assert.ok(font.segments.some((s) => s.text.includes("合成缺失字体文字")));
  assert.ok(font.reasons.includes("PDF_VISUAL_FONT_UNSUPPORTED"));
  ReadingWindows.prototype.verifyPdfVisual(font, {
    page: 1,
    tile: 1,
    offset: 0,
  });
});

test("oversized page surfaces and aggregate native canvas allocations fail before unbounded rendering", async () => {
  const huge = await parse(pdfBytes([{ text: "" }]));
  assert.ok(huge.reasons.includes("PDF_VISUAL_PIXEL_LIMIT"));
  assert.equal(huge.segments.length, 0);
  const { BoundedCanvasFactory, canvas } = await import("./pdf-canvas.mjs"),
    factory = new BoundedCanvasFactory();
  assert.equal(
    canvas.GlobalFonts.families.length,
    0,
    "no system or user font family loaded",
  );
  const surface = factory.create(4096, 4096);
  try {
    assert.throws(() => factory.create(4096, 4096), /PDF_VISUAL_PIXEL_LIMIT/);
    assert.throws(
      () => factory.reset(surface, 16385, 1),
      /PDF_VISUAL_PIXEL_LIMIT/,
    );
  } finally {
    factory.destroy(surface);
  }
  assert.equal(factory.pixels, 0);
});

test("PDF progressive and restart JPEG scans match the independent Pillow/libjpeg full-pixel golden", async () => {
  for (const name of ["progressive", "restart"]) {
    const jpeg = await readFile(
      new URL(`./fixtures/jpeg-${name}.jpg`, import.meta.url),
    );
    const golden = JSON.parse(
      await readFile(new URL(`./fixtures/jpeg-${name}.json`, import.meta.url)),
    );
    const m = await parse(
      scannedPdfBytes([{ width: golden.width, height: golden.height, jpeg }]),
    );
    assert.equal(m.state, "read");
    const actual = decodePng(
        Buffer.from(m.segments[0].image.data, "base64"),
      ).pixels,
      expected = Buffer.from(golden.pixelsHex, "hex");
    let max = 0,
      sum = 0;
    for (let n = 0; n < actual.length; n++) {
      const delta = Math.abs(actual[n] - expected[n]);
      max = Math.max(max, delta);
      sum += delta;
    }
    assert.ok(max <= 3, `JPEG ${name}: maximum pixel-channel error ${max}`);
    assert.ok(sum / actual.length < 0.5);
    const damaged = Buffer.concat([
      jpeg.subarray(0, -2),
      Buffer.from([0, 255, 217]),
    ]);
    const rejected = await parse(
      scannedPdfBytes([
        { width: golden.width, height: golden.height, jpeg: damaged },
      ]),
    );
    assert.equal(
      rejected.segments.some((s) => s.image),
      false,
    );
  }
});

test("missing or mismatched fixed PDF tools fail closed without loading a host canvas package", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-pdf-tool-"));
  try {
    for (const name of [
      "pdf-canvas.mjs",
      "material.mjs",
      "image.mjs",
      "archive-window.mjs",
      "pdf-window.mjs",
      "pdf-visual.mjs",
      "office-window.mjs",
    ])
      await copyFile(new URL(name, import.meta.url), join(directory, name));
    await assert.rejects(
      import(pathToFileURL(join(directory, "pdf-canvas.mjs"))),
      /PDF_VISUAL_TOOL_UNSUPPORTED/,
    );
    const generated = join(
      directory,
      "generated-pdf-visual",
      process.platform + "-" + process.arch,
    );
    await mkdir(generated, { recursive: true });
    const names = [
        "canvas.cjs",
        "skia.node",
        ...(process.platform === "win32" ? ["icudtl.dat"] : []),
        "sbom.cdx.json",
        "canvas.LICENSE",
        "pdf.LICENSE",
        "third-party.LICENSE",
        "api.mjs",
        "core.mjs",
      ],
      files = {};
    for (const name of names) {
      const body = Buffer.from(
        name === "canvas.cjs"
          ? "globalThis.__shixuBadPdfCanvas=true;module.exports={};"
          : "invalid fixed tool",
      );
      await writeFile(join(generated, name), body);
      files[name] = sha256(body);
    }
    files["api.mjs"] = "0".repeat(64);
    await writeFile(
      join(generated, "manifest.json"),
      JSON.stringify({
        protocol: "shixu-pdf-visual/1",
        platform: process.platform + "-" + process.arch,
        pdfjs: "6.2.108",
        canvas: "1.0.13",
        files,
      }),
    );
    await copyFile(
      new URL("pdf-canvas.mjs", import.meta.url),
      join(directory, "second-canvas.mjs"),
    );
    await assert.rejects(
      import(pathToFileURL(join(directory, "second-canvas.mjs"))),
      /PDF_VISUAL_TOOL_UNSUPPORTED/,
    );
    assert.equal(globalThis.__shixuBadPdfCanvas, undefined);
  } finally {
    assert.ok(directory.includes("shixu-pdf-tool-"));
    await rm(directory, { recursive: true, force: true });
  }
});
