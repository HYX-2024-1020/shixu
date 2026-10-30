// Headless cross-platform pixel checks; the independent native oracle remains
// in png-encoding.test.mjs and needs the repository's development dependencies.
import assert from "node:assert/strict";
import { encodingPng } from "../server/reading/png-encoding-fixtures.mjs";
import { decodePng } from "../server/reading/image.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";
const rows = [];
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
  ])
    for (const [width, height] of [
      [1, 1],
      [1, 9],
      [9, 1],
      [19, 11],
    ]) {
      const f = encodingPng({
        interlace,
        color,
        depth,
        width,
        height,
        transparency: true,
      });
      assert.deepEqual(decodePng(f.body).pixels, f.pixels);
      const input = {
        id: "sample",
        name: "sample.png",
        body: f.body,
        size: f.body.length,
        hash: sha256(f.body),
      };
      const material = await readMaterial(input, { imageWindow: { tile: 1 } });
      assert.equal(material.imagePagination.totalTiles, 1);
      assert.deepEqual(
        decodePng(Buffer.from(material.segments[0].image.data, "base64"))
          .pixels,
        f.pixels,
      );
      rows.push({
        interlace,
        color,
        depth,
        width,
        height,
        inputHash: input.hash,
        pixelsHash: sha256(f.pixels),
      });
    }
console.log(
  JSON.stringify({
    synthetic: true,
    realProviderCalls: 0,
    cases: rows.length,
    fixtureSetHash: sha256(JSON.stringify(rows)),
    allPixelsAndNormalizedModelInputsEqual: true,
  }),
);
