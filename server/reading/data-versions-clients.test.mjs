import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
for (const temporary of [false, true])
  test(
    "actual Windows/Page signed HTTP continue after an offline complete data-version switch (" +
      (temporary ? "temporary" : "retained") +
      ")",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-version-clients-"));
      try {
        const result = await runClientLoop({
          directory,
          reader: readMaterial,
          shadowVersion: true,
          sourceByMini: true,
          verifyLifecycle: true,
          originalQuota: temporary ? 1 : 500 * 1024 * 1024,
        });
        assert.equal(result.dataVersion, "synthetic-v1");
        assert.equal(result.resultsEqual, true);
        assert.equal(result.tailSeen, true);
        assert.equal(result.realProviderCalls, 0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
