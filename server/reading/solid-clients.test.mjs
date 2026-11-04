import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSolidClients } from "../../scripts/reading-solid-clients.mjs";
for (const deleted of [false, true])
  test(
    "7z solid shared block crosses both signed clients, stop/reupload and exact revision reuse " +
      (deleted ? "deleted" : "temporary"),
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-solid-clients-"));
      try {
        await runSolidClients({ directory, deleted });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
