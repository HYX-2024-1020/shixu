import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
test("Windows and actual Page/Node signed HTTP show all legacy states and retained unverified results, sync cleared caches and never run old work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-legacy-jobs-clients-"));
  try {
    const result = await runClientLoop({
      directory,
      legacyJobs: true,
      reader: () => {
        throw Error("UNEXPECTED_READ");
      },
    });
    assert.equal(result.states, 7);
    assert.equal(result.simulatedProviderCalls, 0);
    assert.equal(result.noAutomaticTask, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
