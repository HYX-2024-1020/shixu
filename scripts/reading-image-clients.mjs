import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodingPng } from "../server/reading/png-encoding-fixtures.mjs";
import { encodePng } from "../server/reading/image.mjs";
import { runClientLoop } from "./reading-client-loop.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import {
  rarBytes,
  rar4Bytes,
  sevenZipBytes,
} from "../server/reading/native-archive-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
import { sourceLocation } from "../shared/reading-view.mjs";

export async function runImageClients({
  directory,
  reader,
  deleted = false,
  archiveFormat,
  packed = false,
  sixteen = false,
  jpeg = false,
  gif = false,
  webp = false,
  visualReview,
}) {
  const width = 2051,
    height = 4;
  let pixels = Buffer.alloc(width * height * 4, 255);
  for (let x = 0; x < width; x++) pixels[x * 4] = x % 256;
  const encoded = packed || sixteen
    ? encodingPng({
        width,
        height,
        depth: sixteen ? 16 : 2,
        color: sixteen ? 6 : 3,
        interlace: 1,
        transparency: true,
      })
    : null;
  if (encoded) pixels = encoded.pixels;
  const jpegFixture = jpeg
    ? await import("../server/reading/jpeg-fixtures.mjs")
    : null;
  const gifFixture = gif ? await import("../server/reading/gif-fixtures.mjs") : null;
  const imageBody = webp ? await readFile(new URL("../server/reading/fixtures/webp-wide.webp",import.meta.url)) : gif ? gifFixture.gifBytes({width,height}) : jpeg
    ? jpegFixture.jpegSample({ width: height, height: width, orientation: 6 })
        .body
    : encoded?.body || encodePng(width, height, pixels);
  if(gif) pixels=(await import("../server/reading/gif.mjs")).decodeGif(imageBody).pixels;
  if(webp){
    const {decodeWebp}=await import("../server/reading/webp.mjs");
    for(let tile=1;tile<=3;tile++){const image=await decodeWebp(imageBody,tile);
      for(let y=0;y<height;y++)image.pixels.copy(pixels,(y*width+image.x)*4,y*image.tileWidth*4,(y+1)*image.tileWidth*4);}
    const golden=JSON.parse(await readFile(new URL("../server/reading/fixtures/webp-goldens.json",import.meta.url),"utf8")).files["webp-wide.webp"];
    assert.equal(sha256(pixels),golden.frames[0].pixelsHash);
  }
  const imagePath=webp ? "02.webp" : gif ? "02.gif" : jpeg ? "02.jpg" : "02.png";
  const entries = {
    "01.txt": Buffer.from("包内前言"),
    [imagePath]: imageBody,
    "03.txt": Buffer.from("尾部唯一标记"),
  };
  const body = !archiveFormat
    ? imageBody
    : archiveFormat === "zip"
      ? zipBytes(entries)
      : archiveFormat === "rar4"
        ? rar4Bytes(entries)
        : archiveFormat === "rar"
          ? rarBytes(entries)
          : await sevenZipBytes(entries);
  const result = await runClientLoop({
    directory,
    reader,
    visualReview,
    sourceByMini: true,
    startByMini: true,
    reviseAfterPublication: true,
    ...(deleted
      ? { deleteBeforeStart: true }
      : { originalQuota: 1, expireBeforeStart: true }),
    original: {
      name: archiveFormat
        ? "包内图像." + (archiveFormat === "rar4" ? "rar" : archiveFormat)
        : webp ? "合成图像.webp" : gif ? "合成图像.gif" : jpeg
          ? "合成图像.jpg"
          : "合成图像.png",
      type: archiveFormat
        ? "application/octet-stream"
        : webp ? "image/webp" : gif ? "image/gif" : jpeg
          ? "image/jpeg"
          : "image/png",
      body,
      expectedImageTiles: 3,
      verify({ win, mini, page, cloud }) {
        const c = win.readingCoverage[0];
        assert.equal(c.covered.length, archiveFormat ? 5 : 3);
        if (archiveFormat) {
          assert.equal(c.archivePagination.next, null);
          assert.deepEqual(c.archiveImageTiles, [
            { archivePath: imagePath, checked: 3, total: 3 },
          ]);
        } else {
          assert.equal(c.imagePagination.nextTile, null);
          assert.equal(c.imagePagination.totalTiles, 3);
        }
        const images = c.covered.filter((r) => r.kind === "image");
        if (archiveFormat)
          assert.ok(
            images.every((r) => r.archivePath === imagePath),
          );
        assert.deepEqual(
          images.map((r) => [r.tile, r.x, r.y, r.width, r.height]),
          [
            [1, 0, 0, 1024, 4],
            [2, 1024, 0, 1024, 4],
            [3, 2048, 0, 3, 4],
          ],
        );
        assert.ok(!c.uncovered.some((r) => r.code === "IMAGE_WINDOW_PENDING"));
        assert.match(
          sourceLocation(win.readingCoverage, images[2].sourceId),
          /像素\(2048,0,3,4\)/,
        );
        assert.equal(
          JSON.stringify(win.readingCoverage),
          JSON.stringify(mini.readingCoverage),
        );
        assert.match(
          page.data.jobs.find((j) => j.id === cloud.readJobs()[0].id)
            .pdfProgressLabel,
          /已检查 3 \/ 3 个图像区域/,
        );
        assert.ok(!JSON.stringify(c).includes("base64"));
      },
    },
  });
  return {
    ...result,
    imageTiles: 3,
    ...(jpeg
      ? { jpeg: true, exifOrientation: 6, originalImageHash: sha256(imageBody) }
      : {}),
    ...(packed
      ? {
          packedAdam7: true,
          originalImageHash: sha256(imageBody),
          ...(jpeg ? {} : { pixelsHash: sha256(pixels) }),
        }
      : {}),
    ...(archiveFormat
      ? {
          archiveFormat,
          archiveHash: sha256(body),
          originalImageHash: sha256(imageBody),
          pixelsHash: sha256(pixels),
        }
      : {}),
    imageCoordinatesAndTail: true,
    model: "synthetic, no text recognition claim",
    originalMode: deleted ? "deleted" : "temporary",
  };
}
