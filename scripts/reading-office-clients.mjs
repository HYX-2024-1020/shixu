import assert from "node:assert/strict";
import { officeImageBytes } from "../server/reading/office-fixtures.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import { rar4Bytes } from "../server/reading/native-archive-fixtures.mjs";
import { runClientLoop } from "./reading-client-loop.mjs";
import { sourceLocation, imageProgressView } from "../shared/reading-view.mjs";
export async function runOfficeClients({
  directory,
  reader,
  format = "docx",
  deleted = false,
  archiveFormat,
}) {
  const sample = officeImageBytes(format),
    entries = {
      "01.txt": Buffer.from("前言"),
      ["02." + format]: sample.body,
      "03.txt": Buffer.from("归档尾部唯一标记"),
    };
  const body =
    archiveFormat === "zip"
      ? zipBytes(entries)
      : archiveFormat === "rar4"
        ? rar4Bytes(entries)
        : sample.body;
  let reviews = 0;
  const report = await runClientLoop({
    directory,
    reader,
    sourceByMini: true,
    startByMini: true,
    deleteBeforeStart: deleted,
    expireBeforeStart: !deleted,
    reviseAfterPublication: true,
    visualReview: {
      provider: async (sources) => {
        reviews++;
        assert.ok(sources.some((s) => s.image));
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: {
            claims: JSON.parse(sources[0].text).claims.map((c) => ({
              id: c.id,
              status: "supported",
              reason: "",
            })),
          },
        };
      },
      verify: async ({ page, cloud, ledger, account }) => {
        const win = cloud.readJobs()[0],
          mini = page._jobs.find((j) => j.id === win.id);
        assert.equal(win.completedVisualBatches, 3);
        assert.equal(mini.completedVisualBatches, 3);
        assert.equal(win.rootSpent, ledger.wallet(account).spent);
      },
    },
    original: {
      body,
      name:
        "合成." + (archiveFormat === "rar4" ? "rar" : archiveFormat || format),
      type: "application/octet-stream",
      expectedImageTiles: 3,
      verify({ win, mini, page, cloud }) {
        const c = win.readingCoverage[0],
          images = c.covered.filter((r) => r.kind === "image");
        assert.equal(images.length, 3);
        assert.deepEqual(
          images.map((r) => r.x),
          [0, 1024, 2048],
        );
        assert.ok(
          images.every(
            (r) =>
              r.officeKind === format &&
              r.mediaPart ===
                (format === "docx" ? "word" : "xl") + "/media/图像.png",
          ),
        );
        assert.equal(c.officeImageParts[0].checked, 3);
        assert.equal(c.officeImageParts[0].total, 3);
        if (archiveFormat) {
          assert.equal(c.archivePagination.next, null);
          assert.ok(images.every((r) => r.archivePath === "02." + format));
        } else assert.equal(c.officePagination.next, null);
        assert.ok(!c.uncovered.some((r) => /WINDOW_PENDING/.test(r.code)));
        assert.deepEqual(
          c,
          JSON.parse(JSON.stringify(mini.readingCoverage[0])),
        );
        const label = sourceLocation(win.readingCoverage, images[2].sourceId);
        assert.match(label, /内嵌原图/);
        assert.match(label, format === "docx" ? /第 2 段/ : /单元格 B3/);
        assert.match(label, /像素\(2048,0,3,1\)/);
        assert.match(
          cloud.readJobs()[0].readingSummary[0].officeImageParts[0].mediaPart,
          /图像.png/,
        );
        assert.match(
          page.data.jobs.find((j) => j.id === cloud.readJobs()[0].id)
            .pdfProgressLabel,
          /内嵌原图/,
        );
      },
    },
  });
  assert.equal(reviews, 3);
  return {
    ...report,
    officeFormat: format,
    archiveFormat,
    originalMode: deleted ? "deleted" : "temporary",
    imageTiles: 3,
    exactAnchors: true,
    reviewedImageBatches: reviews,
  };
}
