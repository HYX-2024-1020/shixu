import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeJpeg, jpegPixelIndex } from "../server/reading/jpeg.mjs";
import { decodePng } from "../server/reading/image.mjs";
import { jpegSample } from "../server/reading/jpeg-fixtures.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
const rows = [];
for (const bigEndian of [false, true])
  for (let orientation = 1; orientation <= 8; orientation++) {
    const f = jpegSample({ orientation, bigEndian }),
      image = decodeJpeg(f.body);
    const m = await readMaterial(
      {
        id: "sample",
        name: "sample.jpg",
        body: f.body,
        size: f.body.length,
        hash: sha256(f.body),
      },
      { imageWindow: { tile: 1 } },
    );
    const actual = decodePng(
        Buffer.from(m.segments[0].image.data, "base64"),
      ).pixels,
      expected = Buffer.alloc(actual.length);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const i = jpegPixelIndex(image, x, y);
        image.pixels.copy(expected, (y * image.width + x) * 4, i, i + 4);
      }
    assert.deepEqual(actual, expected);
    rows.push({
      orientation,
      bigEndian,
      inputHash: sha256(f.body),
      pixelsHash: sha256(actual),
    });
  }
const goldens = [];
for (const name of ["progressive", "restart"]) {
  const body = readFileSync(
    new URL(
      "../server/reading/fixtures/jpeg-" + name + ".jpg",
      import.meta.url,
    ),
  );
  const golden = JSON.parse(
    readFileSync(
      new URL(
        "../server/reading/fixtures/jpeg-" + name + ".json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(sha256(body), golden.inputHash);
  const actual = decodeJpeg(body).pixels,
    expected = Buffer.from(golden.pixelsHex, "hex");
  assert.equal(sha256(expected), golden.pixelsHash);
  let max = 0,
    total = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    max = Math.max(max, d);
    total += d;
  }
  assert.ok(max <= 2 && total / actual.length < 0.5);
  goldens.push({
    name,
    inputHash: golden.inputHash,
    maxDifference: max,
    meanDifference: total / actual.length,
  });
}
const f = jpegSample();
assert.throws(
  () =>
    decodeJpeg(
      Buffer.concat([
        f.body.subarray(0, -2),
        Buffer.from([1, 2, 3]),
        f.body.subarray(-2),
      ]),
    ),
  /JPEG_MALFORMED/,
);
console.log(
  JSON.stringify({
    synthetic: true,
    realProviderCalls: 0,
    orientationCases: rows.length,
    fixtureSetHash: sha256(JSON.stringify(rows)),
    goldens,
    strictUnusedSuffixDenied: true,
  }),
);
