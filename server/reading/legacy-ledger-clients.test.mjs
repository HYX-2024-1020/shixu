import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
test(
  "Windows and Page/Node signed HTTP preserve legacy unknown and show final reconciliation without automatically starting AI",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "shixu-legacy-cost-clients-"),
    );
    try {
      const result = await runClientLoop({
        directory,
        legacyLedger: true,
        reader: () => {
          throw Error("UNEXPECTED_LEGACY_READ");
        },
      });
      assert.equal(result.spentMicros, 1400);
      assert.equal(result.unknownBefore, 5000);
      assert.equal(result.unknownAfter, 0);
      assert.equal(result.noAutomaticTask, true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
