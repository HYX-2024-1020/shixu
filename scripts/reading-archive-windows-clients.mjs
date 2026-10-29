import assert from "node:assert/strict";
import { archiveWindowSample } from "../server/reading/archive-fixtures.mjs";
import {
  rarBytes,
  sevenZipBytes,
} from "../server/reading/native-archive-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
import { readingView, pdfProgressView } from "../shared/reading-view.mjs";
import { runClientLoop } from "./reading-client-loop.mjs";

export async function runArchiveWindowsClients({
  directory,
  reader,
  format,
  deleted = false,
}) {
  const sample = archiveWindowSample();
  const body =
    format === "zip"
      ? sample.body
      : format === "rar"
        ? rarBytes(sample.entries)
        : await sevenZipBytes(sample.entries);
  const seen = new Map(),
    windows = [];
  let verified = false;
  const result = await runClientLoop({
    directory,
    sourceByMini: true,
    startByMini: true,
    reviseAfterPublication: true,
    ...(deleted
      ? { deleteBeforeStart: true }
      : { originalQuota: 1, expireBeforeStart: true }),
    reader: Object.assign(
      async (file, options) => {
        const m = await reader(file, options);
        if (options.archiveWindow) {
          windows.push({
            request: options.archiveWindow,
            response: m.archivePagination,
          });
          for (const s of m.segments) {
            if (seen.has(s.sourceId))
              assert.equal(seen.get(s.sourceId), s.text);
            seen.set(s.sourceId, s.text);
          }
        }
        return m;
      },
      { pdfWindows: true, archiveWindows: true },
    ),
    original: {
      ...sample,
      body,
      name: "包内分页." + format,
      verify({ win, mini, page, cloud }) {
        assert.equal([...seen.values()].join(""), sample.expectedText);
        assert.deepEqual(win.readingCoverage, mini.readingCoverage);
        const c = win.readingCoverage[0];
        assert.equal(c.archivePagination.next, null);
        assert.deepEqual(c.archivePdfPages, [
          { archivePath: "02分页.pdf", checked: 19, total: 19 },
          { archivePath: "03另一份.pdf", checked: 2, total: 2 },
        ]);
        assert.ok(!c.uncovered.some((r) => /WINDOW_PENDING/.test(r.code)));
        assert.match(
          readingView([c])[0].missing,
          /02分页.pdf.*第 9 页.*未提取到文字/,
        );
        const label = page.data.jobs.find(
          (j) => j.state === "done",
        ).pdfProgressLabel;
        assert.match(label, /02分页.pdf.*已检查 19 \/ 19 页/);
        assert.match(label, /03另一份.pdf.*已检查 2 \/ 2 页/);
        assert.equal(
          label,
          pdfProgressView(
            cloud.readJobs().find((j) => j.state === "done").readingSummary,
          ),
        );
        assert.match(
          page._detail(win.itemIds[0]).evidence[0].name,
          /包内 “01前件.txt”/,
        );
        verified = true;
      },
    },
  });
  assert.equal(verified, true);
  return {
    ...result,
    format,
    originalHash: sha256(body),
    expectedTextHash: sha256(sample.expectedText),
    wholeTextOrderTailAndCoverageChecked: true,
    archivePdfProgressChecked: true,
    windows,
  };
}
