import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
test(
  "signed Windows workspace and real mini Page stop/continue the same v4 task and synchronize original-backed output",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-v4-client-loop-"));
    try {
      await runClientLoop({
        directory,
        reader: async (file) => readMaterial(file),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
