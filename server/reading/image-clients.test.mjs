import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImageClients } from "../../scripts/reading-image-clients.mjs";
import { readMaterial } from "./material.mjs";
for (const deleted of [false, true])
  test(
    `PNG regions cross both client adapters after ${deleted ? "deleted" : "temporary"} revalidation without reviving originals`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-image-clients-"));
      try {
        await runImageClients({
          directory,
          deleted,
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
            imageWindows: true,
          }),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
