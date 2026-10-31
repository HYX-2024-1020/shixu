import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWindowSafetyClients } from "../../scripts/reading-window-safety-clients.mjs";
import { readMaterial } from "./material.mjs";
for (const deleted of [false, true])
  test(
    `both signed clients retain a cursor rollback fence and audited ${deleted ? "deleted" : "temporary"} recovery`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "shixu-window-safety-clients-"),
      );
      try {
        await runWindowSafetyClients({
          directory,
          deleted,
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
          }),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
