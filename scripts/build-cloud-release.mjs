import { buildRelease } from "./build-sync-release.mjs";
import { isSealedCloudRelease } from "../server/cloud-operations.mjs";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_CLOUD_FILES = [
  "dist/admin/index.html",
  "dist/fonts/NotoSansSC.ttf",
  "dist/fonts/SpaceGrotesk.ttf",
  "dist/desktop-icon.svg",
  "dist/console-icon.svg",
  "dist/console-xu-v2.ico",
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

const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");

export async function verifyStagedCloudRelease(directory) {
  const manifest = JSON.parse(
    await readFile(join(directory, "release.json"), "utf8"),
  );
  if (!isSealedCloudRelease(manifest)) throw Error("CLOUD_RELEASE_UNSEALED");
  const sumsText = await readFile(join(directory, "SHA256SUMS"), "utf8");
  const lines = sumsText.split(/\r?\n/).filter(Boolean);
  const byFile = new Map();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || byFile.has(match[2]))
      throw Error("CLOUD_RELEASE_CHECKSUM_MISMATCH");
    byFile.set(match[2], match[1]);
  }
  const expectedFiles = new Set([...manifest.files, "release.json"]);
  if (byFile.size !== expectedFiles.size)
    throw Error("CLOUD_RELEASE_CHECKSUM_MISMATCH");
  for (const file of expectedFiles) {
    const expectedHash = byFile.get(file);
    if (!expectedHash) throw Error("CLOUD_RELEASE_CHECKSUM_MISMATCH");
    const actualHash = sha256Hex(await readFile(join(directory, file)));
    if (actualHash !== expectedHash)
      throw Error("CLOUD_RELEASE_CHECKSUM_MISMATCH");
  }
  return { manifest, verifiedFiles: byFile.size };
}

export async function buildCloudRelease({
  output,
  revision,
  rootDir = root,
  buildBaseRelease = buildRelease,
  extraFiles,
} = {}) {
  if (!/^[a-f0-9]{40}$/.test(revision || ""))
    throw Error("SOURCE_REVISION_REQUIRED");
  const explicitTarget = output ? resolve(output) : null;
  if (explicitTarget && existsSync(explicitTarget))
    throw Error("RELEASE_TARGET_EXISTS");

  const stagingBaseParent = explicitTarget
    ? dirname(explicitTarget)
    : join(rootDir, "release");
  await mkdir(stagingBaseParent, { recursive: true });
  const stagingParent = await mkdtemp(
    join(stagingBaseParent, ".shixu-cloud-staging-"),
  );
  const payloadDir = join(stagingParent, "payload");

  try {
    const release = await buildBaseRelease(payloadDir);
    const files = extraFiles ? [...extraFiles] : [...DEFAULT_CLOUD_FILES];
    if (!extraFiles) {
      for (const name of await readdir(join(rootDir, "dist/assets")))
        if (/^[\w.-]+\.(js|css|woff2?)$/.test(name))
          files.push("dist/assets/" + name);
    }

    let sums = await readFile(join(payloadDir, "SHA256SUMS"), "utf8");
    for (const file of files) {
      const data = await readFile(join(rootDir, file));
      const dest = join(payloadDir, file);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data, { flag: "wx" });
      sums += `${sha256Hex(data)}  ${file}\n`;
    }

    const manifestPath = join(payloadDir, "release.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    Object.assign(manifest, {
      sourceRevision: revision,
      source: "committed-source-archive-plus-platform-build",
      role: "private-v4-cloud-console",
      stage: "private-v4-cloud-console",
      protocolVersion: 4,
      files: [...manifest.files, ...files],
    });
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    await writeFile(manifestPath, bytes);
    const manifestLine = /^[a-f0-9]{64}  release\.json$/m;
    if (!manifestLine.test(sums))
      throw Error("CLOUD_RELEASE_CHECKSUM_MISMATCH");
    sums = sums.replace(manifestLine, `${sha256Hex(bytes)}  release.json`);
    await writeFile(join(payloadDir, "SHA256SUMS"), sums);

    await verifyStagedCloudRelease(payloadDir);

    const destination =
      explicitTarget || resolve(join(rootDir, "release", release.releaseId));
    if (existsSync(destination)) throw Error("RELEASE_TARGET_EXISTS");
    await rename(payloadDir, destination);

    return {
      ...release,
      directory: destination,
      role: "private-v4-cloud-console",
      extraFiles: files.length,
    };
  } finally {
    await rm(stagingParent, { recursive: true, force: true }).catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    JSON.stringify(
      await buildCloudRelease({
        output: process.argv[2],
        revision: process.argv[3],
      }),
    ),
  );
}
