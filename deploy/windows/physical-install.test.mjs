import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test(
  "native installer refuses a redirected destination before managed files change",
  { skip: process.platform !== "win32" },
  () => {
    const directory = realpathSync.native(
      mkdtempSync(join(tmpdir(), "shixu physical install ")),
    );
    assert.ok(
      resolve(directory)
        .toLowerCase()
        .startsWith((realpathSync.native(tmpdir()) + sep).toLowerCase()),
    );
    try {
      const metadata = join(directory, "delivery.json");
      writeFileSync(metadata, JSON.stringify({ files: [] }));
      const script = fileURLToPath(
        new URL("./verify-user-install.mjs", import.meta.url),
      );
      const run = (local) =>
        spawnSync(process.execPath, [script, "--preflight", metadata], {
          env: { ...process.env, LOCALAPPDATA: local },
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
        });
      const direct = join(directory, "direct");
      mkdirSync(direct);
      assert.equal(run(direct).status, 0);
      const redirected = join(directory, "redirected"),
        backing = join(directory, "backing");
      mkdirSync(join(redirected, "Shixu"), { recursive: true });
      mkdirSync(backing);
      const sentinel = join(backing, "unchanged.txt");
      writeFileSync(sentinel, "original synthetic file");
      symlinkSync(backing, join(redirected, "Shixu/AdminConsole"), "junction");
      const result = run(redirected);
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, /INSTALLATION_REDIRECTED/);
      assert.equal(readFileSync(sentinel, "utf8"), "original synthetic file");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
