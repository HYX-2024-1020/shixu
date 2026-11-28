import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { PDF_RESOURCE_CATALOG } from "../../apps/server/reading/pdf-resource-catalog.mjs";
import { LEDGER_CORE_SCHEMA } from "../../apps/server/database-schemas.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "apps/server/admin-service.mjs",
  "apps/server/admin-backend.mjs",
  "apps/server/admin-risk.mjs",
  "apps/server/cloud-operations.mjs",
  "apps/server/cloud-backup.mjs",
  "apps/server/reading/price-calendar.mjs",
  "apps/server/reading-runtime.mjs", "apps/server/account-safety.mjs", "apps/server/tenant-safety.mjs", "apps/server/reading/deepseek.mjs", "apps/server/reading/broker-service.mjs", "apps/server/reading/linux-broker.mjs", "apps/server/reading/worker.mjs",
  "packages/shared/reading-view.mjs", "packages/shared/bucket-engine.mjs", "packages/shared/deadline-date.mjs", "packages/shared/deadline-time.mjs", "packages/shared/deadlines.mjs", "packages/shared/usage.mjs",
  "apps/server/data-control.mjs", "apps/server/data-migration.mjs", "apps/server/data-versions.mjs", "apps/server/database-schema.mjs", "apps/server/database-schemas.mjs", "apps/server/sync-server.mjs", "apps/server/sync-store.mjs",
  "apps/server/sync-jobs.mjs", "apps/server/generated/ai-core.mjs",
  "apps/server/sync-files.mjs",
  "apps/server/originals.mjs",
  "apps/server/sync-accounts.mjs", "apps/server/sync-multi-user.mjs", "apps/server/sync-admin.mjs", "apps/server/sync-provider.mjs",
  "apps/server/reading/remainders.mjs", "apps/server/reading/chat.mjs", "apps/server/reading/association.mjs", "apps/server/reading/routes.mjs", "apps/server/reading/tasks.mjs", "apps/server/reading/material.mjs", "apps/server/reading/image.mjs", "apps/server/reading/jpeg.mjs", "apps/server/reading/jpeg-reader.cjs", "apps/server/reading/jpeg-reader.LICENSE",
  "apps/server/reading/diagnostics.mjs",
  "apps/server/reading/legacy-jobs.mjs", "apps/server/reading/legacy-ledger.mjs", "apps/server/reading/ledger.mjs", "apps/server/reading/scheduler.mjs", "apps/server/reading/roots.mjs",
  "apps/server/accounts-v4.mjs",
  "apps/server/reading/office.mjs", "apps/server/reading/office-window.mjs", "apps/server/reading/office-images.mjs",
  "apps/server/reading/docx.mjs", "apps/server/reading/ooxml-zip.mjs",
  "apps/server/reading/docx-reader.cjs", "apps/server/reading/docx-reader.LICENSE",
  "apps/server/reading/xlsx.mjs", "apps/server/reading/ooxml-xml.mjs",
  "apps/server/reading/xlsx-reader.cjs", "apps/server/reading/xlsx-reader.LICENSE",
  "apps/server/reading/pdf-annotations.mjs", "apps/server/reading/pdf-resource-catalog.mjs", "apps/server/reading/pdf-resources.mjs", "apps/server/reading/pdf-visual.mjs", "apps/server/reading/pdf-canvas.mjs", "apps/server/reading/pdf.mjs", "apps/server/reading/pdf-api.mjs", "apps/server/reading/pdf-core.mjs", "apps/server/reading/pdf-reader.LICENSE",
  "apps/server/reading/archive.mjs", "apps/server/reading/archive-window.mjs",
  "apps/server/reading/native-archive.mjs",
  "apps/server/reading/visual-review.mjs", "apps/server/reading/reuse.mjs", "apps/server/reading/merge.mjs", "apps/server/reading/gif.mjs", "apps/server/reading/apng.mjs", "apps/server/reading/webp.mjs",
  "apps/server/reading/provider-receipts.mjs", "apps/server/reading/platform-cost.mjs", "apps/server/reading/schema.mjs", "apps/server/reading/window-safety.mjs", "apps/server/reading/window-maintenance.mjs",
  "apps/server/reading/windows.mjs", "apps/server/reading/pdf-window.mjs",
  "apps/server/reading/root-safety.mjs",
  "apps/server/reading/maintenance.mjs", "apps/server/reading/cost-maintenance.mjs", "apps/server/reading/time-maintenance.mjs", "apps/server/reading/checkpoint-maintenance.mjs",
  "deploy/sync/shixu-sync.service", "deploy/sync/install.sh",
  "deploy/sync/backup.mjs", "deploy/sync/verify.mjs", "deploy/sync/README.md",
  "deploy/sync/backup-accounts.mjs", "deploy/sync/verify-accounts.mjs",
  "deploy/sync/shixu-accounts.service", "deploy/sync/install-accounts.sh",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");

