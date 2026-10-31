import assert from "node:assert/strict";
import { archiveWindowSample, zipBytes } from "../server/reading/archive-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
import { readingView } from "../shared/reading-view.mjs";
import { runClientLoop } from "./reading-client-loop.mjs";

export async function runCostAuditClients({
  directory,
  reader,
  disposition,
  deleted = false,
}) {
  const sample = archiveWindowSample();
  // Freeze ZIP header dates as well as content for repeatable byte hashes.
  sample.body=zipBytes(sample.entries,{mtime:new Date(2026,9,29,0,0,0)});
  const started = performance.now();
  const report = await runClientLoop({
    directory,
    reader,
    sourceByMini: true,
    startByMini: true,
    costAudit: disposition,
    ...(deleted
      ? { deleteBeforeStart: true }
      : { originalQuota: 1, expireBeforeStart: true }),
    original: {
      ...sample,
      verify({ win, mini, page }) {
        assert.deepEqual(win.readingCoverage, mini.readingCoverage);
        const c = win.readingCoverage[0];
        assert.equal(c.archivePagination.next, null);
        assert.deepEqual(c.archivePdfPages, [
          { archivePath: "02分页.pdf", checked: 19, total: 19 },
          { archivePath: "03另一份.pdf", checked: 2, total: 2 },
        ]);
        assert.ok(!c.uncovered.some((r) => /WINDOW_PENDING/.test(r.code)));
        assert.match(readingView([c])[0].missing, /02分页.pdf.*第 9 页/);
        assert.match(
          page.data.jobs.find((j) => j.state === "done").pdfProgressLabel,
          /02分页.pdf.*19 \/ 19.*03另一份.pdf.*2 \/ 2/,
        );
      },
    },
  });
  return {
    ...report,
    elapsedMs: performance.now() - started,
    archivePdfWindowsChecked: true,
    originalHash: sha256(sample.body),
    expectedTextHash: sha256(sample.expectedText),
  };
}
