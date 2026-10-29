import { inflateSync, deflateSync } from "node:zlib";
import { sha256 } from "./material.mjs";

export const IMAGE_READER_VERSION = "png-tiles/1;zlib-node/24";
export const IMAGE_TILE_EDGE = 1024;
export function validateModelImage(image) {
  if (
    !image ||
    Object.keys(image).sort().join(",") !== "data,hash,height,mime,width" ||
    image.mime !== "image/png" ||
    typeof image.data !== "string" ||
    !image.data.length ||
    image.data.length > 8 * 1024 * 1024 ||
    image.data.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > IMAGE_TILE_EDGE ||
    image.height > IMAGE_TILE_EDGE
  )
    throw Error("INVALID_PROVIDER_IMAGE");
  const png = Buffer.from(image.data, "base64");
  if (
    png.length < 33 ||
    png.toString("base64") !== image.data ||
    png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
    png.readUInt32BE(8) !== 13 ||
    png.toString("ascii", 12, 16) !== "IHDR" ||
    png.readUInt32BE(16) !== image.width ||
    png.readUInt32BE(20) !== image.height ||
    png[24] !== 8 ||
    png[25] !== 6 ||
    png[28] !== 0 ||
    sha256(png) !== image.hash
  )
    throw Error("INVALID_PROVIDER_IMAGE");
  return image;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function pngCrc(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function validateImageWindow(value) {
  if (value === undefined || value === null) return null;
  if (
    Object.keys(value).sort().join(",") !== "tile" ||
    !Number.isSafeInteger(value.tile) ||
    value.tile < 1 ||
    value.tile > 64
  )
    throw Error("INVALID_IMAGE_WINDOW");
  return { tile: value.tile };
}
function chunk(type, body) {
  const b = Buffer.alloc(body.length + 12);
  b.writeUInt32BE(body.length);
  b.write(type, 4, "ascii");
  body.copy(b, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
  return b;
}
export function encodePng(width, height, rgba) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 32_000_000 ||
    rgba.length !== width * height * 4
  )
    throw Error("INVALID_IMAGE_PIXELS");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    rgba.copy(
      rows,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4,
    );
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const paeth = (a, b, c) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw Error("FORMAT_MISMATCH");
  let offset = 8,
    header,
    palette,
    alpha,
    ended = false,
    idatEnded = false,
    idatStarted = false;
  const compressed = [];
  const colorChunks = new Set();
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw Error("PNG_MALFORMED");
    const size = bytes.readUInt32BE(offset),
      end = offset + 12 + size;
    if (end > bytes.length) throw Error("PNG_MALFORMED");
    const type = bytes.toString("latin1", offset + 4, offset + 8),
      body = bytes.subarray(offset + 8, end - 4);
    if (
      !/^[A-Za-z]{4}$/.test(type) ||
      pngCrc(bytes.subarray(offset + 4, end - 4)) !==
        bytes.readUInt32BE(end - 4)
    )
      throw Error("PNG_CRC");
    if (["gAMA", "sRGB"].includes(type)) {
      if (colorChunks.has(type) || idatStarted || palette)
        throw Error("PNG_MALFORMED");
      colorChunks.add(type);
      if (type === "sRGB" && (size !== 1 || body[0] > 3))
        throw Error("PNG_MALFORMED");
    }
    if (!header && type !== "IHDR") throw Error("PNG_MALFORMED");
    if (type === "IHDR") {
      if (header || offset !== 8 || size !== 13) throw Error("PNG_MALFORMED");
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
      };
      if (
        !header.width ||
        !header.height ||
        header.width > 16384 ||
        header.height > 16384 ||
        header.width * header.height > 32_000_000
      )
        throw Error("IMAGE_PIXEL_LIMIT");
      if (
        body[10] ||
        body[11] ||
        body[12] ||
        header.depth !== 8 ||
        ![0, 2, 3, 4, 6].includes(header.color)
      )
        throw Error("PNG_ENCODING_UNSUPPORTED");
    } else if (type === "acTL" || type === "fcTL" || type === "fdAT")
      throw Error("IMAGE_ANIMATION_UNSUPPORTED");
    else if (
      ["iCCP", "eXIf", "cHRM", "cICP", "mDCV", "cLLI", "bKGD"].includes(type)
    )
      throw Error("PNG_COLOR_OR_ORIENTATION_UNSUPPORTED");
    else if (type === "gAMA" && (size !== 4 || body.readUInt32BE(0) !== 45455))
      throw Error("PNG_COLOR_OR_ORIENTATION_UNSUPPORTED");
    else if (type === "PLTE") {
      if (
        palette ||
        idatStarted ||
        !size ||
        size % 3 ||
        size > 768 ||
        [0, 4].includes(header.color)
      )
        throw Error("PNG_MALFORMED");
      palette = body;
    } else if (type === "tRNS") {
      if (
        alpha ||
        idatStarted ||
        ![0, 2, 3].includes(header.color) ||
        (header.color === 0 && size !== 2) ||
        (header.color === 2 && size !== 6) ||
        (header.color === 3 && (!palette || !size || size > palette.length / 3))
      )
        throw Error("PNG_MALFORMED");
      alpha = body;
    } else if (type === "IDAT") {
      if (idatEnded) throw Error("PNG_MALFORMED");
      idatStarted = true;
      compressed.push(body);
    } else if (type === "IEND") {
      if (size || !idatStarted || end !== bytes.length)
        throw Error("PNG_MALFORMED");
      ended = true;
    } else {
      if (type[0] === type[0].toUpperCase())
        throw Error("PNG_ENCODING_UNSUPPORTED");
      if (idatStarted) idatEnded = true;
    }
    offset = end;
  }
  if (!ended || (header.color === 3 && !palette)) throw Error("PNG_MALFORMED");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color],
    stride = header.width * channels;
  const compressedBytes = Buffer.concat(compressed);
  const decoded = inflateSync(compressedBytes, {
    maxOutputLength: (stride + 1) * header.height,
    info: true,
  });
  const inflated = decoded.buffer;
  if (decoded.engine.bytesWritten !== compressedBytes.length)
    throw Error("PNG_MALFORMED");
  if (inflated.length !== (stride + 1) * header.height)
    throw Error("PNG_MALFORMED");
  const pixels = Buffer.alloc(header.width * header.height * 4),
    previous = Buffer.alloc(stride),
    row = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y++) {
    const base = y * (stride + 1),
      filter = inflated[base];
    if (filter > 4) throw Error("PNG_MALFORMED");
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0,
        b = previous[x],
        c = x >= channels ? previous[x - channels] : 0;
      row[x] =
        (inflated[base + x + 1] +
          (filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? Math.floor((a + b) / 2)
                  : paeth(a, b, c))) &
        255;
    }
    for (let x = 0; x < header.width; x++) {
      const p = (y * header.width + x) * 4,
        i = x * channels;
      let r,
        g,
        b,
        a = 255;
      if (header.color === 0 || header.color === 4) {
        r = g = b = row[i];
        if (header.color === 4) a = row[i + 1];
        else if (alpha && r === (alpha.readUInt16BE(0) & 255)) a = 0;
      } else if (header.color === 3) {
        const index = row[i];
        if (index * 3 >= palette.length) throw Error("PNG_MALFORMED");
        r = palette[index * 3];
        g = palette[index * 3 + 1];
        b = palette[index * 3 + 2];
        a = alpha?.[index] ?? 255;
      } else {
        r = row[i];
        g = row[i + 1];
        b = row[i + 2];
        if (header.color === 6) a = row[i + 3];
        else if (
          alpha &&
          r === (alpha.readUInt16BE(0) & 255) &&
          g === (alpha.readUInt16BE(2) & 255) &&
          b === (alpha.readUInt16BE(4) & 255)
        )
          a = 0;
      }
      // Flatten transparency onto white explicitly; hidden RGB is never sent.
      pixels[p] = Math.round((r * a + 255 * (255 - a)) / 255);
      pixels[p + 1] = Math.round((g * a + 255 * (255 - a)) / 255);
      pixels[p + 2] = Math.round((b * a + 255 * (255 - a)) / 255);
      pixels[p + 3] = 255;
    }
    row.copy(previous);
  }
  return { ...header, pixels };
}
export function readImage(bytes, result, window) {
  window = validateImageWindow(window) || { tile: 1 };
  result.readerVersion = IMAGE_READER_VERSION;
  result.normalizationVersion = "png-rgba-white-tiles/1";
  try {
    const image = decodePng(bytes),
      columns = Math.ceil(image.width / IMAGE_TILE_EDGE),
      rows = Math.ceil(image.height / IMAGE_TILE_EDGE);
    const total = columns * rows;
    if (total > 64) throw Error("IMAGE_TILE_LIMIT");
    if (window.tile > total) throw Error("IMAGE_CURSOR_OUT_OF_RANGE");
    const index = window.tile - 1,
      x = (index % columns) * IMAGE_TILE_EDGE,
      y = Math.floor(index / columns) * IMAGE_TILE_EDGE;
    const width = Math.min(IMAGE_TILE_EDGE, image.width - x),
      height = Math.min(IMAGE_TILE_EDGE, image.height - y),
      tile = Buffer.alloc(width * height * 4);
    for (let row = 0; row < height; row++)
      image.pixels.copy(
        tile,
        row * width * 4,
        ((y + row) * image.width + x) * 4,
        ((y + row) * image.width + x + width) * 4,
      );
    const png = encodePng(width, height, tile),
      sourceId = `${result.attachmentId.slice(0, 64)}_${sha256(result.attachmentId).slice(0, 12)}_i${window.tile}`;
    const range = {
      sourceId,
      name: result.name,
      kind: "image",
      tile: window.tile,
      x,
      y,
      width,
      height,
      imageWidth: image.width,
      imageHeight: image.height,
      start: index,
      end: index + 1,
      imageHash: sha256(png),
    };
    result.covered = [range];
    result.segments = [
      {
        sourceId,
        range,
        text: `图像模型识别，第${window.tile}块，像素范围(${x},${y},${width},${height})`,
        image: {
          mime: "image/png",
          data: png.toString("base64"),
          hash: range.imageHash,
          width,
          height,
        },
      },
    ];
    result.imagePagination = {
      startTile: window.tile,
      nextTile: window.tile < total ? window.tile + 1 : null,
      totalTiles: total,
      width: image.width,
      height: image.height,
    };
    if (window.tile < total) {
      result.state = "partial";
      result.reasons = ["IMAGE_WINDOW_PENDING"];
      result.uncovered = [
        {
          kind: "image",
          tile: window.tile + 1,
          tileEnd: total,
          code: "IMAGE_WINDOW_PENDING",
        },
      ];
    }
  } catch (e) {
    if (e.message === "IMAGE_CURSOR_OUT_OF_RANGE") throw e;
    const code = /^(FORMAT_MISMATCH|PNG_|IMAGE_)/.test(e.message)
      ? e.message
      : "IMAGE_DECODE_FAILED";
    result.state = /UNSUPPORTED/.test(code) ? "unsupported" : "failed";
    result.reasons = [code];
    result.uncovered = [{ kind: "image", code }];
  }
  return result;
}
