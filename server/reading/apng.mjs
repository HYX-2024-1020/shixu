// Project-authored PNG Third Edition animation reader. No renderer or URL loader.
import { decodePng, pngCrc } from "./image.mjs";
export const APNG_READER_VERSION = "apng-composited-tiles/1";
const signature = Buffer.from("89504e470d0a1a0a", "hex");
const bad = () => {
  throw Error("APNG_MALFORMED");
};
function chunk(type, body) {
  const b = Buffer.alloc(body.length + 12);
  b.writeUInt32BE(body.length);
  b.write(type, 4, "ascii");
  body.copy(b, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
  return b;
}
// CRC/order validation is unconditional, even on frames after the selected one.
// Only references into the bounded original and one compositing canvas persist.
export function inspectApng(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw Error("FORMAT_MISMATCH");
  let offset = 8,
    header,
    control,
    frame,
    sequence = 0,
    idat = false,
    idatClosed = false,
    ended = false,
    at = 0,
    count = 0;
  const base = [],
    globals = [],
    frames = [];
  while (offset < bytes.length) {
    if (++count > 10000) throw Error("APNG_RESOURCE_LIMIT");
    if (offset + 12 > bytes.length) bad();
    const size = bytes.readUInt32BE(offset),
      end = offset + size + 12;
    if (end > bytes.length) bad();
    const type = bytes.toString("latin1", offset + 4, offset + 8),
      body = bytes.subarray(offset + 8, end - 4),
      raw = bytes.subarray(offset, end);
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      pngCrc(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
    )
      bad();
    if (!header && type !== "IHDR") bad();
    if (type === "IHDR") {
      if (header || offset !== 8 || size !== 13) bad();
      header = body;
      const w = header.readUInt32BE(0),
        h = header.readUInt32BE(4);
      if (!w || !h || w > 16384 || h > 16384 || w * h > 32000000)
        throw Error("IMAGE_PIXEL_LIMIT");
    }
    if (type === "acTL") {
      if (control || idat || size !== 8) bad();
      control = { frames: body.readUInt32BE(0), loops: body.readUInt32BE(4) };
      if (!control.frames) bad();
      if (control.frames > 64) throw Error("APNG_RESOURCE_LIMIT");
    } else if (type === "fcTL") {
      if (
        !control ||
        size !== 26 ||
        body.readUInt32BE(0) !== sequence++ ||
        (frame && !frame.data.length)
      )
        bad();
      const width = body.readUInt32BE(4),
        height = body.readUInt32BE(8),
        x = body.readUInt32BE(12),
        y = body.readUInt32BE(16),
        delayNum = body.readUInt16BE(20),
        delayDen = body.readUInt16BE(22),
        disposal = body[24],
        blend = body[25];
      if (
        !width ||
        !height ||
        x + width > header.readUInt32BE(0) ||
        y + height > header.readUInt32BE(4) ||
        disposal > 2 ||
        blend > 1
      )
        bad();
      if (
        !idat &&
        (frames.length ||
          x ||
          y ||
          width !== header.readUInt32BE(0) ||
          height !== header.readUInt32BE(4))
      )
        bad();
      frame = {
        width,
        height,
        x,
        y,
        delayNum,
        delayDen,
        delayMs: (1000 * delayNum) / (delayDen || 100),
        startMs: at,
        disposal,
        blend,
        defaultImage: !idat,
        data: [],
      };
      at += frame.delayMs;
      frames.push(frame);
      if (frames.length > control.frames) bad();
    } else if (type === "fdAT") {
      if (
        !idat ||
        !frame ||
        frame.defaultImage ||
        size < 4 ||
        body.readUInt32BE(0) !== sequence++
      )
        bad();
      idatClosed = true;
      frame.data.push(body.subarray(4));
    } else {
      base.push(raw);
      if (type === "IDAT") {
        if (!control || idatClosed) bad();
        idat = true;
        if (frame) {
          if (!frame.defaultImage) bad();
          frame.data.push(body);
        }
      } else {
        if (idat) idatClosed = true;
        if (type !== "IHDR" && type !== "IEND" && !idat) globals.push(raw);
        if (type === "IEND") {
          if (size || !idat || end !== bytes.length) bad();
          ended = true;
        }
      }
    }
    if (idat && type === "fcTL") idatClosed = true;
    offset = end;
  }
  if (
    !ended ||
    !control ||
    frames.length !== control.frames ||
    !frame?.data.length
  )
    bad();
  const width = header.readUInt32BE(0),
    height = header.readUInt32BE(4),
    poster = !frames[0].defaultImage,
    totalFrames = frames.length + Number(poster);
  if (width * height * totalFrames > 32000000)
    throw Error("APNG_RESOURCE_LIMIT");
  if (Math.ceil(width / 1024) * Math.ceil(height / 1024) * totalFrames > 64)
    throw Error("IMAGE_TILE_LIMIT");
  return {
    width,
    height,
    header,
    globals,
    frames,
    poster,
    totalFrames,
    base: Buffer.concat([signature, ...base]),
    durationMs: at,
    loops: control.loops,
  };
}
export function decodeApng(
  bytes,
  frameNumber = 1,
  parsed = inspectApng(bytes),
) {
  if (
    !Number.isSafeInteger(frameNumber) ||
    frameNumber < 1 ||
    frameNumber > parsed.totalFrames
  )
    throw Error("IMAGE_CURSOR_OUT_OF_RANGE");
  const { width, height, frames } = parsed;
  // Validate the default PNG stream (including inherited/unsupported metadata),
  // even when it is not in the animation. Read a separate poster as its own range.
  const defaultImage = decodePng(parsed.base, { preserveAlpha: true });
  let pixels = parsed.poster && frameNumber === 1 ? defaultImage.pixels : null;
  const canvas = Buffer.alloc(width * height * 4);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i],
      h = Buffer.from(parsed.header);
    h.writeUInt32BE(f.width);
    h.writeUInt32BE(f.height, 4);
    const source = f.defaultImage
      ? defaultImage.pixels
      : decodePng(
          Buffer.concat([
            signature,
            chunk("IHDR", h),
            ...parsed.globals,
            ...f.data.map((b) => chunk("IDAT", b)),
            chunk("IEND", Buffer.alloc(0)),
          ]),
          { preserveAlpha: true },
        ).pixels;
    const previous = f.disposal === 2 && i > 0 ? Buffer.from(canvas) : null;
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const s = (y * f.width + x) * 4,
          d = ((f.y + y) * width + f.x + x) * 4,
          a = source[s + 3],
          b = canvas[d + 3];
        if (f.blend === 0) {
          source.copy(canvas, d, s, s + 4);
          continue;
        }
        const alpha = a * 255 + b * (255 - a);
        for (let c = 0; c < 3; c++)
          canvas[d + c] = alpha
            ? Math.round(
                (source[s + c] * a * 255 + canvas[d + c] * b * (255 - a)) /
                  alpha,
              )
            : 0;
        canvas[d + 3] = Math.round(alpha / 255);
      }
    if (i + 1 + Number(parsed.poster) === frameNumber)
      pixels = Buffer.from(canvas);
    if (f.disposal === 1 || (f.disposal === 2 && i === 0)) {
      for (let y = 0; y < f.height; y++)
        canvas.fill(
          0,
          ((f.y + y) * width + f.x) * 4,
          ((f.y + y) * width + f.x + f.width) * 4,
        );
    } else if (previous) previous.copy(canvas);
  }
  for (let p = 0; p < pixels.length; p += 4) {
    const a = pixels[p + 3];
    for (let c = 0; c < 3; c++)
      pixels[p + c] = Math.round((pixels[p + c] * a + 255 * (255 - a)) / 255);
    pixels[p + 3] = 255;
  }
  const f = frames[frameNumber - 1 - Number(parsed.poster)],
    poster = parsed.poster && frameNumber === 1;
  return {
    width,
    height,
    pixels,
    frame: frameNumber,
    totalFrames: parsed.totalFrames,
    frameRole: poster ? "default" : "animation",
    frameStartMs: poster ? 0 : f.startMs,
    frameDurationMs: poster ? 0 : f.delayMs,
    frameDelayNum: poster ? 0 : f.delayNum,
    frameDelayDen: poster ? 1 : f.delayDen,
    durationMs: parsed.durationMs,
    loops: parsed.loops,
  };
}
// Detect a control chunk structurally, never by searching compressed byte content.
export function hasApngChunks(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) return false;
  for (let p = 8; p + 12 <= bytes.length; ) {
    const type = bytes.toString("latin1", p + 4, p + 8);
    if (["acTL", "fcTL", "fdAT"].includes(type)) return true;
    const n = bytes.readUInt32BE(p) + 12;
    if (n > bytes.length - p) return false;
    p += n;
  }
  return false;
}
