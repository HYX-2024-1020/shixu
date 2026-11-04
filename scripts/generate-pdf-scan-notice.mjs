import { readFile, writeFile } from "node:fs/promises";
import { decodeWebp } from "../server/reading/webp.mjs";
import { scannedPdfBytes } from "../server/reading/pdf-visual-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
const image = await decodeWebp(
  await readFile(
    new URL("../server/reading/fixtures/webp-notice.webp", import.meta.url),
  ),
  1,
);
const pixels = Buffer.alloc(image.width * image.height * 3);
for (let n = 0; n < image.width * image.height; n++)
  image.pixels.copy(pixels, n * 3, n * 4, n * 4 + 3);
const body = scannedPdfBytes([
  { width: image.width, height: image.height, pixels },
]);
await writeFile(
  new URL("../server/reading/fixtures/pdf-scan-notice.pdf", import.meta.url),
  body,
);
console.log(
  JSON.stringify({
    synthetic: true,
    inputHash: sha256(body),
    renderPixelsHash: sha256(image.pixels),
    width: image.width,
    height: image.height,
  }),
);
