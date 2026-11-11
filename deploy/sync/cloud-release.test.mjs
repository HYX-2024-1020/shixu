import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSealedCloudRelease } from "../../server/cloud-operations.mjs";
test("an incomplete cloud build is never selectable as a compatible release", () => {
  const files = [
    "server/reading-runtime.mjs",
    "server/cloud-backup.mjs",
    "server/cloud-operations.mjs",
    "scripts/cloud-operations-worker.mjs",
    "dist/admin/index.html",
    "deploy/sync/install-cloud.sh",
  ];
  const m = {
    role: "private-v4-cloud-console",
    protocolVersion: 4,
    nodeMajor: 24,
    source: "committed-source-archive-plus-platform-build",
    sourceRevision: "a".repeat(40),
    ledgerCoreVersion: 8,
    files,
  };
  assert.equal(isSealedCloudRelease(m), true);
  assert.equal(isSealedCloudRelease({ ...m, sourceRevision: null }), false);
  assert.equal(isSealedCloudRelease({ ...m, role: undefined }), false);
  assert.equal(
    isSealedCloudRelease({ ...m, files: files.slice(0, -1) }),
    false,
  );
  assert.equal(isSealedCloudRelease({ ...m, ledgerCoreVersion: 7 }), false);
});
test("invalid source identity fails before creating any partial deployment directory", () => {
  const root = mkdtempSync(join(tmpdir(), "shixu-cloud-package-")),
    target = join(root, "release");
  try {
    const script = fileURLToPath(
      new URL("../../scripts/build-cloud-release.mjs", import.meta.url),
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
