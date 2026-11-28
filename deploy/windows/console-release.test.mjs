import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConsoleRelease } from "../../scripts/build/build-console-release.mjs";

const sampleContent = () => [
  { path: "server/console-gateway.mjs", bytes: Buffer.from("export default 1;\n") },
  { path: "dist/admin/index.html", bytes: Buffer.from("<html>admin</html>\n") },
  {
    path: "notices/Node-LICENSE.txt",
    bytes: Buffer.from("Permission is hereby granted\n"),
  },
];

const NODE_VERSION = "v24.20.0";
const NODE_LICENSE =
  "https://raw.githubusercontent.com/nodejs/node/v24.20.0/LICENSE";

test("console release preserves initial sourceRevision on identical content reuse", async () => {
  const appRoot = await mkdtemp(join(tmpdir(), "shixu-console-release-"));
  try {
    const rev1 = "1".repeat(40);
    const rev2 = "2".repeat(40);
    const first = await writeConsoleRelease({
      appRoot,
      revision: rev1,
      content: sampleContent(),
      nodeVersion: NODE_VERSION,
      nodeLicense: NODE_LICENSE,
    });
    assert.equal(first.sourceRevision, rev1);
    assert.equal(first.files, 3);
    assert.deepEqual(await readdir(join(appRoot, "releases")), [first.release]);

    const reused = await writeConsoleRelease({
      appRoot,
      revision: rev2,
      content: sampleContent().reverse(),
      nodeVersion: NODE_VERSION,
      nodeLicense: NODE_LICENSE,
    });
    assert.equal(reused.release, first.release);
    assert.equal(reused.fingerprint, first.fingerprint);
    assert.equal(reused.sourceRevision, rev1);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("console release rejects corrupted, incomplete or tampered installation manifests", async () => {
  const appRoot = await mkdtemp(join(tmpdir(), "shixu-console-corrupt-"));
  try {
    const rev1 = "a".repeat(40);
    const first = await writeConsoleRelease({
      appRoot,
      revision: rev1,
      content: sampleContent(),
      nodeVersion: NODE_VERSION,
      nodeLicense: NODE_LICENSE,
    });
    const manifestPath = join(
      appRoot,
      "releases",
      first.release,
      "installation-manifest.json",
    );
    const valid = JSON.parse(await readFile(manifestPath, "utf8"));

    const invalidCases = [
      "{not-json",
      JSON.stringify({ ...valid, application: "wrong-app" }),
      JSON.stringify({ ...valid, fingerprint: "0".repeat(64) }),
      JSON.stringify({ ...valid, sourceRevision: "not-a-commit" }),
      JSON.stringify({ ...valid, node: "v22.0.0" }),
      JSON.stringify({ ...valid, files: valid.files.slice(1) }),
      JSON.stringify({
        ...valid,
        files: valid.files.map((file, i) =>
          i === 0 ? { ...file, sha256: "f".repeat(64) } : file,
        ),
      }),
    ];

    for (const broken of invalidCases) {
      await writeFile(manifestPath, broken, "utf8");
      await assert.rejects(
        () =>
          writeConsoleRelease({
            appRoot,
            revision: "b".repeat(40),
            content: sampleContent(),
            nodeVersion: NODE_VERSION,
            nodeLicense: NODE_LICENSE,
          }),
        /INVALID_INSTALLATION_MANIFEST/,
      );
      // Corrupted manifest stays untouched for postmortem inspection.
      assert.equal(await readFile(manifestPath, "utf8"), broken);
    }

    // Restore valid manifest, then tamper with a managed file.
    await writeFile(manifestPath, JSON.stringify(valid, null, 2) + "\n", "utf8");
    await writeFile(
      join(appRoot, "releases", first.release, "dist/admin/index.html"),
      "tampered",
      "utf8",
    );
    await assert.rejects(
      () =>
        writeConsoleRelease({
          appRoot,
          revision: "b".repeat(40),
          content: sampleContent(),
          nodeVersion: NODE_VERSION,
          nodeLicense: NODE_LICENSE,
        }),
      /IMMUTABLE_RELEASE_MISMATCH/,
    );
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
