import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMaterial } from "./material.mjs";
import { runArchiveWindowsClients } from "../../scripts/reading-archive-windows-clients.mjs";
for (const format of ["zip", "rar", "7z"])
  test(
    `${format} PDF windows cross clients, same-hash reupload, paid reuse and per-member progress`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-archive-windows-"));
      try {
        await runArchiveWindowsClients({
          directory,
          reader: (f, o) => readMaterial(f, o),
          format,
          deleted: format === "7z",
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
