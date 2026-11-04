import { encodePng, pngCrc } from "./image.mjs";
export function apngChunk(type, body) {
  const b = Buffer.alloc(body.length + 12);
  b.writeUInt32BE(body.length);
  b.write(type, 4);
  body.copy(b, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
  return b;
}
export function pngChunks(bytes) {
  const result = [];
  for (let p = 8; p < bytes.length; ) {
    const n = bytes.readUInt32BE(p),
      type = bytes.toString("ascii", p + 4, p + 8);
    result.push({ type, body: bytes.subarray(p + 8, p + 8 + n) });
    p += n + 12;
  }
  return result;
}
export function apngBytes({
  width = 2,
  height = 1,
  frames = [{}],
  poster,
  loops = 0,
} = {}) {
  const png = (f) =>
    f.png ||
    encodePng(
      f.width || width,
      f.height || height,
      f.pixels ||
        Buffer.alloc((f.width || width) * (f.height || height) * 4, 255),
    );
  const first = png(poster || frames[0]),
    header = pngChunks(first).find((c) => c.type === "IHDR").body,
    actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length);
  actl.writeUInt32BE(loops, 4);
  const out = [
    first.subarray(0, 8),
    apngChunk("IHDR", header),
    ...pngChunks(first)
      .filter((c) => ["PLTE", "tRNS", "gAMA", "sRGB"].includes(c.type))
      .map((c) => apngChunk(c.type, c.body)),
    apngChunk("acTL", actl),
  ];
  let seq = 0;
  if (poster)
    out.push(
      ...pngChunks(first)
        .filter((c) => c.type === "IDAT")
        .map((c) => apngChunk(c.type, c.body)),
    );
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i],
      control = Buffer.alloc(26);
    control.writeUInt32BE(seq++);
    control.writeUInt32BE(f.width || width, 4);
    control.writeUInt32BE(f.height || height, 8);
    control.writeUInt32BE(f.x || 0, 12);
    control.writeUInt32BE(f.y || 0, 16);
    control.writeUInt16BE(f.delayNum ?? 1, 20);
    control.writeUInt16BE(f.delayDen ?? 10, 22);
    control[24] = f.disposal || 0;
    control[25] = f.blend || 0;
    out.push(apngChunk("fcTL", control));
    for (const c of pngChunks(png(f)).filter((c) => c.type === "IDAT")) {
      if (i === 0 && !poster) out.push(apngChunk("IDAT", c.body));
      else {
        const data = Buffer.alloc(c.body.length + 4);
        data.writeUInt32BE(seq++);
        c.body.copy(data, 4);
        out.push(apngChunk("fdAT", data));
      }
    }
  }
  out.push(apngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(out);
}
