import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import { apngBytes } from "../server/reading/apng-fixtures.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { sourceLocation } from "../shared/reading-view.mjs";
export async function runApngClients({
  directory,
  reader,
  deleted = false,
  archive = false,
} = {}) {
  const animation = apngBytes({
      width: 9,
      height: 11,
      frames: [
        { delayNum: 3, delayDen: 100 },
        { delayNum: 7, delayDen: 100, disposal: 1 },
      ],
    }),
    body = archive ? zipBytes({ "animation.apng": animation }) : animation;
  const report = await runClientLoop({
    directory,
    reader:
      reader ||
      Object.assign((f, o) => readMaterial(f, o), {
        pdfWindows: true,
        imageWindows: true,
        archiveWindows: true,
      }),
    originalQuota: 1,
    expireBeforeStart: !deleted,
    deleteBeforeStart: deleted,
    sourceByMini: true,
    startByMini: true,
    original: {
      name: archive ? "合成.zip" : "合成.apng",
      type: archive ? "application/zip" : "image/apng",
      body,
      expectedImageTiles: 2,
      verify: ({ win, mini, page, cloud }) => {
        assert.deepEqual(
          win.readingCoverage,
          JSON.parse(JSON.stringify(mini.readingCoverage)),
        );
        const rows = win.readingCoverage[0].covered;
        assert.deepEqual(
          rows.map((r) => [r.frame, r.frameStartMs, r.frameDurationMs]),
          [
            [1, 0, 30],
            [2, 30, 70],
          ],
        );
        assert.ok(rows.every((r) => r.frameRole === "animation"));
        if (archive)
          assert.ok(rows.every((r) => r.archivePath === "animation.apng"));
        assert.match(
          sourceLocation(win.readingCoverage, rows[1].sourceId),
          /第 2\/2 帧/,
        );
        assert.equal(win.result.items.length, 1);
        assert.equal(win.result.items[0].evidence.length, 2);
        assert.match(
          page.data.jobs.find((j) => j.id === cloud.readJobs()[0].id)
            .pdfProgressLabel,
          /2 \/ 2 个图像区域/,
        );
      },
    },
    semanticMerge: {
      provider: async (sources) => {
        const rows = JSON.parse(sources[0].text).items;
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: { same: [[rows[0].id, rows[1].id]], related: [] },
        };
      },
      verify: () => {},
    },
  });
  return {
    ...report,
    animationFrames: 2,
    frameTimesEqualBoth: true,
    archive,
    deleted,
  };
}
