import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { nativeArchiveSample } from "./native-archive-fixtures.mjs";
import { readMaterial } from "./material.mjs";
import { readingView } from "../../shared/reading-view.mjs";
for (const format of ["rar", "7z"])
  test(
    `${format} reupload, stop, restart and both client publication retain source/omissions`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-native-clients-"));
      try {
        await runClientLoop({
          directory,
          reader: readMaterial,
          sourceByMini: true,
          startByMini: true,
          originalQuota: 1,
          expireBeforeStart: true,
          reviseAfterPublication: true,
          original: {
            ...(await nativeArchiveSample(format, { long: true })),
            verify({ win, mini, page }) {
              assert.deepEqual(win.readingCoverage, mini.readingCoverage);
              const c = win.readingCoverage[0];
              assert.equal(c.state, "partial");
              assert.ok(c.covered.every((r) => r.archivePath));
              assert.match(readingView([c])[0].missing, /05页面.pdf.*第 2 页/);
              assert.match(
                page._detail(win.itemIds[0]).evidence[0].name,
                /01说明.txt/,
              );
            },
          },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
