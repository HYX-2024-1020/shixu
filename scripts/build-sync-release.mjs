import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = [
  "server/sync-server.mjs", "server/sync-store.mjs",
  "server/sync-jobs.mjs", "server/generated/ai-core.mjs",
  "server/sync-files.mjs",
  "server/originals.mjs",
  "server/sync-accounts.mjs", "server/sync-multi-user.mjs", "server/sync-admin.mjs", "server/sync-provider.mjs",
  "server/reading/routes.mjs", "server/reading/tasks.mjs", "server/reading/material.mjs", "server/reading/image.mjs",
  "server/reading/ledger.mjs", "server/reading/scheduler.mjs", "server/reading/roots.mjs",
  "server/accounts-v4.mjs",
  "server/reading/docx.mjs", "server/reading/ooxml-zip.mjs",
  "server/reading/docx-reader.cjs", "server/reading/docx-reader.LICENSE",
  "server/reading/xlsx.mjs", "server/reading/ooxml-xml.mjs",
  "server/reading/xlsx-reader.cjs", "server/reading/xlsx-reader.LICENSE",
  "server/reading/pdf.mjs", "server/reading/pdf-api.mjs", "server/reading/pdf-core.mjs", "server/reading/pdf-reader.LICENSE",
  "server/reading/archive.mjs", "server/reading/archive-window.mjs",
  "server/reading/native-archive.mjs",
  "server/reading/reuse.mjs",
  "server/reading/windows.mjs", "server/reading/pdf-window.mjs",
  "server/reading/root-safety.mjs",
  "server/reading/maintenance.mjs", "server/reading/cost-maintenance.mjs", "server/reading/time-maintenance.mjs",
  "deploy/sync/shixu-sync.service", "deploy/sync/install.sh",
  "deploy/sync/backup.mjs", "deploy/sync/verify.mjs", "deploy/sync/README.md",
  "deploy/sync/backup-accounts.mjs", "deploy/sync/verify-accounts.mjs",
  "deploy/sync/shixu-accounts.service", "deploy/sync/install-accounts.sh",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");

// Explicit file allowlist keeps personal profiles, .env, SSH keys and the
// independently evolving desktop/miniprogram builds out of the server release.
export async function buildRelease(output) {
  const native="server/reading/generated-native/";
  const releaseFiles=[...files,...["manifest.json","License.txt","source/7z2605-src.tar.xz","source/build-reading-archive.mjs",
    "reading-7zz"+(process.platform === "win32"?".exe":"")].map(f=>native+f)];
  const content = await Promise.all(releaseFiles.map(async (file) => [file, await readFile(join(root, file))]));
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
    if (file === native+"reading-7zz") await chmod(join(destination,file),0o755);
  }
  const manifest = JSON.stringify({
    releaseId, createdAt: new Date().toISOString(), sourceRevision: revision,
    sourceFingerprint: fingerprint, source: "working-tree-snapshot", nodeMajor: 24,
    application: "shixu-sync", protocolVersion: 2, schemaVersion: 1,
    supportedProtocols: [2, 3], accountEntry: "server/sync-multi-user.mjs",
    stage: "private-text-sync", files:releaseFiles,
  }, null, 2) + "\n";
  await writeFile(join(destination, "release.json"), manifest, { flag: "wx" });
  await writeFile(join(destination, "SHA256SUMS"), checksums + `${hash(manifest)}  release.json\n`, { flag: "wx" });
  return { directory: destination, releaseId, fingerprint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await buildRelease(process.argv[2]), null, 2));
