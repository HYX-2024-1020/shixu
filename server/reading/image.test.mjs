import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { encodePng, decodePng, pngCrc, validateImageWindow } from "./image.mjs";
import {
  readMaterial,
  sha256,
  coverageOnly,
  modelMaterial,
} from "./material.mjs";
import {
  createDeepSeekReadingProvider,
  deepseekPriceSnapshots,
} from "./deepseek.mjs";
import { readingView, sourceLocation } from "../../shared/reading-view.mjs";

function chunk(type, body) {
  const b = Buffer.alloc(body.length + 12);
  b.writeUInt32BE(body.length);
  b.write(type, 4);
  body.copy(b, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, -4)), b.length - 4);
  return b;
}
function fixture({
  width = 2,
  height = 1,
  depth = 8,
  color = 6,
  interlace = 0,
  rows = Buffer.from([0, 1, 2, 3, 255, 4, 5, 6, 255]),
  extras = [],
} = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = color;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    ...extras,
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const file = (body) => ({
  id: "image",
  name: "合成.png",
  body,
  size: body.length,
  hash: sha256(body),
});

test("16-bit PNG compares full transparency keys before linear rescaling, including low bits and partial alpha", () => {
  const gray = fixture({ width: 6, height: 1, depth: 16, color: 0,
    rows: Buffer.from([0, 0x12,0x34, 0x12,0x35, 0x12,0x80, 0,0x80, 0,0x81, 0xff,0xfe]),
    extras: [chunk("tRNS", Buffer.from([0x12,0x34]))] });
  assert.deepEqual([...decodePng(gray).pixels], [255,255,255,255, 18,18,18,255, 18,18,18,255,
    0,0,0,255, 1,1,1,255, 255,255,255,255]);
  const rgba = fixture({ width: 1, height: 1, depth: 16, color: 6,
    rows: Buffer.from([0, 0,0, 0x80,0, 0xff,0xff, 0x80,0]) });
  assert.deepEqual([...decodePng(rgba).pixels], [127,191,255,255]);
  const rgb = fixture({ width: 2, height: 1, depth: 16, color: 2,
    rows: Buffer.from([0, 0x12,0x34, 0x56,0x78, 0x9a,0xbc, 0x12,0x35, 0x56,0x78, 0x9a,0xbc]),
    extras: [chunk("tRNS", Buffer.from([0x12,0x34,0x56,0x78,0x9a,0xbc]))] });
  assert.deepEqual([...decodePng(rgb).pixels], [255,255,255,255, 18,86,154,255]);
});

test("PNG tiles preserve all pixels, row-major order, original coordinates and tail without durable image bytes", async () => {
  const width = 2071,
    height = 1031,
    pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels[p] = x % 256;
      pixels[p + 1] = y % 256;
      pixels[p + 2] = (x + y) % 256;
      pixels[p + 3] = 255;
    }
  const input = file(encodePng(width, height, pixels)),
    reconstructed = Buffer.alloc(pixels.length),
    ids = new Set();
  let tile = 1;
  do {
    const m = await readMaterial(input, { imageWindow: { tile } }),
      r = m.covered[0],
      s = m.segments[0];
    assert.equal(m.imagePagination.totalTiles, 6);
    assert.equal(r.tile, tile);
    assert.equal(r.start, tile - 1);
    assert.ok(!ids.has(s.sourceId));
    ids.add(s.sourceId);
    const raw = Buffer.from(s.image.data, "base64");
    assert.equal(sha256(raw), r.imageHash);
    const decoded = decodePng(raw);
    for (let y = 0; y < r.height; y++)
      decoded.pixels.copy(
        reconstructed,
        ((r.y + y) * width + r.x) * 4,
        y * r.width * 4,
        (y + 1) * r.width * 4,
      );
    const metadata = JSON.stringify(coverageOnly(modelMaterial(m)));
    assert.ok(!metadata.includes(s.image.data));
    assert.ok(!metadata.includes("base64"));
    assert.match(
      sourceLocation([coverageOnly(m)], s.sourceId),
      /图像模型识别.*像素/,
    );
    assert.equal(readingView([m])[0].state, tile === 6 ? "read" : "partial");
    tile = m.imagePagination.nextTile;
  } while (tile);
  assert.equal(sha256(reconstructed), sha256(pixels));
  assert.deepEqual(reconstructed.subarray(-4), pixels.subarray(-4));
});
test("PNG filtering, grayscale, palette transparency and hidden colors are normalized explicitly", () => {
  assert.deepEqual(
    [...decodePng(fixture()).pixels],
    [1, 2, 3, 255, 4, 5, 6, 255],
  );
  const hidden = encodePng(1, 1, Buffer.from([19, 27, 54, 0]));
  assert.deepEqual([...decodePng(hidden).pixels], [255, 255, 255, 255]);
  assert.deepEqual(
    [
      ...decodePng(fixture({ color: 0, rows: Buffer.from([0, 10, 20]) }))
        .pixels,
    ],
    [10, 10, 10, 255, 20, 20, 20, 255],
  );
  const palette = fixture({
    color: 3,
    rows: Buffer.from([0, 0, 1]),
    extras: [
      chunk("PLTE", Buffer.from([0, 0, 0, 20, 30, 40])),
      chunk("tRNS", Buffer.from([0, 255])),
    ],
  });
  assert.deepEqual(
    [...decodePng(palette).pixels],
    [255, 255, 255, 255, 20, 30, 40, 255],
  );
  for (const filter of [0, 1, 2, 3, 4]) {
    const rows = Buffer.from([
      filter,
      1,
      2,
      3,
      255,
      filter === 1 || filter === 4 ? 3 : filter === 3 ? 4 : 4,
      filter === 1 || filter === 4 ? 3 : filter === 3 ? 4 : 5,
      filter === 1 || filter === 4 ? 3 : filter === 3 ? 5 : 6,
      filter === 1 || filter === 4 ? 0 : filter === 3 ? 128 : 255,
    ]);
    assert.deepEqual(
      [...decodePng(fixture({ rows })).pixels],
      [1, 2, 3, 255, 4, 5, 6, 255],
    );
  }
});
test("PNG integrity, dimensions, decompression, animation, color/orientation and cursor violations fail closed", async () => {
  for (const input of [
    fixture({ width: 16385 }),
    fixture({ width: 8000, height: 8000 }),
    fixture({ interlace: 1 }),
    fixture({ depth: 16 }),
    fixture({ rows: Buffer.alloc(1_000_000) }),
    fixture({ extras: [chunk("acTL", Buffer.alloc(8))] }),
    fixture({ extras: [chunk("eXIf", Buffer.alloc(8))] }),
    Buffer.concat([fixture(), Buffer.from("tail")]),
  ]) {
    const m = await readMaterial(file(input), { imageWindow: { tile: 1 } });
    assert.equal(m.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(m.state));
  }
  const damaged = fixture();
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => decodePng(damaged), /PNG_CRC/);
  assert.throws(
    () => validateImageWindow({ tile: 1, path: "../../private" }),
    /INVALID_IMAGE_WINDOW/,
  );
  await assert.rejects(
    readMaterial(file(fixture()), { imageWindow: { tile: 2 } }),
    /IMAGE_CURSOR_OUT_OF_RANGE/,
  );
});
test("image provider sends only bounded inline PNGs, freezes a token envelope and preserves unknown on failure without retry", async () => {
  const m = await readMaterial(file(fixture()), { imageWindow: { tile: 1 } }),
    s = m.segments[0],
    sources = [{ id: s.sourceId, name: m.name, text: s.text, image: s.image }];
  let calls = 0;
  const provider = createDeepSeekReadingProvider({
    apiKey: "synthetic",
    priceAt: () => deepseekPriceSnapshots(1)[0].id,
    fetcher: async (url, init) => {
      calls++;
      const b = JSON.parse(init.body);
      assert.equal(
        b.messages[1].content.filter((c) => c.type === "image_url").length,
        1,
      );
      assert.equal(
        (
          init.body.match(
            new RegExp(s.image.data.replace(/[+]/g, "\\+"), "g"),
          ) || []
        ).length,
        1,
      );
      return Response.json({
        usage: { prompt_tokens: 100, completion_tokens: 10 },
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"summary":"合成","warnings":[],"items":[]}' },
          },
        ],
      });
    },
  });
  const prepared = provider.prepare(sources, { captureDate: "2026-10-29" });
  assert.ok(prepared.maxPromptTokens >= 1024);
  assert.ok(prepared.maxPromptTokens < 30000);
  assert.equal(
    (await provider(sources, undefined, { prepared })).usage.prompt_tokens,
    100,
  );
  assert.equal(calls, 1);
  for (const image of [
    { ...s.image, hash: "0".repeat(64) },
    { ...s.image, mime: "image/svg+xml" },
    { ...s.image, width: 8193 },
  ])
    assert.throws(
      () =>
        provider.prepare([{ ...sources[0], image }], {
          captureDate: "2026-10-29",
        }),
      /INVALID_PROVIDER_IMAGE/,
    );
  assert.throws(
    () =>
      provider.prepare(
        [sources[0], { ...sources[0], id: "b" }, { ...sources[0], id: "c" }],
        { captureDate: "2026-10-29" },
      ),
    /PROVIDER_IMAGE_LIMIT/,
  );
});

