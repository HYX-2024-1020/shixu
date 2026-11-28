import encode from "./fixtures/jpeg-encoder.cjs";
export function jpegApp(marker, body) {
  const out = Buffer.alloc(body.length + 4);
  out[0] = 255;
  out[1] = marker;
  out.writeUInt16BE(body.length + 2, 2);
  body.copy(out, 4);
  return out;
}
export function jpegExif(orientation = 1, bigEndian = false) {
  const t = Buffer.alloc(26);
  t.write(bigEndian ? "MM" : "II");
  const u16 = (p, v) =>
    bigEndian ? t.writeUInt16BE(v, p) : t.writeUInt16LE(v, p);
  const u32 = (p, v) =>
    bigEndian ? t.writeUInt32BE(v, p) : t.writeUInt32LE(v, p);
  u16(2, 42);
  u32(4, 8);
  u16(8, 1);
  u16(10, 0x112);
  u16(12, 3);
  u32(14, 1);
  u16(18, orientation);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
}
export function jpegSample({
  width = 19,
  height = 11,
  orientation = 1,
  bigEndian = false,
  quality = 95,
} = {}) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels[p] = (Math.floor(x / 4) * 17) % 256;
      pixels[p + 1] = (Math.floor(y / 4) * 23) % 256;
      pixels[p + 2] = (x * 7 + y * 11) % 256;
      pixels[p + 3] = 255;
    }
  const plain = encode({ width, height, data: pixels }, quality).data;
  const body = Buffer.concat([
    plain.subarray(0, 2),
    jpegApp(0xe1, jpegExif(orientation, bigEndian)),
    plain.subarray(2),
  ]);
  return { body, plain, pixels, width, height, orientation };
}
