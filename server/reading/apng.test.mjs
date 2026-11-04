import test from "node:test";
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectApng, decodeApng } from "./apng.mjs";
import { apngBytes, apngChunk, pngChunks } from "./apng-fixtures.mjs";
import { decodePng } from "./image.mjs";
import {
  readMaterial,
  sha256,
  modelMaterial,
  coverageOnly,
} from "./material.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { sourceLocation } from "../../shared/reading-view.mjs";
const file = (body, name = "animation.png") => ({
  id: "image",
  name,
  body,
  size: body.length,
  hash: sha256(body),
});
const rebuild = (chunks) =>
  Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ...chunks.map((c) => apngChunk(c.type, c.body)),
  ]);
test("APNG inherited 16-bit alpha and split frame streams retain normalization and fail on unsupported color metadata", async () => {
  const png = (values) => {
    const header = Buffer.from("00000001000000011006000000", "hex"),
      row = Buffer.alloc(9);
    values.forEach((v, i) => row.writeUInt16BE(v, 1 + i * 2));
    return rebuild([
      { type: "IHDR", body: header },
      { type: "IDAT", body: deflateSync(row) },
      { type: "IEND", body: Buffer.alloc(0) },
    ]);
  };
  const body = apngBytes({
      width: 1,
      height: 1,
      frames: [
        { png: png([65535, 0, 0, 65535]) },
        { png: png([0, 65535, 0, 32768]), blend: 1 },
      ],
    }),
    chunks = pngChunks(body),
    parts = [];
  for (const c of chunks) {
    if (c.type !== "fdAT") {
      parts.push(c);
      continue;
    }
    const half = Math.floor((c.body.length - 4) / 2);
    for (const [i, b] of [
      c.body.subarray(4, 4 + half),
      c.body.subarray(4 + half),
    ].entries()) {
      const d = Buffer.alloc(b.length + 4);
      d.writeUInt32BE(c.body.readUInt32BE(0) + i);
      b.copy(d, 4);
      parts.push({ type: "fdAT", body: d });
    }
  }
  assert.deepEqual(
    [...decodeApng(rebuild(parts), 2).pixels],
    [127, 128, 0, 255],
  );
  const bad = rebuild([
      chunks[0],
      { type: "iCCP", body: Buffer.from("unsupported") },
      ...chunks.slice(1),
    ]),
    m = await readMaterial(file(bad), { imageWindow: { tile: 1 } });
  assert.equal(m.state, "unsupported");
  assert.deepEqual(m.reasons, ["PNG_COLOR_OR_ORIENTATION_UNSUPPORTED"]);
  assert.equal(m.segments.length, 0);
});
test("APNG every frame matches independent browser source/over/disposal and poster goldens", () => {
  const golden = JSON.parse(
    readFileSync(new URL("./fixtures/apng-goldens.json", import.meta.url)),
  );
  for (const [name, expected] of Object.entries(golden.files)) {
    const body = readFileSync(new URL("./fixtures/" + name, import.meta.url));
    assert.equal(sha256(body), expected.sha256);
    const parsed = inspectApng(body);
    assert.equal(parsed.totalFrames, expected.frames.length);
    assert.equal(parsed.loops, expected.loops);
    for (const f of expected.frames) {
      const actual = decodeApng(body, f.frame, parsed);
      assert.equal(
        sha256(actual.pixels),
        f.pixelsHash,
        `${name} frame ${f.frame}`,
      );
      assert.equal(actual.frameDurationMs, f.delayMs);
    }
  }
});
test("APNG source/over alpha, previous/background and separate static poster preserve every pixel", () => {
  const body = apngBytes({
    width: 2,
    height: 1,
    poster: { pixels: Buffer.from([0, 255, 0, 255, 0, 255, 0, 255]) },
    frames: [
      {
        pixels: Buffer.from([255, 0, 0, 255, 255, 0, 0, 255]),
        delayNum: 3,
        delayDen: 0,
      },
      {
        width: 1,
        height: 1,
        x: 1,
        pixels: Buffer.from([0, 0, 255, 128]),
        blend: 1,
        disposal: 2,
        delayNum: 0,
      },
      { width: 1, height: 1, pixels: Buffer.from([0, 0, 0, 0]), disposal: 1 },
      { width: 1, height: 1, x: 1, pixels: Buffer.from([0, 0, 255, 255]) },
    ],
  });
  const expected = [
    [0, 255, 0, 255, 0, 255, 0, 255],
    [255, 0, 0, 255, 255, 0, 0, 255],
    [255, 0, 0, 255, 127, 0, 128, 255],
    [255, 255, 255, 255, 255, 0, 0, 255],
    [255, 255, 255, 255, 0, 0, 255, 255],
  ];
  for (let i = 0; i < expected.length; i++)
    assert.deepEqual([...decodeApng(body, i + 1).pixels], expected[i]);
  assert.equal(decodeApng(body, 1).frameRole, "default");
  assert.equal(decodeApng(body, 2).frameDurationMs, 30);
  assert.equal(decodeApng(body, 3).frameDurationMs, 0);
  assert.equal(decodeApng(body, 2).frameDelayDen, 0);
});
test("APNG strict sequence/control/data/CRC/trailing and resource failures precede all model input", async () => {
  const body = apngBytes({ frames: [{}, {}] }),
    chunks = pngChunks(body);
  const mutate = (type, edit) =>
    rebuild(
      chunks.map((c, i) => {
        if (c.type !== type) return c;
        const b = Buffer.from(c.body);
        edit(b, i);
        return { ...c, body: b };
      }),
    );
  const bad = [
    body.subarray(0, -1),
    Buffer.concat([body, Buffer.from([0])]),
    mutate("fdAT", (b) => b.writeUInt32BE(99)),
    mutate("fcTL", (b) => (b[25] = 2)),
    mutate("fcTL", (b) => b.writeUInt32BE(99, 12)),
    mutate("acTL", (b) => b.writeUInt32BE(3)),
    mutate("acTL", (b) => b.writeUInt32BE(0)),
    mutate("acTL", (b) => b.writeUInt32BE(65)),
    rebuild(chunks.filter((c) => c.type !== "acTL")),
    rebuild(chunks.filter((c) => c.type !== "fdAT")),
  ];
  const corrupt = Buffer.from(body);
  corrupt[corrupt.length - 1] ^= 1;
  bad.push(corrupt);
  // Last frame has valid CRC but an invalid zlib stream: first frame must not escape.
  bad.push(mutate("fdAT", (b) => b.fill(0, 4)));
  for (const bytes of bad) {
    const m = await readMaterial(file(bytes), { imageWindow: { tile: 1 } });
    assert.equal(m.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(m.state), JSON.stringify(m));
  }
  assert.throws(
    () =>
      inspectApng(
        apngBytes({
          width: 1025,
          height: 1025,
          frames: Array.from({ length: 17 }, () => ({})),
        }),
      ),
    /TILE_LIMIT/,
  );
  assert.throws(() => decodeApng(body, 3), /CURSOR_OUT_OF_RANGE/);
});
test("APNG top-level and ZIP frames/tiles reassemble in order, with source times, no hidden input persistence and archive tail", async () => {
  const width = 1027,
    height = 3,
    pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = i % 251;
    pixels[i + 1] = 71;
    pixels[i + 2] = 15;
    pixels[i + 3] = 255;
  }
  const body = apngBytes({
    width,
    height,
    frames: [
      { pixels },
      { pixels: Buffer.from(pixels).reverse(), delayNum: 2 },
    ],
  });
  for (const archive of [false, true]) {
    const bytes = archive
        ? zipBytes({
            "animation.png": body,
            "tail.txt": Buffer.from("尾部唯一标记"),
          })
        : body,
      rebuilt = [Buffer.alloc(pixels.length), Buffer.alloc(pixels.length)];
    let cursor = archive ? FIRST_ARCHIVE_WINDOW : { tile: 1 },
      tail = false,
      count = 0;
    while (cursor) {
      const m = await readMaterial(
        file(bytes, archive ? "archive.zip" : "animation.png"),
        archive ? { archiveWindow: cursor } : { imageWindow: cursor },
      );
      assert.notEqual(m.state, "failed", JSON.stringify(m));
      for (const s of m.segments) {
        if (!s.image) {
          assert.equal(s.text, "尾部唯一标记");
          tail = true;
          continue;
        }
        count++;
        const r = s.range,
          decoded = decodePng(Buffer.from(s.image.data, "base64"));
        for (let y = 0; y < r.height; y++)
          decoded.pixels.copy(
            rebuilt[r.frame - 1],
            ((r.y + y) * width + r.x) * 4,
            y * r.width * 4,
            (y + 1) * r.width * 4,
          );
        assert.match(sourceLocation([m], s.sourceId), /帧/);
        assert.ok(
          !JSON.stringify(coverageOnly(modelMaterial(m))).includes(
            s.image.data,
          ),
        );
      }
      cursor = archive
        ? m.archivePagination.next
        : m.imagePagination.nextTile
          ? { tile: m.imagePagination.nextTile }
          : null;
    }
    assert.equal(count, 4);
    assert.equal(tail, archive);
    for (let i = 0; i < 2; i++)
      assert.deepEqual(rebuilt[i], decodeApng(body, i + 1).pixels);
  }
});

