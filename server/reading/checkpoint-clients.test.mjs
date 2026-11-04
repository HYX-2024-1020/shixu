import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
import { pdfWindowSample } from "./pdf-fixtures.mjs";
for (const deleted of [false, true])
  test(
    `checkpoint audit keeps both signed clients stopped until fresh resume (${deleted ? "deleted" : "temporary"})`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "shixu-checkpoint-clients-"),
      );
      try {
        const report = await runClientLoop({
          directory,
          auditCheckpoint: true,
          sourceByMini: true,
          startByMini: true,
          original: pdfWindowSample(),
          originalQuota: deleted ? undefined : 1,
          expireBeforeStart: !deleted,
          deleteBeforeStart: deleted,
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
          }),
        });
        assert.equal(report.auditedCheckpoint, true);
        assert.equal(report.fixtureSeededSentCalls, 23);
        assert.equal(report.oldPendingReplayDeniedBoth, true);
        assert.equal(report.pdfPages, 19);
        assert.equal(report.rootCalls, report.simulatedProviderCalls + 23);
        assert.equal(report.realProviderCalls, 0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
