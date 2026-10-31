import test from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import { decodePng } from "./image.mjs";
import { encodingPng } from "./png-encoding-fixtures.mjs";
import { crc32, deflateSync } from "node:zlib";
import { readMaterial, sha256 } from "./material.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { ReadingWindows } from "./windows.mjs";
import { runImageClients } from "../../scripts/reading-image-clients.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
for (const interlace of [0, 1])
  for (const [color, depth] of [
    [0, 1],
    [0, 2],
    [0, 4],
    [3, 1],
    [3, 2],
    [3, 4],
    [0, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [6, 8],
    [0, 16],
    [2, 16],
    [4, 16],
    [6, 16],
  ]) {
    test(`PNG ${color}/${depth} interlace ${interlace} matches independent native decoder and every pixel`, () => {
      for (const [width, height] of [
        [1, 1],
        [1, 9],
        [9, 1],
        [19, 11],
      ]) {
        const f = encodingPng({
          width,
          height,
          color,
          depth,
          interlace,
          transparency: true,
        });
        const oracle = new Resvg(
          `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><image width="${width}" height="${height}" xlink:href="data:image/png;base64,${f.body.toString("base64")}"/></svg>`,
          {
            background: "white",
            font: { loadSystemFonts: false },
            imageRendering: 1,
          },
        ).render();
        assert.deepEqual(
          oracle.pixels,
          f.pixels,
          "independent resvg decoder confirms fixture before our decoder",
        );
        assert.deepEqual(decodePng(f.body).pixels, f.pixels);
      }
    });
  }

function rewriteChunk(bytes, type, change) {
  const parts = [bytes.subarray(0, 8)];
  for (let offset = 8; offset < bytes.length; ) {
    const size = bytes.readUInt32BE(offset),
      name = bytes.toString("ascii", offset + 4, offset + 8),
      end = offset + 12 + size;
    if (name === type) {
      const body = change(Buffer.from(bytes.subarray(offset + 8, end - 4))),
        chunk = Buffer.alloc(body.length + 12);
      chunk.writeUInt32BE(body.length);
      chunk.write(name, 4);
      body.copy(chunk, 8);
      chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
      parts.push(chunk);
    } else parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(parts);
}
const file = (body, name = "packed.png") => ({
  id: "packed",
  name,
  body,
  size: body.length,
  hash: sha256(body),
});
test("packed/interlaced PNG malformed passes, palette range and unsupported encodings fail before any model pixels", async () => {
  const f = encodingPng({ depth: 1, color: 3, width: 9, height: 9 }),
    small = encodingPng({ depth: 1, color: 0, width: 1, height: 1 });
  for (const body of [
    rewriteChunk(f.body, "IHDR", (h) => {
      h[8] = 3;
      return h;
    }),
    rewriteChunk(f.body, "IHDR", (h) => {
      h[8] = 16;
      return h;
    }),
    rewriteChunk(f.body, "IHDR", (h) => {
      h[12] = 2;
      return h;
    }),
    rewriteChunk(f.body, "PLTE", (p) =>
      Buffer.concat([p, Buffer.from([1, 2, 3])]),
    ),
    rewriteChunk(f.body, "PLTE", (p) => p.subarray(0, 3)),
    rewriteChunk(f.body, "IDAT", () => deflateSync(f.raw.subarray(0, -1))),
    rewriteChunk(f.body, "IDAT", () =>
      deflateSync(Buffer.concat([f.raw, Buffer.from([0])])),
    ),
    rewriteChunk(small.body, "IDAT", () => deflateSync(Buffer.from([5, 0]))),
    rewriteChunk(small.body, "IDAT", () => deflateSync(Buffer.from([0, 0, 0]))),
  ]) {
    const m = await readMaterial(file(body), {
      imageWindow: { tile: 1 },
    });
    assert.equal(m.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(m.state));
  }
  const gray = encodingPng({ depth: 2, color: 0, transparency: true });
  assert.deepEqual(
    decodePng(rewriteChunk(gray.body, "tRNS", () => Buffer.from([0xab, 0xfd])))
      .pixels,
    gray.pixels,
  );
});

test("packed Adam7 input traverses all normalized tiles and archive coordinates without retaining image payloads", async () => {
  const f = encodingPng({
    width: 2051,
    height: 3,
    depth: 2,
    color: 3,
    interlace: 1,
    transparency: true,
  });
  const descriptor = file(zipBytes({ "notice.png": f.body }), "packed.zip"),
    verifier = Object.create(ReadingWindows.prototype);
  let cursor = FIRST_ARCHIVE_WINDOW,
    count = 0;
  const reconstructed = Buffer.alloc(f.pixels.length);
  while (cursor) {
    const material = await readMaterial(descriptor, {
      archiveWindow: cursor,
    });
    verifier.verify(material, undefined, cursor);
    const source = material.segments[0],
      range = source.range,
      decoded = decodePng(Buffer.from(source.image.data, "base64"));
    for (let y = 0; y < range.height; y++)
      decoded.pixels.copy(
        reconstructed,
        ((range.y + y) * f.width + range.x) * 4,
        y * range.width * 4,
        (y + 1) * range.width * 4,
      );
    assert.equal(range.archivePath, "notice.png");
    assert.equal(range.tile, ++count);
    cursor = material.archivePagination.next;
  }
  assert.equal(count, 3);
  assert.deepEqual(reconstructed, f.pixels);
});

test("packed Adam7 top-level input survives dual-client stop and revised-input paid reuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-packed-clients-"));
  try {
    await runImageClients({
      directory,
      packed: true,
      reader: Object.assign((f, o) => readMaterial(f, o), {
        pdfWindows: true,
        imageWindows: true,
        archiveWindows: true,
      }),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("16-bit Adam7 top-level and archived images retain both client adapters, paid reuse and original tombstones", async () => {
  for (const archiveFormat of [undefined, "rar4"]) {
    const directory = await mkdtemp(join(tmpdir(), "shixu-sixteen-clients-"));
    try {
      await runImageClients({ directory, sixteen: true, archiveFormat, deleted: !!archiveFormat,
        reader: Object.assign((f, o) => readMaterial(f, o), {
          pdfWindows: true, imageWindows: true, archiveWindows: true,
        }) });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
