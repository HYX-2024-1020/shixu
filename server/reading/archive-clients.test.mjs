import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { archiveSample } from "./archive-fixtures.mjs";
import { readMaterial } from "./material.mjs";
import { readingView } from "../../shared/reading-view.mjs";
for (const deleted of [false, true]) test(
  `ZIP cross-client ${deleted ? "deleted original transient verification" : "expired temporary reupload"} preserves archive paths after stop/resume`,
  { timeout: 30000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-zip-clients-"));
    try {
      await runClientLoop({ directory, reader: readMaterial,
        sourceByMini: true, startByMini: true,
        ...(deleted ? { deleteBeforeStart: true } : { originalQuota: 1, expireBeforeStart: true }),
        original: { ...archiveSample({ long: true }), verify({ win, mini, page }) {
          assert.deepEqual(win.readingCoverage, mini.readingCoverage);
          const c = win.readingCoverage[0];
          assert.equal(c.state, "partial");
          assert.ok(c.covered.every(r => r.archivePath));
          assert.match(readingView([c])[0].missing, /未读\/嵌套.zip.*嵌套归档/);
          const detail = page._detail(win.itemIds[0]);
          assert.match(detail.evidence[0].name, /包内 “资料\/说明.txt”/);
          assert.match(detail.reading[0].missing, /页面\/正文.pdf.*第 2 页/);
        } },
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  },
);
