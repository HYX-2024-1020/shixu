import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
test(
  "offline installer validates bytes and rejects tampering or credential overwrite before installation",
  { skip: process.platform !== "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "shixu offline bundle "));
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    try {
      const installer = readFileSync(
        new URL("./Install-ConsoleBundle.ps1", import.meta.url),
      );
      writeFileSync(join(root, "Install.ps1"), installer);
      mkdirSync(join(root, "payload/connection"), { recursive: true });
      const bytes = Buffer.from("synthetic connection file");
      writeFileSync(join(root, "payload/connection/ssh_config"), bytes);
      const hash = (b) => createHash("sha256").update(b).digest("hex");
      const delivery = {
        sourceRevision: "1".repeat(40),
        release: "cloud-" + "2".repeat(40),
        fingerprint: "3".repeat(64),
        installerSha256: hash(installer),
        files: [
          { group: "connection", path: "ssh_config", sha256: hash(bytes) },
        ],
      };
      const run = () => {
        writeFileSync(join(root, "delivery.json"), JSON.stringify(delivery));
        const result = spawnSync(
          join(
            process.env.SystemRoot,
            "System32/WindowsPowerShell/v1.0/powershell.exe",
          ),
          [
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "RemoteSigned",
            "-File",
            join(root, "Install.ps1"),
            "-VerifyOnly",
          ],
          { encoding: "utf8", windowsHide: true, timeout: 30000 },
        );
        assert.equal(result.error, undefined, result.error?.message);
        assert.notEqual(result.status, null, result.stderr);
        return result;
      };
      assert.equal(run().status, 0);
      writeFileSync(join(root, "payload/connection/ssh_config"), "tampered");
      assert.notEqual(run().status, 0);
      delivery.files[0] = {
        group: "console",
        path: "credentials.dpapi",
        sha256: hash(bytes),
      };
      assert.notEqual(run().status, 0);
      delivery.files[0] = {
        group: "connection",
        path: "../escape",
        sha256: hash(bytes),
      };
      assert.notEqual(run().status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
