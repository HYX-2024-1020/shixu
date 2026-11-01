import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAssociationClients } from "../../scripts/reading-association-clients.mjs";
for (const deleted of [false, true])
  test(
    "both signed clients publish history links in the shared wallet without changing old items " +
      (deleted ? "deleted" : "temporary"),
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "shixu-association-clients-"),
      );
      try {
        await runAssociationClients({ directory, deleted });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
