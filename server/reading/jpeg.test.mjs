import test from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import { decodeJpeg, inspectJpeg, jpegPixelIndex } from "./jpeg.mjs";
import { decodePng } from "./image.mjs";
import { readMaterial, sha256, coverageOnly } from "./material.mjs";
import { jpegSample, jpegApp, jpegExif } from "./jpeg-fixtures.mjs";
import { ReadingWindows } from "./windows.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import {
  rarBytes,
  rar4Bytes,
  sevenZipBytes,
} from "./native-archive-fixtures.mjs";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImageClients } from "../../scripts/reading-image-clients.mjs";
const descriptor = (body, name = "合成.jpg") => ({
  id: "jpeg",
  name,
  body,
  size: body.length,
  hash: sha256(body),
});
const verifier = Object.create(ReadingWindows.prototype);

test("all eight EXIF orientations map fixed source pixels without allocating a second frame", () => {
  const expected = [
    [0, 1, 2, 3, 4, 5],
    [2, 1, 0, 5, 4, 3],
    [5, 4, 3, 2, 1, 0],
    [3, 4, 5, 0, 1, 2],
    [0, 3, 1, 4, 2, 5],
    [3, 0, 4, 1, 5, 2],
    [5, 2, 4, 1, 3, 0],
    [2, 5, 1, 4, 0, 3],
  ];
  for (let orientation = 1; orientation <= 8; orientation++) {
    const image = { encodedWidth: 3, encodedHeight: 2, orientation },
      width = orientation >= 5 ? 2 : 3,
      height = orientation >= 5 ? 3 : 2,
      indices = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        indices.push(jpegPixelIndex(image, x, y) / 4);
    assert.deepEqual(indices, expected[orientation - 1]);
  }
});
for (const bigEndian of [false, true])
  for (let orientation = 1; orientation <= 8; orientation++)
    test(`JPEG EXIF ${orientation} ${bigEndian ? "MM" : "II"} orientation matches independent native raster`, async () => {
      const f = jpegSample({ orientation, bigEndian }),
        image = decodeJpeg(f.body);
      const m = await readMaterial(descriptor(f.body), {
        imageWindow: { tile: 1 },
      });
      verifier.verify(m, undefined, undefined, { tile: 1 });
      const pixels = decodePng(
        Buffer.from(m.segments[0].image.data, "base64"),
      ).pixels;
      const w = f.width,
        h = f.height,
        matrices = [
          "1 0 0 1 0 0",
          `-1 0 0 1 ${w} 0`,
          `-1 0 0 -1 ${w} ${h}`,
          `1 0 0 -1 0 ${h}`,
          "0 1 1 0 0 0",
          `0 1 -1 0 ${h} 0`,
          `0 -1 -1 0 ${h} ${w}`,
          `0 -1 1 0 0 ${w}`,
        ];
      const native = new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${image.width}" height="${image.height}"><image width="${w}" height="${h}" transform="matrix(${matrices[orientation - 1]})" xlink:href="data:image/jpeg;base64,${f.plain.toString("base64")}"/></svg>`,
        { font: { loadSystemFonts: false }, imageRendering: 1 },
      ).render().pixels;
      let max = 0,
        sum = 0;
      for (let i = 0; i < pixels.length; i++) {
        const error = Math.abs(pixels[i] - native[i]);
        max = Math.max(max, error);
        sum += error;
      }
      assert.ok(max <= 4, `IDCT max difference ${max}`);
      assert.ok(
        sum / pixels.length <= 0.75,
        `IDCT mean difference ${sum / pixels.length}`,
      );
      assert.equal(m.covered[0].orientation, orientation);
      assert.equal(m.covered[0].encodedWidth, w);
      assert.ok(!JSON.stringify(coverageOnly(m)).includes("Exif"));
      const bad = structuredClone(m);
      bad.imagePagination.orientation = 9;
      assert.throws(
        () => verifier.verify(bad, undefined, undefined, { tile: 1 }),
        /INVALID_READER_WINDOW/,
      );
    });

