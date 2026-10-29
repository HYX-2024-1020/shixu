import assert from "node:assert/strict";
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
}) {
  const width = 2051,
    height = 4,
    pixels = Buffer.alloc(width * height * 4, 255);
  for (let x = 0; x < width; x++) pixels[x * 4] = x % 256;
  const png = encodePng(width, height, pixels);
  const entries = {
    "01.txt": Buffer.from("包内前言"),
    "02.png": png,
    "03.txt": Buffer.from("尾部唯一标记"),
  };
  const body = !archiveFormat
    ? png
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
    sourceByMini: true,
    startByMini: true,
    reviseAfterPublication: true,
    ...(deleted
      ? { deleteBeforeStart: true }
      : { originalQuota: 1, expireBeforeStart: true }),
    original: {
      name: archiveFormat
        ? "包内图像." + (archiveFormat === "rar4" ? "rar" : archiveFormat)
        : "合成图像.png",
      type: archiveFormat ? "application/octet-stream" : "image/png",
      body,
      expectedImageTiles: 3,
      verify({ win, mini, page, cloud }) {
        const c = win.readingCoverage[0];
        assert.equal(c.covered.length, archiveFormat ? 5 : 3);
        if (archiveFormat) {
          assert.equal(c.archivePagination.next, null);
          assert.deepEqual(c.archiveImageTiles, [
            { archivePath: "02.png", checked: 3, total: 3 },
          ]);
        } else {
          assert.equal(c.imagePagination.nextTile, null);
          assert.equal(c.imagePagination.totalTiles, 3);
        }
        const images = c.covered.filter((r) => r.kind === "image");
        if (archiveFormat)
          assert.ok(images.every((r) => r.archivePath === "02.png"));
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
    ...(archiveFormat
      ? {
          archiveFormat,
          archiveHash: sha256(body),
          originalImageHash: sha256(png),
          pixelsHash: sha256(pixels),
        }
      : {}),
    imageCoordinatesAndTail: true,
    model: "synthetic, no text recognition claim",
    originalMode: deleted ? "deleted" : "temporary",
  };
}
