import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import {
  scanPattern,
  scannedPdfBytes,
} from "../server/reading/pdf-visual-fixtures.mjs";
import { decodePng } from "../server/reading/image.mjs";
import { zipBytes } from "../server/reading/archive-fixtures.mjs";
import {
  rar4Bytes,
  rarBytes,
  sevenZipBytes,
} from "../server/reading/native-archive-fixtures.mjs";
import { sourceLocation, pdfProgressView } from "../shared/reading-view.mjs";

export async function runPdfVisualClients({
  directory,
  reader,
  archiveFormat,
  deleted = false,
}) {
  const scans = [scanPattern(1536, 768), scanPattern(96, 60)],
    pdf = scannedPdfBytes(scans);
  const path =
      archiveFormat === "7z"
        ? "02-scan.pdf"
        : archiveFormat === "rar4"
          ? "scan/02-scan.pdf"
          : "扫描/02-scan.pdf",
    entries = {
      "01.txt": Buffer.from("包内前言"),
      [path]: pdf,
      "03.txt": Buffer.from("尾部唯一标记"),
    };
  const body = !archiveFormat
    ? pdf
    : archiveFormat === "zip"
      ? zipBytes(entries)
      : archiveFormat === "rar4"
        ? rar4Bytes(entries)
        : archiveFormat === "rar5"
          ? rarBytes(entries)
          : await sevenZipBytes(entries);
  const checked = new Set();
  const wrapped = Object.assign(
    async (...args) => {
      const material = await reader(...args);
      for (const segment of material.segments)
        if (segment.image) {
          const r = segment.range,
            pixels = decodePng(
              Buffer.from(segment.image.data, "base64"),
            ).pixels,
            scan = scans[r.page - 1];
          assert.ok(scan);
          assert.equal(r.dpi, 108);
          const expected = Buffer.alloc(r.width * r.height * 4, 255);
          for (let y = 0; y < r.height; y++)
            for (let x = 0; x < r.width; x++) {
              const p = ((y + r.y) * scan.width + x + r.x) * 3,
                q = (y * r.width + x) * 4;
              scan.pixels.copy(expected, q, p, p + 3);
            }
          assert.deepEqual(pixels, expected);
          checked.add(r.page + ":" + r.tile);
        }
      return material;
    },
    {
      pdfWindows: true,
      pdfVisualWindows: true,
      imageWindows: true,
      archiveWindows: true,
    },
  );
  const report = await runClientLoop({
    directory,
    reader: wrapped,
    sourceByMini: true,
    startByMini: true,
    originalQuota: deleted ? undefined : 1,
    expireBeforeStart: !deleted,
    deleteBeforeStart: deleted,
    reviseAfterPublication: true,
    original: {
      name:
        "合成扫描." +
        (archiveFormat === "rar4" || archiveFormat === "rar5"
          ? "rar"
          : archiveFormat || "pdf"),
      type: archiveFormat ? "application/octet-stream" : "application/pdf",
      body,
      tailSourceSuffix: "_vp2_i1",
      verify: async ({ win, mini, cloud, page }) => {
        const coverage = win.readingCoverage[0],
          ranges = coverage.covered.filter((r) => r.kind === "image");
        assert.deepEqual(
          ranges.map((r) => [r.page, r.tile]),
          [
            [1, 1],
            [1, 2],
            [2, 1],
          ],
        );
        assert.deepEqual([...checked].sort(), ["1:1", "1:2", "2:1"]);
        assert.ok(
          !coverage.uncovered.some(
            (r) => r.code === "PDF_VISUAL_WINDOW_PENDING",
          ),
        );
        if (archiveFormat) {
          assert.equal(ranges[0].archivePath, path);
          assert.ok(coverage.covered.some((r) => r.archivePath === "03.txt"));
        } else assert.equal(coverage.pdfVisualPagination.next, null);
        const label = sourceLocation(
          win.readingCoverage,
          ranges.at(-1).sourceId,
        );
        assert.match(label, /PDF 第 2 页/);
        assert.match(label, /108dpi/);
        assert.deepEqual(
          win.readingCoverage,
          JSON.parse(JSON.stringify(mini.readingCoverage)),
        );
        const task = cloud.readJobs().find((j) => j.packetId === "packet");
        assert.match(
          pdfProgressView(task.readingSummary),
          /页面视觉 · 第 2 \/ 2 页/,
        );
        assert.equal(
          page.data.jobs.find((j) => j.id === task.id).pdfProgressLabel,
          pdfProgressView(task.readingSummary),
        );
      },
    },
  });
  return {
    ...report,
    pdfVisualPages: 2,
    pdfVisualTiles: 3,
    allPixelsAndPageCoordinates: true,
    ...(archiveFormat ? { archiveFormat } : {}),
    model: "synthetic, no OCR/recognition claim",
  };
}
