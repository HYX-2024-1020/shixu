import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  isSealedCloudRelease,
  MIN_LEDGER_CORE_VERSION,
} from "../../server/cloud-operations.mjs";
import {
  buildCloudRelease,
  verifyStagedCloudRelease,
} from "../../scripts/build/build-cloud-release.mjs";

const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");

async function syntheticBaseRelease(directory) {
  const baseFiles = [
    ["server/reading-runtime.mjs", "export const runtime = 1;\n"],
    ["server/cloud-backup.mjs", "export const backup = 1;\n"],
    ["server/cloud-operations.mjs", "export const ops = 1;\n"],
  ];
  await mkdir(directory, { recursive: true });
  let sums = "";
  for (const [file, content] of baseFiles) {
    const dest = join(directory, file);
    await mkdir(dirname(dest), { recursive: true });
    const data = Buffer.from(content);
    await writeFile(dest, data, { flag: "wx" });
    sums += `${sha256Hex(data)}  ${file}\n`;
  }
  const manifest =
    JSON.stringify(
      {
        version: "0.3.33",
        ledgerCoreVersion: MIN_LEDGER_CORE_VERSION,
        releaseId: "sync-synthetic-test",
        nodeMajor: 24,
        protocolVersion: 2,
        files: baseFiles.map(([file]) => file),
      },
      null,
      2,
    ) + "\n";
  await writeFile(join(directory, "release.json"), manifest, { flag: "wx" });
  sums += `${sha256Hex(Buffer.from(manifest))}  release.json\n`;
  await writeFile(join(directory, "SHA256SUMS"), sums, { flag: "wx" });
  return {
    directory,
    releaseId: "sync-synthetic-test",
    fingerprint: "c".repeat(64),
  };
}

async function seedCloudWorkspace(rootDir, files) {
  for (const [file, content] of files) {
    const dest = join(rootDir, file);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }
}

test("an incomplete cloud build is never selectable as a compatible release", () => {
  const files = [
    "server/reading-runtime.mjs",
    "server/cloud-backup.mjs",
    "server/cloud-operations.mjs",
    "scripts/ops/cloud-operations-worker.mjs",
    "dist/admin/index.html",
    "deploy/sync/install-cloud.sh",
  ];
  const m = {
    role: "private-v4-cloud-console",
    protocolVersion: 4,
    nodeMajor: 24,
    source: "committed-source-archive-plus-platform-build",
    sourceRevision: "a".repeat(40),
    ledgerCoreVersion: MIN_LEDGER_CORE_VERSION,
    files,
  };
  assert.equal(isSealedCloudRelease(m), true);
  assert.equal(isSealedCloudRelease({ ...m, sourceRevision: null }), false);
  assert.equal(isSealedCloudRelease({ ...m, role: undefined }), false);
  assert.equal(
    isSealedCloudRelease({ ...m, files: files.slice(0, -1) }),
    false,
  );
  assert.equal(
    isSealedCloudRelease({ ...m, ledgerCoreVersion: MIN_LEDGER_CORE_VERSION - 1 }),
    false,
  );
});

test("invalid source identity fails before creating any partial deployment directory", () => {
  const root = mkdtempSync(join(tmpdir(), "shixu-cloud-package-")),
    target = join(root, "release");
  try {
    const script = fileURLToPath(
      new URL("../../scripts/build/build-cloud-release.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [script, target, "bad-source"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SOURCE_REVISION_REQUIRED/);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cloud release stages atomically, verifies checksums, and leaves no partial directory on failure", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "shixu-cloud-atomic-"));
  const workspace = join(sandbox, "src");
  const outRoot = join(sandbox, "out");
  const target = join(outRoot, "cloud-rel");
  const extraFiles = [
    "scripts/ops/cloud-operations-worker.mjs",
    "dist/admin/index.html",
    "deploy/sync/install-cloud.sh",
  ];
  try {
    await seedCloudWorkspace(workspace, [
      ["scripts/ops/cloud-operations-worker.mjs", "export const worker = 1;\n"],
      ["dist/admin/index.html", "<html>console</html>\n"],
      ["deploy/sync/install-cloud.sh", "#!/bin/sh\n"],
    ]);

    // 1. Mid-build failure (missing extra file) must leave neither target nor staging dir.
    await assert.rejects(
      () =>
        buildCloudRelease({
          output: target,
          revision: "a".repeat(40),
          rootDir: workspace,
          buildBaseRelease: syntheticBaseRelease,
          extraFiles: [...extraFiles, "missing/file.txt"],
        }),
      /ENOENT/,
    );
    assert.equal(existsSync(target), false);
    assert.deepEqual(await readdir(outRoot), []);

    // 2. Successful build publishes atomically with verified sealed manifest and checksums.
    const built = await buildCloudRelease({
      output: target,
      revision: "a".repeat(40),
      rootDir: workspace,
      buildBaseRelease: syntheticBaseRelease,
      extraFiles,
    });
    assert.equal(built.directory, target);
    assert.equal(built.role, "private-v4-cloud-console");
    assert.equal(built.extraFiles, extraFiles.length);
    assert.deepEqual(await readdir(outRoot), ["cloud-rel"]);
    const verified = await verifyStagedCloudRelease(target);
    assert.equal(verified.manifest.sourceRevision, "a".repeat(40));
    assert.equal(verified.verifiedFiles, 7);

    // 3. Refuses to overwrite an existing release directory and leaves it intact.
    const beforeManifest = await readFile(join(target, "release.json"), "utf8");
    await assert.rejects(
      () =>
        buildCloudRelease({
          output: target,
          revision: "b".repeat(40),
          rootDir: workspace,
          buildBaseRelease: syntheticBaseRelease,
          extraFiles,
        }),
      /RELEASE_TARGET_EXISTS/,
    );
    assert.equal(
      await readFile(join(target, "release.json"), "utf8"),
      beforeManifest,
    );
    assert.deepEqual(await readdir(outRoot), ["cloud-rel"]);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
