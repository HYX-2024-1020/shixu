import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPdfVisualClients } from "../../scripts/reading-pdf-visual-clients.mjs";
import { readMaterial } from "./material.mjs";
for (const archiveFormat of [undefined, "zip", "rar4", "rar5", "7z"])
  test(
    `scanned PDF ${archiveFormat || "top-level"} uses signed dual-client stop/reupload, paid reuse and full page/tile sources`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "shixu-pdf-visual-clients-"),
      );
      try {
        await runPdfVisualClients({
          directory,
          archiveFormat,
          deleted: archiveFormat === "rar4",
          reader: readMaterial,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
