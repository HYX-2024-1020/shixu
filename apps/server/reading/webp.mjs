import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sha256 } from "./material.mjs";

export const WEBP_READER_VERSION =
  "webp-composited-tiles/3;libwebp/1.6.0-strict";
const sourceHash =
  "e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564";
const bad = () => {
  throw Error("WEBP_MALFORMED");
};
const u24 = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
const chunks = (bytes, start = 0, end = bytes.length) => {
  const result = [];
  let p = start;
  while (p < end) {
    if (p + 8 > end) bad();
    const name = bytes.toString("latin1", p, p + 4),
      size = bytes.readUInt32LE(p + 4),
      next = p + 8 + size + (size & 1);
    if (
      !/^[\x20-\x7e]{4}$/.test(name) ||
      next > end ||
      (size & 1 && bytes[next - 1] !== 0)
    )
      bad();
    result.push({ name, body: bytes.subarray(p + 8, p + 8 + size) });
    p = next;
    if (result.length > 4096) throw Error("WEBP_RESOURCE_LIMIT");
  }
  if (p !== end) bad();
  return result;
};
function bitstream(parts) {
  let image,
    alpha = false,
    alphaBody;
  for (const { name, body } of parts) {
    if (name === "ALPH") {
      if (
        alpha ||
        image ||
        body.length < 2 ||
        body[0] & 0xc0 ||
        (body[0] & 3) > 1 ||
        ((body[0] >>> 4) & 3) > 1
      )
        bad();
      alpha = true;
      alphaBody = body;
    } else if (name === "VP8 ") {
      if (
        image ||
        body.length < 10 ||
        body[0] & 1 ||
        body.toString("hex", 3, 6) !== "9d012a" ||
        body.readUInt16LE(6) & 0xc000 ||
        body.readUInt16LE(8) & 0xc000
      )
        bad();
      image = {
        width: body.readUInt16LE(6) & 0x3fff,
        height: body.readUInt16LE(8) & 0x3fff,
      };
    } else if (name === "VP8L") {
      if (image || alpha || body.length < 5 || body[0] !== 0x2f) bad();
      const info = body.readUInt32LE(1);
      if (info >>> 29) bad();
      image = {
        width: (info & 0x3fff) + 1,
        height: ((info >>> 14) & 0x3fff) + 1,
      };
      alpha = !!(info & 0x10000000);
    } else throw Error("WEBP_CHUNK_UNSUPPORTED");
  }
  if (!image || !image.width || !image.height) bad();
  if (
    alphaBody &&
    !(alphaBody[0] & 3) &&
    alphaBody.length !== 1 + image.width * image.height
  )
    bad();
  return { ...image, alpha };
}

export function inspectWebp(bytes) {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    throw Error("FORMAT_MISMATCH");
  if (bytes.readUInt32LE(4) !== bytes.length - 8) bad();
  const parts = chunks(bytes, 12),
    first = parts[0];
  let width,
    height,
    frames = [],
    flags = 0;
  if (first.name !== "VP8X") {
    const image = bitstream(parts);
    width = image.width;
    height = image.height;
    frames = [{ x: 0, y: 0, width, height, startMs: 0, durationMs: 0 }];
  } else {
    if (
      first.body.length !== 10 ||
      first.body[0] & 0xc1 ||
      first.body[1] ||
      first.body[2] ||
      first.body[3]
    )
      bad();
    flags = first.body[0];
    width = u24(first.body, 4) + 1;
    height = u24(first.body, 7) + 1;
    let anim = false,
      image = false,
      xmp = false,
      anyAlpha = false,
      at = 0;
    const staticParts = [];
    for (const part of parts.slice(1)) {
      const { name, body } = part;
      if (name === "ICCP" || name === "EXIF")
        throw Error("WEBP_COLOR_OR_ORIENTATION_UNSUPPORTED");
      if (name === "XMP ") {
        if (xmp || !image || !body.length) bad();
        xmp = true;
        continue;
      }
      if (xmp) bad();
      if (name === "ANIM") {
        if (!(flags & 2) || anim || image || body.length !== 6) bad();
        anim = true;
      } else if (name === "ANMF") {
        if (!anim || body.length < 24 || body[15] & 0xfc) bad();
        const frame = {
          x: u24(body, 0) * 2,
          y: u24(body, 3) * 2,
          width: u24(body, 6) + 1,
          height: u24(body, 9) + 1,
          startMs: at,
          durationMs: u24(body, 12),
        };
        if (frame.x + frame.width > width || frame.y + frame.height > height)
          bad();
        const decoded = bitstream(chunks(body, 16));
        if (decoded.width !== frame.width || decoded.height !== frame.height)
          bad();
        anyAlpha ||= decoded.alpha;
        at += frame.durationMs;
        frames.push(frame);
        if (frames.length > 64) throw Error("WEBP_RESOURCE_LIMIT");
        image = true;
      } else if (["ALPH", "VP8 ", "VP8L"].includes(name)) {
        if (anim || flags & 2) bad();
        staticParts.push(part);
        if (name !== "ALPH") image = true;
      } else throw Error("WEBP_CHUNK_UNSUPPORTED");
    }
    if (!!(flags & 4) !== xmp || flags & 0x28)
      throw Error("WEBP_COLOR_OR_ORIENTATION_UNSUPPORTED");
    if (flags & 2) {
      if (!anim || !frames.length) bad();
    } else {
      const image = bitstream(staticParts);
      if (image.width !== width || image.height !== height) bad();
      anyAlpha = image.alpha;
      frames = [{ x: 0, y: 0, width, height, startMs: 0, durationMs: 0 }];
    }
    if (anyAlpha && !(flags & 16)) bad();
  }
  if (
    !width ||
    !height ||
    width > 16384 ||
    height > 16384 ||
    width * height > 32_000_000
  )
    throw Error("IMAGE_PIXEL_LIMIT");
  if (width * height * frames.length > 32_000_000)
    throw Error("WEBP_RESOURCE_LIMIT");
  if (Math.ceil(width / 1024) * Math.ceil(height / 1024) * frames.length > 64)
    throw Error("IMAGE_TILE_LIMIT");
  return { width, height, frames };
}

