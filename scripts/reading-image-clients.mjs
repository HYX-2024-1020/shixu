import assert from "node:assert/strict";
import { encodePng } from "../server/reading/image.mjs";
import { runClientLoop } from "./reading-client-loop.mjs";
import { sourceLocation } from "../shared/reading-view.mjs";

export async function runImageClients({ directory, reader, deleted = false }) {
  const width = 2051,
    height = 4,
    pixels = Buffer.alloc(width * height * 4, 255);
  for (let x = 0; x < width; x++) pixels[x * 4] = x % 256;
  const body = encodePng(width, height, pixels);
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
      name: "合成图像.png",
      type: "image/png",
      body,
      expectedImageTiles: 3,
      verify({ win, mini, page, cloud }) {
        const c = win.readingCoverage[0];
        assert.equal(c.covered.length, 3);
        assert.equal(c.imagePagination.nextTile, null);
        assert.equal(c.imagePagination.totalTiles, 3);
        assert.deepEqual(
          c.covered.map((r) => [r.tile, r.x, r.y, r.width, r.height]),
          [
            [1, 0, 0, 1024, 4],
            [2, 1024, 0, 1024, 4],
            [3, 2048, 0, 3, 4],
          ],
        );
        assert.ok(!c.uncovered.some((r) => r.code === "IMAGE_WINDOW_PENDING"));
        assert.match(
          sourceLocation(win.readingCoverage, c.covered[2].sourceId),
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
    imageCoordinatesAndTail: true,
    model: "synthetic, no text recognition claim",
    originalMode: deleted ? "deleted" : "temporary",
  };
}
