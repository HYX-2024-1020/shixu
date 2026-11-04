import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";

test("both clients require and persist account-scoped material-use confirmation before the first AI request", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-material-notice-"));
  try {
    const result = await runClientLoop({ directory, reader: readMaterial, sourceByMini: true, originalQuota: 1, materialNoticeRequired: true });
    assert.equal(result.resultsEqual, true);
    assert.equal(result.realProviderCalls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