// Explicit file allowlist keeps personal profiles, .env, SSH keys and the
// independently evolving desktop/miniprogram builds out of the server release.
export async function buildRelease(output) {
  const native = "apps/server/reading/generated-native/";
  const visual =
    "apps/server/reading/generated-pdf-visual/" +
    process.platform +
    "-" +
    process.arch +
    "/";
  const releaseFiles = [
    ...files,
    ...[
      "manifest.json",
      "canvas.cjs",
      "skia.node",
      ...(process.platform === "win32" ? ["icudtl.dat"] : []),
      "sbom.cdx.json",
      "canvas.LICENSE",
      "pdf.LICENSE",
      "third-party.LICENSE",
      "api.mjs",
      "core.mjs",
      "source/build-reading-pdf-visual.mjs",
      "source/build-pdf-resources.mjs",
      "source/patch-pdf-fonts.mjs",
      "source/patch-pdf-compat.mjs",
      "source/pdf-number.mjs",
      ...Object.keys(PDF_RESOURCE_CATALOG.files).map((n) => "resources/" + n),
      "source/cssparser-0.38.0.crate",
      "source/cssparser-macros-0.7.0.crate",
      "source/dtoa-short-0.3.5.crate",
      "source/selectors-0.41.0.crate",
      "source/provenance.json",
      "source/upstream-notices.json",
      "source/canvas-1.0.13.tgz",
      "source/canvas-" +
        (process.platform === "win32" ? "win32-x64-msvc" : "linux-x64-gnu") +
        "-1.0.13.tgz",
    ].map((f) => visual + f),
    ...[
      "manifest.json",
      "License.txt",
      "source/7z2605-src.tar.xz",
      "source/build-reading-archive.mjs",
      "reading-7zz" + (process.platform === "win32" ? ".exe" : ""),
    ].map((f) => native + f),
    ...[
      "manifest.json",
      "COPYING",
      "PATENTS",
      "AUTHORS",
      "source/libwebp-1.6.0.tar.gz",
      "source/build-reading-webp.mjs",
      "source/patch-reading-webp.mjs",
      "source/webp-reader.c",
      "reading-webp" + (process.platform === "win32" ? ".exe" : ""),
    ].map((f) => "apps/server/reading/generated-webp/" + f),
  ];
  const content = await Promise.all(
    releaseFiles.map(async (file) => [file, await readFile(join(root, file))]),
  );
  const checksums =
    content.map(([file, data]) => `${hash(data)}  ${file}`).join("\n") + "\n";
  const fingerprint = hash(checksums);
  const releaseId = `sync-${new Date().toISOString().replace(/\D/g, "")}-${fingerprint.slice(0, 12)}`;
  const destination = resolve(output || join(root, "release", releaseId));
  let revision = null;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {}
  // A fresh folder is mandatory; stale files must never enter a release.
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination);
  for (const [file, data] of content) {
    await mkdir(dirname(join(destination, file)), { recursive: true });
    await writeFile(join(destination, file), data, { flag: "wx" });
    if (file === native+"reading-7zz" || file === "apps/server/reading/generated-webp/reading-webp") await chmod(join(destination,file),0o755);
  }
  const manifest =
    JSON.stringify(
      {
        version: JSON.parse(await readFile(join(root, "package.json"), "utf8"))
          .version,
        ledgerCoreVersion: LEDGER_CORE_SCHEMA.at(-1).version,
        releaseId,
        createdAt: new Date().toISOString(),
        sourceRevision: revision,
        sourceFingerprint: fingerprint,
        source: "working-tree-snapshot",
        nodeMajor: 24,
        application: "shixu-sync",
        protocolVersion: 2,
        schemaVersion: 1,
        supportedProtocols: [2, 3, 4],
        accountEntry: "apps/server/sync-multi-user.mjs",
        readingEntry: "apps/server/reading-runtime.mjs",
        readingOptIn: true,
        stage: "private-text-sync",
        files: releaseFiles,
      },
      null,
      2,
    ) + "\n";
  await writeFile(join(destination, "release.json"), manifest, { flag: "wx" });
  await writeFile(
    join(destination, "SHA256SUMS"),
    checksums + `${hash(manifest)}  release.json\n`,
    { flag: "wx" },
  );
  return { directory: destination, releaseId, fingerprint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await buildRelease(process.argv[2]), null, 2));
