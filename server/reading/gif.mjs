// Project-authored GIF87a/89a reader. No browser, native codec, OCR or URL loader.
export const GIF_READER_VERSION = "gif-composited-tiles/1";
const bad = () => {
  throw Error("GIF_MALFORMED");
};

export function inspectGif(bytes) {
  if (
    bytes.length < 14 ||
    !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))
  )
    throw Error("FORMAT_MISMATCH");
  const width = bytes.readUInt16LE(6),
    height = bytes.readUInt16LE(8);
  if (
    !width ||
    !height ||
    width > 16384 ||
    height > 16384 ||
    width * height > 32_000_000
  )
    throw Error("IMAGE_PIXEL_LIMIT");
  const packed = bytes[10],
    background = bytes[11];
  // Non-square pixel aspect changes visual interpretation; fail rather than
  // silently stretching or presenting inaccurate pixel coordinates.
  if (bytes[12]) throw Error("GIF_ASPECT_UNSUPPORTED");
  let offset = 13,
    globalPalette,
    control,
    ended = false;
  const take = (n) => {
    if (offset + n > bytes.length) bad();
    const b = bytes.subarray(offset, offset + n);
    offset += n;
    return b;
  };
  const blocks = () => {
    const start = offset;
    let size = 0;
    for (;;) {
      const n = take(1)[0];
      if (!n) break;
      take(n); size += n;
    }
    // Two passes avoid millions of Buffer views for legal tiny sub-blocks.
    const data=Buffer.alloc(size);
    for(let p=start,out=0;bytes[p];){const n=bytes[p++];bytes.copy(data,out,p,p+n);p+=n;out+=n;}
    return data;
  };
  if (packed & 128) {
    globalPalette = take(3 * (1 << ((packed & 7) + 1)));
    if (background * 3 >= globalPalette.length) bad();
  }
  const frames = [];
  let at = 0,
    loops = null;
  while (offset < bytes.length) {
    const type = take(1)[0];
    if (type === 0x3b) {
      if (control || offset !== bytes.length) bad();
      ended = true;
      break;
    }
    if (type === 0x21) {
      const label = take(1)[0];
      if (label === 0xf9) {
        if (control || take(1)[0] !== 4) bad();
        const b = take(4);
        if (take(1)[0] !== 0 || b[0] & 0xe0) bad();
        const disposal = (b[0] >>> 2) & 7;
        if (disposal > 3) throw Error("GIF_DISPOSAL_UNSUPPORTED");
        if (b[0] & 2) throw Error("GIF_INTERACTIVE_UNSUPPORTED");
        control = {
          disposal,
          delayMs: b.readUInt16LE(1) * 10,
          transparent: b[0] & 1 ? b[3] : null,
        };
      } else if (label === 0xfe) {
        blocks();
      } else if (label === 0xff) {
        if (take(1)[0] !== 11) bad();
        const app = take(11).toString("ascii"),
          data = blocks();
        if (!["NETSCAPE2.0", "ANIMEXTS1.0"].includes(app))
          throw Error("GIF_EXTENSION_UNSUPPORTED");
        if (loops !== null || data.length !== 3 || data[0] !== 1) bad();
        loops = data.readUInt16LE(1);
      } else
        throw Error(
          label === 0x01 ? "GIF_TEXT_UNSUPPORTED" : "GIF_EXTENSION_UNSUPPORTED",
        );
      continue;
    }
    if (type !== 0x2c) bad();
    const b = take(9),
      x = b.readUInt16LE(0),
      y = b.readUInt16LE(2),
      w = b.readUInt16LE(4),
      h = b.readUInt16LE(6),
      flags = b[8];
    if (!w || !h || x + w > width || y + h > height || flags & 0x18) bad();
    const palette =
      flags & 128 ? take(3 * (1 << ((flags & 7) + 1))) : globalPalette;
    if (!palette) bad();
    const c = control || { disposal: 0, delayMs: 0, transparent: null };
    control = undefined;
    if (c.transparent !== null && c.transparent * 3 >= palette.length) bad();
    const minimum = take(1)[0];
    if (minimum < 2 || minimum > 8) bad();
    const data = blocks();
    if (!data.length) bad();
    frames.push({
      x,
      y,
      width: w,
      height: h,
      interlace: !!(flags & 64),
      palette,
      minimum,
      data,
      ...c,
      startMs: at,
    });
    at += c.delayMs;
    if (frames.length > 64 || width * height * frames.length > 32_000_000)
      throw Error("GIF_RESOURCE_LIMIT");
    if (Math.ceil(width / 1024) * Math.ceil(height / 1024) * frames.length > 64)
      throw Error("IMAGE_TILE_LIMIT");
  }
  if (!ended || !frames.length) bad();
  return {
    width,
    height,
    frames,
    globalPalette,
    background,
    loops,
    durationMs: at,
  };
}

