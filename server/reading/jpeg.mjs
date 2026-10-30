import decode from "./jpeg-reader.cjs";

export const JPEG_READER_VERSION = "jpeg-js/0.4.4;strict-jpeg/2";
const bad = () => {
  throw Error("JPEG_MALFORMED");
};
const unsupported = () => {
  throw Error("JPEG_METADATA_UNSUPPORTED");
};

function exif(body) {
  if (body.length < 14 || body.toString("hex", 0, 6) !== "457869660000") bad();
  const t = body.subarray(6),
    order = t.toString("ascii", 0, 2);
  if (!["II", "MM"].includes(order)) bad();
  const u16 = (i) => {
    if (i < 0 || i + 2 > t.length) bad();
    return order === "II" ? t.readUInt16LE(i) : t.readUInt16BE(i);
  };
  const u32 = (i) => {
    if (i < 0 || i + 4 > t.length) bad();
    return order === "II" ? t.readUInt32LE(i) : t.readUInt32BE(i);
  };
  if (u16(2) !== 42) unsupported();
  let orientation = 1,
    hasOrientation = false,
    colorSpace,
    photometric,
    total = 0;
  const seen = new Set(),
    sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const visit = (offset, kind) => {
    if (offset < 8 || seen.has(offset) || seen.size >= 8) bad();
    seen.add(offset);
    const count = u16(offset);
    total += count;
    if (total > 1024 || offset + 2 + count * 12 + 4 > t.length) bad();
    const tags = new Set();
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12,
        tag = u16(p),
        type = u16(p + 2),
        n = u32(p + 4),
        bytes = n * sizes[type];
      if (!sizes[type] || !n || tags.has(tag)) bad();
      tags.add(tag);
      const value = bytes <= 4 ? p + 8 : u32(p + 8);
      if (
        bytes > t.length ||
        value < 0 ||
        value + bytes > t.length ||
        (bytes > 4 && value < 8)
      )
        bad();
      if (tag === 0x112 && kind === "main") {
        if (type !== 3 || n !== 1 || hasOrientation) bad();
        orientation = u16(value);
        hasOrientation = true;
        if (orientation < 1 || orientation > 8) bad();
      }
      if (tag === 0xa001) {
        if (type !== 3 || n !== 1) bad();
        colorSpace = u16(value);
        if (colorSpace !== 1) unsupported();
      }
      if (tag === 0x106 && kind === "main") {
        if (type !== 3 || n !== 1) bad();
        photometric = u16(value);
        if (![1, 2, 6].includes(photometric)) unsupported();
      }
      if (tag === 0x8773) unsupported(); // Embedded ICC requires color management.
      if (
        tag === 0x0001 &&
        kind === "interop" &&
        t.toString("ascii", value, value + bytes) !== "R98\0"
      )
        unsupported();
      if ([0x8769, 0x8825, 0xa005].includes(tag)) {
        if (type !== 4 || n !== 1) bad();
        visit(
          u32(value),
          tag === 0x8769 ? "exif" : tag === 0x8825 ? "gps" : "interop",
        );
      }
    }
    const next = u32(offset + 2 + count * 12);
    if (next) visit(next, "thumbnail");
  };
  visit(u32(4), "main");
  return { orientation, colorSpace, photometric };
}

