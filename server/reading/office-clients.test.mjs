import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOfficeClients } from "../../scripts/reading-office-clients.mjs";
import { readMaterial } from "./material.mjs";
for (const [format, archiveFormat] of [
  ["docx", undefined],
  ["xlsx", undefined],
  ["docx", "zip"],
  ["xlsx", "rar4"],
])
  test(
    `${format} ${archiveFormat || "top-level"} images use both signed clients, exact anchors and original recovery`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-office-clients-"));
      try {
        await runOfficeClients({
          directory,
          format,
          archiveFormat,
          deleted: !!archiveFormat,
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
            imageWindows: true,
            archiveWindows: true,
            officeWindows: true,
          }),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