// Bounded prefix/suffix LZW dictionary; strict clear/end and exact pixel count.
// Reject suffix bytes even if a permissive display library would ignore them.
export function decodeGifIndices(data, minimum, count) {
  const clear = 1 << minimum,
    end = clear + 1,
    prefix = new Uint16Array(4096),
    suffix = new Uint8Array(4096),
    stack = new Uint8Array(4097),
    out = Buffer.alloc(count);
  let bit = 0,
    size = minimum + 1,
    next = end + 1,
    previous = -1,
    first = 0,
    written = 0,
    ended = false,
    initialized = false;
  const code = () => {
    if (bit + size > data.length * 8) bad();
    let n = 0;
    for (let i = 0; i < size; i++)
      n |= ((data[(bit + i) >>> 3] >>> ((bit + i) & 7)) & 1) << i;
    bit += size;
    return n;
  };
  while (bit + size <= data.length * 8) {
    const value = code();
    if (value === clear) {
      size = minimum + 1;
      next = end + 1;
      previous = -1;
      initialized = true;
      continue;
    }
    if (!initialized) bad();
    if (value === end) {
      ended = true;
      break;
    }
    let current = value,
      depth = 0;
    if (value === next && previous !== -1) {
      stack[depth++] = first;
      current = previous;
    } else if (value >= next) bad();
    while (current >= clear) {
      if (current >= next || depth >= 4096) bad();
      stack[depth++] = suffix[current];
      current = prefix[current];
    }
    first = current;
    stack[depth++] = first;
    if (written + depth > count) bad();
    while (depth) out[written++] = stack[--depth];
    if (previous !== -1 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    previous = value;
  }
  if (!ended || written !== count || Math.ceil(bit / 8) !== data.length) bad();
  return out;
}

export function decodeGif(bytes, frameNumber = 1, parsed = inspectGif(bytes)) {
  if (
    !Number.isSafeInteger(frameNumber) ||
    frameNumber < 1 ||
    frameNumber > parsed.frames.length
  )
    throw Error("IMAGE_CURSOR_OUT_OF_RANGE");
  const { width, height, frames, globalPalette, background } = parsed,
    canvas = Buffer.alloc(width * height * 4);
  const backgroundColor = (transparent) =>
    globalPalette && transparent === null
      ? [...globalPalette.subarray(background * 3, background * 3 + 3), 255]
      : [255, 255, 255, 255];
  const fill = (x, y, w, h, color) => {
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++) {
        const p = (row * width + col) * 4;
        for (let c = 0; c < 4; c++) canvas[p + c] = color[c];
      }
  };
  fill(0, 0, width, height, backgroundColor(frames[0].transparent));
  let pixels;
  // Validate the entire file, including all later frames, before sending even
  // its first tile. Only a canvas, optional restore buffer and selected snapshot
  // are kept; decoded frame-pixel totals have already been bounded above.
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index],
      indices = decodeGifIndices(
        frame.data,
        frame.minimum,
        frame.width * frame.height,
      );
    const previous = frame.disposal === 3 ? Buffer.from(canvas) : null;
    const rows = [];
    if (frame.interlace) {
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let y = start; y < frame.height; y += step) rows.push(y);
    } else for (let y = 0; y < frame.height; y++) rows.push(y);
    let p = 0;
    for (const row of rows)
      for (let x = 0; x < frame.width; x++) {
        const color = indices[p++];
        if (color * 3 >= frame.palette.length) bad();
        if (color === frame.transparent) continue;
        const target = ((frame.y + row) * width + frame.x + x) * 4;
        frame.palette.copy(canvas, target, color * 3, color * 3 + 3);
        canvas[target + 3] = 255;
      }
    if (index + 1 === frameNumber) pixels = Buffer.from(canvas);
    if (frame.disposal === 2)
      fill(
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        backgroundColor(frame.transparent),
      );
    else if (previous) previous.copy(canvas);
  }
  const frame = frames[frameNumber - 1];
  return {
    width,
    height,
    pixels,
    frame: frameNumber,
    totalFrames: frames.length,
    frameStartMs: frame.startMs,
    frameDurationMs: frame.delayMs,
    durationMs: parsed.durationMs,
    loops: parsed.loops,
  };
}