// Read the complete marker/entropy envelope before the third-party decoder
// allocates coefficient buffers. Never repair a prefix or ignore a second image.
export function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8)
    throw Error("FORMAT_MISMATCH");
  let offset = 2,
    frame,
    jfif = false,
    adobe,
    metadata,
    scans = 0,
    ended = false,
    markers = 0;
  let restartInterval = 0;
  const quant = new Set(),
    huffman = new Set();
  while (offset < bytes.length) {
    if (++markers > 8192) throw Error("JPEG_RESOURCE_LIMIT");
    if (bytes[offset++] !== 255) bad();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) bad();
    if (marker === 0xd9) {
      if (offset !== bytes.length || !frame || !scans) bad();
      ended = true;
      break;
    }
    if (
      marker === 0 ||
      marker === 1 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      bad();
    if (offset + 2 > bytes.length) bad();
    const length = bytes.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > bytes.length) bad();
    const body = bytes.subarray(offset + 2, end);
    offset = end;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || body.length < 6) bad();
      const width = body.readUInt16BE(3),
        height = body.readUInt16BE(1),
        count = body[5];
      if (
        !width ||
        !height ||
        width > 16384 ||
        height > 16384 ||
        width * height > 32_000_000
      )
        throw Error("IMAGE_PIXEL_LIMIT");
      if (body[0] !== 8 || ![1, 3].includes(count))
        throw Error("JPEG_ENCODING_UNSUPPORTED");
      if (body.length !== 6 + count * 3) bad();
      const components = [];
      let samples = 0;
      for (let i = 0; i < count; i++) {
        const id = body[6 + i * 3],
          h = body[7 + i * 3] >>> 4,
          v = body[7 + i * 3] & 15,
          q = body[8 + i * 3];
        if (
          !h ||
          !v ||
          h > 4 ||
          v > 4 ||
          q > 3 ||
          components.some((c) => c.id === id)
        )
          bad();
        samples += h * v;
        components.push({ id, q, h, v });
      }
      if (samples > 10) throw Error("JPEG_ENCODING_UNSUPPORTED");
      frame = { width, height, components, progressive: marker === 0xc2 };
    } else if (marker === 0xdb) {
      let p = 0;
      while (p < body.length) {
        const info = body[p++],
          precision = info >>> 4,
          id = info & 15;
        if (precision > 1 || id > 3 || p + 64 * (precision + 1) > body.length)
          bad();
        for (let i = 0; i < 64; i++) {
          if (!(precision ? body.readUInt16BE(p) : body[p])) bad();
          p += precision + 1;
        }
        quant.add(id);
      }
      if (!body.length) bad();
    } else if (marker === 0xc4) {
      let p = 0;
      while (p < body.length) {
        const info = body[p++],
          type = info >>> 4,
          id = info & 15;
        if (type > 1 || id > 3 || p + 16 > body.length) bad();
        let count = 0,
          available = 1;
        for (let i = 0; i < 16; i++) {
          const n = body[p++];
          count += n;
          available = available * 2 - n;
          if (available < 0) bad();
        }
        if (!count || count > 256 || !available || p + count > body.length)
          bad();
        const values = body.subarray(p, p + count);
        if (
          new Set(values).size !== values.length ||
          values.some((v) => (type === 0 ? v > 11 : (v & 15) > 10))
        )
          bad();
        p += count;
        huffman.add(info);
      }
      if (!body.length) bad();
    } else if (marker === 0xdd) {
      if (body.length !== 2) bad();
      restartInterval = body.readUInt16BE(0);
    } else if (marker === 0xe0) {
      if (
        scans ||
        jfif ||
        body.length < 14 ||
        body.toString("hex", 0, 5) !== "4a46494600"
      )
        unsupported();
      if (
        body[5] !== 1 ||
        body[6] > 2 ||
        body[7] > 2 ||
        body.length !== 14 + 3 * body[12] * body[13]
      )
        bad();
      if (!body.readUInt16BE(8) || !body.readUInt16BE(10)) bad();
      jfif = true;
      if (body.readUInt16BE(8) !== body.readUInt16BE(10)) unsupported();
    } else if (marker === 0xe1) {
      if (scans || metadata) unsupported();
      if (body.toString("hex", 0, 6) !== "457869660000") unsupported();
      metadata = exif(body);
    } else if (marker === 0xee) {
      if (
        scans ||
        adobe !== undefined ||
        body.length !== 12 ||
        body.toString("ascii", 0, 5) !== "Adobe"
      )
        unsupported();
      adobe = body[11];
      if (adobe > 1) unsupported();
    } else if (marker === 0xfe) {
      /* Comments are stripped, never model input. */
    } else if (marker === 0xda) {
      if (!frame || body.length < 6 || ++scans > 512) bad();
      const count = body[0];
      if (
        !count ||
        count > frame.components.length ||
        body.length !== 4 + count * 2
      )
        bad();
      const start = body[1 + count * 2],
        last = body[2 + count * 2],
        successive = body[3 + count * 2],
        ids = new Set();
      if (
        start > last ||
        last > 63 ||
        successive >>> 4 > 13 ||
        (successive & 15) > 13 ||
        (!frame.progressive && (start || last !== 63 || successive))
      )
        bad();
      if (
        frame.progressive &&
        ((start === 0 ? last !== 0 : count !== 1) ||
          (successive >>> 4 !== 0 &&
            successive >>> 4 !== (successive & 15) + 1))
      )
        bad();
      for (let i = 0; i < count; i++) {
        const id = body[1 + i * 2],
          table = body[2 + i * 2],
          component = frame.components.find((c) => c.id === id);
        if (
          !component ||
          ids.has(id) ||
          !quant.has(component.q) ||
          table >>> 4 > 3 ||
          (table & 15) > 3
        )
          bad();
        ids.add(id);
        if (start === 0 && !huffman.has(table >>> 4)) bad();
        if (last > 0 && !huffman.has(0x10 + (table & 15))) bad();
      }
      const maxH = Math.max(...frame.components.map((c) => c.h)),
        maxV = Math.max(...frame.components.map((c) => c.v));
      const component =
        count === 1 ? frame.components.find((c) => c.id === body[1]) : null;
      const mcus = component
        ? Math.ceil((Math.ceil(frame.width / 8) * component.h) / maxH) *
          Math.ceil((Math.ceil(frame.height / 8) * component.v) / maxV)
        : Math.ceil(frame.width / (8 * maxH)) *
          Math.ceil(frame.height / (8 * maxV));
      const expectedRestarts = restartInterval
        ? Math.ceil(mcus / restartInterval) - 1
        : 0;
      let found = false,
        restarts = 0;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 255) continue;
        const at = offset - 1;
        while (bytes[offset] === 255) offset++;
        const code = bytes[offset];
        if (code === undefined) bad();
        if (code >= 0xd0 && code <= 0xd7) {
          if (
            !restartInterval ||
            code !== 0xd0 + (restarts % 8) ||
            ++restarts > expectedRestarts
          )
            bad();
          offset++;
          continue;
        }
        if (code === 0) {
          offset++;
          continue;
        }
        offset = at;
        found = true;
        break;
      }
      if (!found) bad();
      if (restarts !== expectedRestarts) bad();
    } else if (marker >= 0xe0 && marker <= 0xef) unsupported();
    else throw Error("JPEG_ENCODING_UNSUPPORTED");
  }
  if (!ended) bad();
  const count = frame.components.length;
  let colorTransform = true;
  if (count === 3) {
    if (adobe === 0) {
      if (jfif) unsupported();
      colorTransform = false;
    } else if (!jfif && adobe !== 1 && metadata?.colorSpace !== 1)
      unsupported();
    if (
      colorTransform &&
      frame.components.map((c) => c.id).join(",") !== "1,2,3"
    )
      unsupported();
  }
  if (
    metadata?.photometric !== undefined &&
    metadata.photometric !== (count === 1 ? 1 : colorTransform ? 6 : 2)
  )
    unsupported();
  const orientation = metadata?.orientation || 1;
  return {
    ...frame,
    orientation,
    colorTransform,
    encodedWidth: frame.width,
    encodedHeight: frame.height,
    width: orientation >= 5 ? frame.height : frame.width,
    height: orientation >= 5 ? frame.width : frame.height,
  };
}

