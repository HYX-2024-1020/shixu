import { buildRelease } from "./build-sync-release.mjs";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!/^[a-f0-9]{40}$/.test(process.argv[3] || ""))
  throw Error("SOURCE_REVISION_REQUIRED");
const release = await buildRelease(process.argv[2]);
const files = [
  "dist/admin/index.html",
  "dist/fonts/NotoSansSC.ttf",
  "dist/fonts/SpaceGrotesk.ttf",
  "dist/desktop-icon.svg",
  "deploy/sync/install-cloud.sh",
  "deploy/sync/cloud-tariff.service",
  "deploy/sync/cloud-tariff.timer",
  "scripts/reading-prepare-runtime.py",
  "scripts/refresh-cloud-tariff.mjs",
  "scripts/cloud-operations-worker.mjs",
  "scripts/cloud-admin.mjs",
  "deploy/sync/cloud-operations.service",
  "deploy/sync/cloud-operations.timer",
];
for (const name of await readdir(join(root, "dist/assets")))
  if (/^[\w.-]+\.(js|css|woff2?)$/.test(name))
    files.push("dist/assets/" + name);
let sums = await readFile(join(release.directory, "SHA256SUMS"), "utf8");
for (const file of files) {
  const data = await readFile(join(root, file));
  await mkdir(dirname(join(release.directory, file)), { recursive: true });
  await writeFile(join(release.directory, file), data, { flag: "wx" });
  sums += `${createHash("sha256").update(data).digest("hex")}  ${file}\n`;
}
const manifestPath = join(release.directory, "release.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
Object.assign(manifest, {
  sourceRevision: process.argv[3],
  source: "committed-source-archive-plus-platform-build",
  role: "private-v4-cloud-console",
  stage: "private-v4-cloud-console",
  protocolVersion: 4,
  files: [...manifest.files, ...files],
});
const bytes = JSON.stringify(manifest, null, 2) + "\n";
await writeFile(manifestPath, bytes);
sums = sums.replace(
  /^[a-f0-9]{64}  release\.json$/m,
  createHash("sha256").update(bytes).digest("hex") + "  release.json",
);
await writeFile(join(release.directory, "SHA256SUMS"), sums);
console.log(
  JSON.stringify({
    ...release,
    role: "private-v4-cloud-console",
    extraFiles: files.length,
  }),
);