async function verifiedTool() {
  const directory = fileURLToPath(
    new URL("./generated-webp/", import.meta.url),
  );
  const binary =
    directory + "reading-webp" + (process.platform === "win32" ? ".exe" : "");
  try {
    const manifest = JSON.parse(
      await readFile(directory + "manifest.json", "utf8"),
    );
    if (
      manifest.protocol !== "shixu-webp/3" ||
      manifest.sourceSha256 !== sourceHash ||
      manifest.platform !== process.platform + "-" + process.arch ||
      sha256(await readFile(binary)) !== manifest.toolSha256
    )
      throw Error();
    return binary;
  } catch {
    throw Error("NATIVE_WEBP_UNSUPPORTED");
  }
}

export async function decodeWebp(bytes, tile) {
  const parsed = inspectWebp(bytes),
    columns = Math.ceil(parsed.width / 1024),
    perFrame = columns * Math.ceil(parsed.height / 1024);
  if (
    !Number.isSafeInteger(tile) ||
    tile < 1 ||
    tile > perFrame * parsed.frames.length
  )
    throw Error("IMAGE_CURSOR_OUT_OF_RANGE");
  const binary = await verifiedTool();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [String(tile)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: {},
      }),
      chunks = [];
    let size = 0,
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, 20000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 52 + 1024 * 1024 * 4) {
        failed = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("NATIVE_WEBP_UNSUPPORTED"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code || failed) reject(Error("WEBP_DECODE_FAILED"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
  const frame = Math.floor((tile - 1) / perFrame) + 1,
    x = (((tile - 1) % perFrame) % columns) * 1024,
    y = Math.floor(((tile - 1) % perFrame) / columns) * 1024;
  const width = Math.min(1024, parsed.width - x),
    height = Math.min(1024, parsed.height - y),
    f = parsed.frames[frame - 1];
  const expected = [
    parsed.width,
    parsed.height,
    parsed.frames.length,
    frame,
    f.startMs,
    f.durationMs,
    x,
    y,
    width,
    height,
  ];
  if (
    result.length !== 52 + width * height * 4 ||
    result.toString("ascii", 0, 8) !== "SHIXUWP3" ||
    expected.some((n, i) => result.readUInt32LE(8 + i * 4) !== n)
  )
    throw Error("WEBP_DECODE_FAILED");
  const pixels = result.subarray(52);
  for (let p = 0; p < pixels.length; p += 4) {
    const alpha = pixels[p + 3];
    for (let c = 0; c < 3; c++)
      pixels[p + c] = Math.round(
        (pixels[p + c] * alpha + 255 * (255 - alpha)) / 255,
      );
    pixels[p + 3] = 255;
  }
  return {
    width: parsed.width,
    height: parsed.height,
    pixels,
    decoderMetrics: result.readUInt32LE(48)
      ? { nativeMaxRssKiB: result.readUInt32LE(48) }
      : {},
    tileOnly: true,
    x,
    y,
    tileWidth: width,
    tileHeight: height,
    frame,
    totalFrames: parsed.frames.length,
    frameStartMs: f.startMs,
    frameDurationMs: f.durationMs,
  };
}
