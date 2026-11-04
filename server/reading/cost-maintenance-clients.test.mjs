import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMaterial } from "./material.mjs";
import { runCostAuditClients } from "../../scripts/reading-cost-audit-clients.mjs";
for (const disposition of ["usage", "not-billed"])
  test(
    `both clients require a fresh action after ${disposition} evidence audit and resume exact archive PDF material`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-cost-clients-"));
      try {
        await runCostAuditClients({
          directory,
          disposition,
          deleted: disposition === "not-billed",
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
            archiveWindows: true,
          }),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
