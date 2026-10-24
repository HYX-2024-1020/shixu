import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "server/sync-server.mjs", "server/sync-store.mjs",
  "server/sync-jobs.mjs", "server/generated/ai-core.mjs",
  "server/sync-files.mjs",
  "deploy/sync/shixu-sync.service", "deploy/sync/install.sh",
  "deploy/sync/backup.mjs", "deploy/sync/verify.mjs", "deploy/sync/README.md",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");

// Explicit file allowlist keeps personal profiles, .env, SSH keys and the
// independently evolving desktop/miniprogram builds out of the server release.
export async function buildRelease(output) {
  const content = await Promise.all(files.map(async (file) => [file, await readFile(join(root, file))]));
  const checksums = content.map(([file, data]) => `${hash(data)}  ${file}`).join("\n") + "\n";
  const fingerprint = hash(checksums);
  const releaseId = `sync-${new Date().toISOString().replace(/\D/g, "")}-${fingerprint.slice(0, 12)}`;
  const destination = resolve(output || join(root, "release", releaseId));
  let revision = null;
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}
  // A fresh folder is mandatory; stale files must never enter a release.
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  for (const [file, data] of content) {
    await mkdir(dirname(join(destination, file)), { recursive: true });
    await writeFile(join(destination, file), data, { flag: "wx" });
  }
  const manifest = JSON.stringify({
    releaseId, createdAt: new Date().toISOString(), sourceRevision: revision,
    sourceFingerprint: fingerprint, source: "working-tree-snapshot", nodeMajor: 24,
    application: "shixu-sync", protocolVersion: 2, schemaVersion: 1,
    stage: "private-text-sync", files,
  }, null, 2) + "\n";
  await writeFile(join(destination, "release.json"), manifest, { flag: "wx" });
  await writeFile(join(destination, "SHA256SUMS"), checksums + `${hash(manifest)}  release.json\n`, { flag: "wx" });
  return { directory: destination, releaseId, fingerprint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await buildRelease(process.argv[2]), null, 2));
