import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
const png = new Resvg(await readFile("public/desktop-icon.svg"))
  .render()
  .asPng();
await writeFile("public/desktop-icon.png", png);
// A PNG-backed 256px ICO directory, supported by current Windows versions.
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("public/desktop-icon.ico", Buffer.concat([header, png]));
