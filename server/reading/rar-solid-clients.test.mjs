import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {runRarSolidClients} from "../../scripts/reading-rar-solid-clients.mjs";
for (const version of [4, 5]) test(`RAR${version} shared dictionary crosses signed Windows and mini clients, stop/reupload, revision reuse`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-rar-solid-clients-"));
  try {
    await runRarSolidClients({directory,version});
  } finally { await rm(directory, { recursive: true, force: true }); }
});
