import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApngClients } from "../../scripts/reading-apng-clients.mjs";
for (const deleted of [false, true])
  test(
    "APNG dual signed clients preserve frames, stop/reupload, paid visual review and semantic publication " +
      (deleted ? "deleted ZIP" : "temporary top"),
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-apng-clients-"));
      try {
        await runApngClients({ directory, deleted, archive: deleted });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