import {
  rarBytes,
  rar4Bytes,
  sevenZipBytes,
} from "./native-archive-fixtures.mjs";
import { officeImageBytes } from "./office-fixtures.mjs";
for (const format of ["rar4", "rar", "7z"])
  test(
    "APNG " + format + " keeps complete frames and archive tail",
    async () => {
      const body = apngBytes({ frames: [{}, {}] }),
        entries = { "01.apng": body, "02.txt": Buffer.from("尾部唯一标记") },
        bytes =
          format === "rar4"
            ? rar4Bytes(entries)
            : format === "rar"
              ? rarBytes(entries)
              : await sevenZipBytes(entries);
      let cursor = FIRST_ARCHIVE_WINDOW,
        count = 0,
        tail = false;
      while (cursor) {
        const m = await readMaterial(
          file(bytes, "archive." + (format === "rar4" ? "rar" : format)),
          { archiveWindow: cursor },
        );
        assert.notEqual(m.state, "failed", JSON.stringify(m));
        for (const s of m.segments) {
          if (s.image) {
            count++;
            assert.equal(s.range.archivePath, "01.apng");
            assert.equal(s.range.frame, count);
            assert.deepEqual(
              decodePng(Buffer.from(s.image.data, "base64")).pixels,
              decodeApng(body, count).pixels,
            );
          } else {
            assert.equal(s.text, "尾部唯一标记");
            tail = true;
          }
        }
        cursor = m.archivePagination.next;
      }
      assert.equal(count, 2);
      assert.equal(tail, true);
    },
  );
for (const kind of ["docx", "xlsx"])
  test(
    "Office " +
      kind +
      " referenced animated PNG retains anchors and both frames",
    async () => {
      const body = officeImageBytes(kind, {
        body: apngBytes({ frames: [{}, {}] }),
      imageExtension:kind==="docx"?"apng":"png",
      }).body;
      let cursor = { text: 1, image: 0, tile: 1, offset: 0 },
        frames = [];
      while (cursor) {
        const m = await readMaterial(file(body, "office." + kind), {
          officeWindow: cursor,
        });
        assert.notEqual(m.state, "failed", JSON.stringify(m));
        frames.push(...m.covered.filter((r) => r.kind === "image"));
        cursor = m.officePagination.next;
      }
      assert.deepEqual(
        frames.map((r) => r.frame),
        [1, 2],
      );
      assert.ok(
        frames.every(
          (r) =>
            r.officeKind === kind &&
            (kind === "docx" ? r.paragraph === 2 : r.cell === "B3"),
        ),
      );
    },
  );
