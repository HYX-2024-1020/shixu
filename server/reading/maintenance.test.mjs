import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
import { pdfWindowSample } from "./pdf-fixtures.mjs";
import { executionLimitReader } from "../../scripts/reading-limit-fixture.mjs";

test(
  "known exhausted PDF time can be audited by the trusted host and explicitly continued by the other client",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-time-audit-"));
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
          executionLimitReader(readMaterial),
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

test(
  "unknown reader time is independently audited before both clients explicitly resume PDF windows",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-unknown-time-loop-"));
    let reads = 0;
    try {
      const report = await runClientLoop({
        directory,
        auditUnknownTime: true,
        expectedReadPause: "ACTIVE_TIME_RECONCILIATION",
        original: pdfWindowSample(),
        originalQuota: 1,
        sourceByMini: true,
        expireBeforeStart: true,
        startByMini: true,
        reader: Object.assign(
          async (f, options) => {
            if (++reads === 1)
              throw Object.assign(Error("synthetic missing reader timing"), {
                timingUncertain: true,
              });
            return readMaterial(f, options);
          },
          { pdfWindows: true },
        ),
      });
      assert.equal(report.auditedUnknownTime, true);
      assert.equal(report.oldPendingReplayDeniedBoth, true);
      assert.equal(report.completeExpectedTextChecked, true);
      assert.equal(report.pdfPages, 19);
      assert.ok(report.afterActiveMs >= report.beforeActiveMs + 321);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
