import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
import { pdfWindowSample } from "./pdf-fixtures.mjs";

test(
  "known exhausted PDF time can be audited by the trusted host and explicitly continued by the other client",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-time-audit-"));
    let reads = 0;
    try {
      const report = await runClientLoop({
        directory,
        auditAfterReadLimit: true,
        expectedReadPause: "EXECUTION_LIMIT",
        original: pdfWindowSample(),
        originalQuota: 1,
        sourceByMini: true,
        expireBeforeStart: true,
        startByMini: true,
        reader: Object.assign(
          async (f, { signal, pdfWindow }) => {
            if (++reads === 1)
              return new Promise((resolve, reject) =>
                signal.addEventListener(
                  "abort",
                  () =>
                    reject(
                      Object.assign(Error("READING_ABORTED"), {
                        timing: { waitingMs: 0 },
                      }),
                    ),
                  { once: true },
                ),
              );
            return readMaterial(f, { pdfWindow });
          },
          { pdfWindows: true },
        ),
      });
      assert.equal(report.auditedKnownTime, true);
      assert.equal(report.forgedUserAuditDenied, true);
      assert.equal(report.realProviderCalls, 0);
      assert.equal(report.pdfPages, 19);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
