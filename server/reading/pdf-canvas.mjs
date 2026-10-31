import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sha256 } from "./material.mjs";

export const directory = new URL(
  `./generated-pdf-visual/${process.platform}-${process.arch}/`,
  import.meta.url,
);
const require = createRequire(import.meta.url);
let verified;
try {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", directory)),
  );
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
  ];
  if (
    manifest.protocol !== "shixu-pdf-visual/1" ||
    manifest.platform !== process.platform + "-" + process.arch ||
    manifest.pdfjs !== "6.2.108" ||
    manifest.canvas !== "1.0.13" ||
    Object.keys(manifest.files).sort().join() !== names.sort().join()
  )
    throw Error();
  for (const name of names)
    if (
      sha256(await readFile(new URL(name, directory))) !== manifest.files[name]
    )
      throw Error();
  verified = require(fileURLToPath(new URL("canvas.cjs", directory)));
} catch {
  throw Error("PDF_VISUAL_TOOL_UNSUPPORTED");
}
export const canvas = verified;

export class BoundedCanvasFactory {
  constructor() {
    this.pixels = 0;
    this.sizes = new WeakMap();
  }
  create(width, height) {
    this.check(width, height);
    const image = canvas.createCanvas(width, height),
      result = { canvas: image, context: image.getContext("2d") };
    this.sizes.set(result, width * height);
    this.pixels += width * height;
    return result;
  }
  check(width, height, previous = 0) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 16384 ||
      height > 16384 ||
      this.pixels - previous + width * height > 32_000_000
    )
      throw Error("PDF_VISUAL_PIXEL_LIMIT");
  }
  reset(target, width, height) {
    const previous = this.sizes.get(target);
    if (previous === undefined) throw Error("PDF_VISUAL_CANVAS_INVALID");
    this.check(width, height, previous);
    target.canvas.width = width;
    target.canvas.height = height;
    this.pixels += width * height - previous;
    this.sizes.set(target, width * height);
  }
  destroy(target) {
    const previous = this.sizes.get(target);
    if (previous === undefined) return;
    target.canvas.width = 0;
    target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
    this.pixels -= previous;
    this.sizes.delete(target);
  }
}
