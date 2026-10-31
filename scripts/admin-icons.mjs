import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
// Reuse the shipped Windows artwork exactly, including its rasterized Chinese glyph.
const desktop = (await readFile("public/desktop-icon.png")).toString("base64");
for (const [name, size] of [
  ["admin-touch-icon.png", 180],
  ["admin-icon-192.png", 192],
  ["admin-icon-512.png", 512],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256"><rect width="256" height="256" fill="#fff9e6"/><image href="data:image/png;base64,${desktop}" width="256" height="256"/></svg>`;
  await writeFile(`public/${name}`, new Resvg(svg).render().asPng());
}