test("rotated JPEG top-level and archive tile windows preserve every decoded pixel, path, coordinates and tail", async () => {
  const f = jpegSample({ width: 7, height: 2051, orientation: 6 }),
    image = decodeJpeg(f.body),
    expected = Buffer.alloc(image.width * image.height * 4);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const from = jpegPixelIndex(image, x, y);
      image.pixels.copy(expected, (y * image.width + x) * 4, from, from + 4);
    }
  for (const format of [null, "zip", "rar4", "rar", "7z"]) {
    const archived = !!format;
    const entries = {
      "photo.JPG": f.body,
      "tail.txt": Buffer.from("尾部唯一标记"),
    };
    const archiveBody = !archived
      ? null
      : format === "zip"
        ? zipBytes(entries)
        : format === "rar4"
          ? rar4Bytes(entries)
          : format === "rar"
            ? rarBytes(entries)
            : await sevenZipBytes(entries);
    const file = descriptor(
      archived ? archiveBody : f.body,
      archived ? "photo." + (format === "rar4" ? "rar" : format) : "photo.jpeg",
    );
    let cursor = archived ? FIRST_ARCHIVE_WINDOW : { tile: 1 },
      count = 0;
    const reconstructed = Buffer.alloc(expected.length);
    while (cursor) {
      const m = await readMaterial(
        file,
        archived ? { archiveWindow: cursor } : { imageWindow: cursor },
      );
      verifier.verify(
        m,
        undefined,
        archived ? cursor : undefined,
        archived ? undefined : cursor,
      );
      if (m.segments[0]?.image) {
        const s = m.segments[0],
          r = s.range,
          p = decodePng(Buffer.from(s.image.data, "base64")).pixels;
        for (let y = 0; y < r.height; y++)
          p.copy(
            reconstructed,
            ((r.y + y) * image.width + r.x) * 4,
            y * r.width * 4,
            (y + 1) * r.width * 4,
          );
        assert.equal(r.orientation, 6);
        assert.equal(r.encodedHeight, 2051);
        if (archived) assert.equal(r.archivePath, "photo.JPG");
        count++;
      } else assert.equal(m.segments[0].text, "尾部唯一标记");
      cursor = archived
        ? m.archivePagination.next
        : m.imagePagination.nextTile
          ? { tile: m.imagePagination.nextTile }
          : null;
    }
    assert.equal(count, 3);
    assert.deepEqual(reconstructed, expected);
  }
});

function replaceSegment(body, marker, change) {
  for (let p = 2; p < body.length; ) {
    const id = body[p + 1],
      length = body.readUInt16BE(p + 2),
      end = p + 2 + length;
    if (id === marker)
      return Buffer.concat([
        body.subarray(0, p),
        jpegApp(id, change(Buffer.from(body.subarray(p + 4, end)))),
        body.subarray(end),
      ]);
    if (id === 0xda) break;
    p = end;
  }
  throw Error("FIXTURE_MARKER_NOT_FOUND");
}
test("JPEG full preflight and strict decoder reject damaged, ambiguous, color-managed, multi-image and oversized inputs", async () => {
  const f = jpegSample(),
    append = (marker, body) =>
      Buffer.concat([
        f.body.subarray(0, 2),
        jpegApp(marker, body),
        f.body.subarray(2),
      ]);
  const badExif = jpegExif(6);
  badExif.writeUInt32LE(0xffffffff, 10);
  const badInputs = [
    f.body.subarray(0, -2),
    Buffer.concat([f.body, Buffer.from([0])]),
    Buffer.concat([f.body, f.body]),
    Buffer.concat([
      f.body.subarray(0, f.body.length - 9),
      Buffer.from([255, 217]),
    ]),
    append(0xe2, Buffer.from("ICC_PROFILE\0")),
    append(0xe2, Buffer.from("MPF\0")),
    append(0xe1, jpegExif(1)),
    replaceSegment(f.body, 0xe1, () => badExif),
    replaceSegment(f.body, 0xe1, () => jpegExif(0)),
    replaceSegment(f.body, 0xe1, () => jpegExif(9)),
    replaceSegment(f.body, 0xc0, (b) => {
      b[0] = 12;
      return b;
    }),
    replaceSegment(f.body, 0xc0, (b) => {
      b.writeUInt16BE(16385, 3);
      return b;
    }),
    replaceSegment(f.body, 0xdb, (b) => {
      b[1] = 0;
      return b;
    }),
    replaceSegment(f.body, 0xc4, (b) => {
      b[1] = 255;
      return b;
    }),
    Buffer.concat([
      f.body.subarray(0, 2),
      ...Array(8193).fill(jpegApp(0xfe, Buffer.alloc(0))),
      f.body.subarray(2),
    ]),
  ];
  for (const body of badInputs) {
    const m = await readMaterial(descriptor(body), {
      imageWindow: { tile: 1 },
    });
    assert.equal(m.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(m.state));
  }
  assert.throws(() => inspectJpeg(Buffer.from("not JPEG")), /FORMAT_MISMATCH/);
  const large = replaceSegment(f.body, 0xc0, (b) => {
    b.writeUInt16BE(6000, 3);
    b.writeUInt16BE(5000, 1);
    return b;
  });
  const limited = await readMaterial(descriptor(large), {
    imageWindow: { tile: 1 },
  });
  assert.deepEqual(limited.reasons, ["JPEG_RESOURCE_LIMIT"]);
  assert.equal(limited.segments.length, 0);
});