test("PNG transparency masks unused high sample bits and rejects unsupported color/background interpretation", async () => {
  const transparent = fixture({
    color: 0,
    rows: Buffer.from([0, 10, 20]),
    extras: [chunk("tRNS", Buffer.from([255, 10]))],
  });
  assert.deepEqual(
    [...decodePng(transparent).pixels],
    [255, 255, 255, 255, 20, 20, 20, 255],
  );
  for (const type of ["cICP", "mDCV", "cLLI", "bKGD"]) {
    const result = await readMaterial(
      file(fixture({ extras: [chunk(type, Buffer.alloc(8))] })),
      { imageWindow: { tile: 1 } },
    );
    assert.equal(result.state, "unsupported");
    assert.equal(result.segments.length, 0);
  }
});
test("PNG row filters with prior rows reconstruct fixed independent RGB goldens", () => {
  const encoded = [
    [11, 22, 33, 44, 55, 66],
    [11, 22, 33, 33, 33, 33],
    [1, 2, 3, 4, 5, 6],
    [6, 12, 18, 19, 19, 20],
    [1, 2, 3, 4, 5, 6],
  ];
  for (let filter = 0; filter < 5; filter++) {
    const bytes = fixture({
      width: 2,
      height: 2,
      color: 2,
      rows: Buffer.from([
        0,
        10,
        20,
        30,
        40,
        50,
        60,
        filter,
        ...encoded[filter],
      ]),
    });
    assert.deepEqual(
      [...decodePng(bytes).pixels],
      [10, 20, 30, 255, 40, 50, 60, 255, 11, 22, 33, 255, 44, 55, 66, 255],
    );
  }
});
