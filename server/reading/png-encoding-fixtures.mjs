// Project-authored samples. Pass ownership follows the public PNG Figure 4.8
// matrix, deliberately independent of the decoder's start/step table.
import { deflateSync } from "node:zlib";
import { pngCrc } from "./image.mjs";
const owners = [
  [1, 6, 4, 6, 2, 6, 4, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [5, 6, 5, 6, 5, 6, 5, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [3, 6, 4, 6, 3, 6, 4, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [5, 6, 5, 6, 5, 6, 5, 6],
  [7, 7, 7, 7, 7, 7, 7, 7],
];
function chunk(type, body) {
  const b = Buffer.alloc(body.length + 12);
  b.writeUInt32BE(body.length);
  b.write(type, 4);
  body.copy(b, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
  return b;
}
const paeth = (a, b, c) => {
  const p = a + b - c,
    da = Math.abs(p - a),
    db = Math.abs(p - b),
    dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
};
export function encodingPng({
  width = 19,
  height = 11,
  depth = 2,
  color = 0,
  interlace = 1,
  transparency = false,
  filterMode = true,
} = {}) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color],
    mask = (1 << depth) - 1;
  const palette = Buffer.from(
    Array.from(
      { length: 3 * Math.min(16, mask + 1) },
      (_, i) => (i * 53) % 256,
    ),
  );
  const alpha = Buffer.from([255, 0, 255, 255]);
  const sample = (x, y) => {
    if (depth === 16) {
      // Exact 8->16 replication makes native 8-bit decoders an independent
      // oracle; arbitrary low-bit precision/rounding has separate goldens.
      const gray = ((x * 37 + y * 23) % 256) * 257;
      const a = transparency ? ((x + y) % 2) * 65535 : 65535;
      if (color === 0) return [gray];
      if (color === 4) return [gray, a];
      return [(x * 37 % 256) * 257, (y * 41 % 256) * 257,
        ((x * 13 + y * 7) % 256) * 257, ...(color === 6 ? [a] : [])];
    }
    if (color === 0 || color === 3)
      return [(x + 3 * y) % (color === 3 ? palette.length / 3 : mask + 1)];
    if (color === 4)
      return [
        (x * 37 + y * 23) % 256,
        transparency ? ((x + y) % 2) * 255 : 255,
      ];
    return [
      (x * 37) % 256,
      (y * 41) % 256,
      (x * 13 + y * 7) % 256,
      ...(color === 6 ? [transparency ? ((x + y) % 2) * 255 : 255] : []),
    ];
  };
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const values = sample(x, y);
      if (depth === 16) for (let i = 0; i < values.length; i++) values[i] /= 257;
      let r,
        g,
        b,
        a = 255;
      if (color === 0) {
        r = g = b = (values[0] * 255) / (depth === 16 ? 255 : mask);
        if (transparency && values[0] === 1) a = 0;
      } else if (color === 3) {
        [r, g, b] = palette.subarray(values[0] * 3, values[0] * 3 + 3);
        a = transparency ? (alpha[values[0]] ?? 255) : 255;
      } else if (color === 4) {
        r = g = b = values[0];
        a = values[1];
      } else {
        [r, g, b] = values;
        if (color === 6) a = values[3];
      }
      const i = (y * width + x) * 4;
      pixels[i] = Math.round((r * a + 255 * (255 - a)) / 255);
      pixels[i + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
      pixels[i + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
      pixels[i + 3] = 255;
    }
  const rows = [];
  for (let pass = 1; pass <= (interlace ? 7 : 1); pass++) {
    let previous;
    for (let y = 0; y < height; y++) {
      const values = [];
      for (let x = 0; x < width; x++)
        if (!interlace || owners[y % 8][x % 8] === pass)
          values.push(...sample(x, y));
      if (!values.length) continue;
      const row = Buffer.alloc(Math.ceil((values.length * depth) / 8));
      values.forEach((v, i) => {
        if (depth === 8) row[i] = v;
        else if (depth === 16) row.writeUInt16BE(v, i * 2);
        else
          row[Math.floor((i * depth) / 8)] |=
            v << (8 - depth - ((i * depth) % 8));
      });
      // Nonzero padding checks that unused low bits never become pixels.
      if ((values.length * depth) % 8)
        row[row.length - 1] |= (1 << (8 - ((values.length * depth) % 8))) - 1;
      const filter = filterMode ? (y + pass) % 5 : 0,
        out = Buffer.alloc(row.length + 1),
        bpp = Math.max(1, Math.ceil((channels * depth) / 8));
      out[0] = filter;
      for (let i = 0; i < row.length; i++) {
        const a = row[i - bpp] || 0,
          b = previous?.[i] || 0,
          c = previous?.[i - bpp] || 0;
        out[i + 1] =
          (row[i] -
            [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
          255;
      }
      previous = row;
      rows.push(out);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = color;
  header[12] = interlace;
  const raw = Buffer.concat(rows),
    extras = [];
  if (color === 3) extras.push(chunk("PLTE", palette));
  if (transparency && color === 3)
    extras.push(chunk("tRNS", alpha.subarray(0, palette.length / 3)));
  if (transparency && color === 0)
    extras.push(chunk("tRNS", Buffer.from([depth === 16 ? 1 : 0, 1])));
  const body = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    ...extras,
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { body, pixels, width, height, raw };
}