for (const fixtureName of ["progressive", "restart"])
  test(`${fixtureName} JPEG matches an independently generated Pillow/libjpeg pixel golden`, () => {
    const body = readFileSync(
      new URL(`./fixtures/jpeg-${fixtureName}.jpg`, import.meta.url),
    );
    const golden = JSON.parse(
      readFileSync(
        new URL(`./fixtures/jpeg-${fixtureName}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(sha256(body), golden.inputHash);
    assert.equal(inspectJpeg(body).progressive, true);
    const pixels = decodeJpeg(body).pixels,
      expected = Buffer.from(golden.pixelsHex, "hex");
    assert.equal(sha256(expected), golden.pixelsHash);
    let max = 0,
      sum = 0;
    for (let i = 0; i < pixels.length; i++) {
      const difference = Math.abs(pixels[i] - expected[i]);
      max = Math.max(max, difference);
      sum += difference;
    }
    assert.ok(max <= 2);
    assert.ok(sum / pixels.length < 0.5);
  });

for (const archiveFormat of [undefined, "zip"])
  test(
    `rotated JPEG ${archiveFormat || "top-level"} client recovery reuses paid tiles and retains original gates`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-jpeg-clients-"));
      try {
        await runImageClients({
          directory,
          jpeg: true,
          archiveFormat,
          deleted: !!archiveFormat,
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
            imageWindows: true,
            archiveWindows: true,
          }),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

test("EXIF sub-IFD color proof is bounded and cannot hide a cycle, duplicate orientation or non-sRGB interpretation", async () => {
  const sample = jpegSample();
  const colorExif = (space) => {
    const t = Buffer.alloc(56);
    t.write("II");
    t.writeUInt16LE(42, 2);
    t.writeUInt32LE(8, 4);
    t.writeUInt16LE(2, 8);
    t.writeUInt16LE(0x112, 10);
    t.writeUInt16LE(3, 12);
    t.writeUInt32LE(1, 14);
    t.writeUInt16LE(6, 18);
    t.writeUInt16LE(0x8769, 22);
    t.writeUInt16LE(4, 24);
    t.writeUInt32LE(1, 26);
    t.writeUInt32LE(38, 30);
    t.writeUInt16LE(1, 38);
    t.writeUInt16LE(0xa001, 40);
    t.writeUInt16LE(3, 42);
    t.writeUInt32LE(1, 44);
    t.writeUInt16LE(space, 48);
    return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
  };
  const accepted = replaceSegment(sample.body, 0xe1, () => colorExif(1));
  assert.equal(inspectJpeg(accepted).orientation, 6);
  const cycle = jpegExif(1);
  cycle.writeUInt32LE(8, cycle.length - 4);
  const notSrgb = replaceSegment(sample.body, 0xe1, () => colorExif(2));
  const invalidData = jpegExif(1);
  invalidData.writeUInt32LE(0xffffffff, 20);
  for (const body of [
    notSrgb,
    replaceSegment(sample.body, 0xe1, () => cycle),
    replaceSegment(sample.body, 0xe1, () => invalidData),
    replaceSegment(sample.body, 0xe1, () =>
      Buffer.from("http://ns.adobe.com/xap/1.0/\0xmp"),
    ),
  ]) {
    const m = await readMaterial(descriptor(body), {
      imageWindow: { tile: 1 },
    });
    assert.equal(m.segments.length, 0);
  }
});

test("strict decoder refuses unused entropy suffixes, invalid padding and wrong restart sequence", () => {
  const f = jpegSample(),
    tail = Buffer.concat([
      f.body.subarray(0, -2),
      Buffer.from([1, 2, 3]),
      f.body.subarray(-2),
    ]);
  assert.throws(() => decodeJpeg(tail), /JPEG_MALFORMED/);
  const padding = Buffer.from(jpegSample({ width: 1, height: 1 }).body);
  padding[padding.length - 3] &= 254;
  assert.throws(() => decodeJpeg(padding), /JPEG_MALFORMED/);
  const restart = readFileSync(
    new URL("./fixtures/jpeg-restart.jpg", import.meta.url),
  );
  const at = restart.indexOf(Buffer.from([255, 208]));
  assert.ok(at > 0);
  const wrong = Buffer.from(restart);
  wrong[at + 1] = 210;
  assert.throws(() => inspectJpeg(wrong), /JPEG_MALFORMED/);
  assert.throws(
    () =>
      inspectJpeg(
        Buffer.concat([restart.subarray(0, at), restart.subarray(at + 2)]),
      ),
    /JPEG_MALFORMED/,
  );
});
