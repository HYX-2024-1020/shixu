import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// The shipped desktop's own vector design and the Windows system glyph.
// Rasterize each taskbar/DPI size independently instead of scaling one PNG.
const source = readFileSync("public/console-icon.svg", "utf8");
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const frames = sizes.map((size) =>
  new Resvg(source, {
    font: {
      fontFiles: [join(process.env.WINDIR || "C:/Windows", "Fonts/msyhbd.ttc")],
      loadSystemFonts: false,
      defaultFontFamily: "Microsoft YaHei",
    },
    fitTo: { mode: "width", value: size },
  })
    .render()
    .asPng(),
);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const at = 6 + 16 * i;
  header[at] = header[at + 1] = sizes[i] === 256 ? 0 : sizes[i];
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(frames[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += frames[i].length;
}
writeFileSync("public/console-xu-v2.ico", Buffer.concat([header, ...frames]));