export function decodeJpeg(bytes) {
  const info = inspectJpeg(bytes);
  let decoded;
  try {
    decoded = decode(bytes, {
      colorTransform: info.colorTransform,
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: 32,
      maxMemoryUsageInMB: 256,
    });
  } catch (e) {
    throw Error(
      /memory|allocate|maxResolution/i.test(e.message)
        ? "JPEG_RESOURCE_LIMIT"
        : "JPEG_MALFORMED",
    );
  }
  if (
    decoded.width !== info.encodedWidth ||
    decoded.height !== info.encodedHeight ||
    decoded.data.length !== decoded.width * decoded.height * 4
  )
    bad();
  // Zero-copy view. Orientation is applied only to the current tile, avoiding
  // a second full-frame pixel allocation and stripping every metadata field.
  return {
    ...info,
    pixels: Buffer.from(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    ),
  };
}

export function jpegPixelIndex(image, x, y) {
  const w = image.encodedWidth,
    h = image.encodedHeight;
  let sx = x,
    sy = y;
  switch (image.orientation) {
    case 2:
      sx = w - 1 - x;
      break;
    case 3:
      sx = w - 1 - x;
      sy = h - 1 - y;
      break;
    case 4:
      sy = h - 1 - y;
      break;
    case 5:
      sx = y;
      sy = x;
      break;
    case 6:
      sx = y;
      sy = h - 1 - x;
      break;
    case 7:
      sx = w - 1 - y;
      sy = h - 1 - x;
      break;
    case 8:
      sx = w - 1 - y;
      sy = x;
      break;
  }
  return (sy * w + sx) * 4;
}
