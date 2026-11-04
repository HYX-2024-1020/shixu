import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import { solidWindowSample } from "../server/reading/solid-fixtures.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { sourceLocation } from "../shared/reading-view.mjs";
export async function runSolidClients({
  directory,
  reader,
  deleted = false,
} = {}) {
  const { body, entries } = await solidWindowSample();
  const report = await runClientLoop({
    directory,
    reader:
      reader ||
      Object.assign((f, o) => readMaterial(f, o), {
        pdfWindows: true,
        archiveWindows: true,
      }),
    sourceByMini: true,
    startByMini: true,
    reviseAfterPublication: true,
    ...(deleted
      ? { deleteBeforeStart: true }
      : { originalQuota: 1, expireBeforeStart: true }),
    original: {
      name: "合成solid.7z",
      type: "application/x-7z-compressed",
      body,
      verify({ win, mini, page, cloud }) {
        const c = win.readingCoverage[0];
        assert.deepEqual(
          c,
          JSON.parse(JSON.stringify(mini.readingCoverage[0])),
        );
        assert.equal(c.archivePagination.next, null);
        assert.equal(c.archiveCompression.solid, true);
        assert.equal(c.archiveCompression.blocks.length, 1);
        assert.equal(
          c.archiveCompression.expandedBytes,
          Object.values(entries).reduce((n, b) => n + b.length, 0),
        );
        assert.equal(c.archiveCompression.blocks[0].members, 4);
        assert.equal(
          c.archiveCompression.blocks[0].expandedBytes,
          c.archiveCompression.expandedBytes,
        );
        assert.deepEqual(c.archivePdfPages, [
          { archivePath: "02.pdf", checked: 19, total: 19 },
        ]);
        const pages = c.covered.filter((r) => r.kind === "pdf");
        assert.deepEqual(
          [...new Set(pages.map((r) => r.page))],
          Array.from({ length: 19 }, (_, i) => i + 1),
        );
        assert.ok(c.covered.some((r) => r.archivePath === "04尾部.txt"));
        assert.match(
          sourceLocation(win.readingCoverage, pages.at(-1).sourceId),
          /02.pdf.*19/,
        );
        assert.match(
          page.data.jobs.find((j) => j.id === cloud.readJobs()[0].id)
            .pdfProgressLabel,
          /19 \/ 19 页/,
        );
      },
    },
  });
  return {
    ...report,
    solidBlocks: 1,
    pdfPages: 19,
    blockBudgetEqualBoth: true,
  };
}
