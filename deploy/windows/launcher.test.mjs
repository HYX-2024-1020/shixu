import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

test(
  "installed file integrity works without PowerShell module autoload and releases the file",
  { skip: process.platform !== "win32" },
  () => {
    const source = readFileSync(
      new URL("./Launch-Console.ps1", import.meta.url),
      "utf8",
    );
    const implementation = source.match(
      /^function Get-InstalledFileSha256\([^]*?^\}/m,
    )?.[0];
    assert.ok(implementation);
    const directory = mkdtempSync(join(tmpdir(), "shixu console hash "));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    try {
      const material = join(directory, "binary with spaces.bin"),
        script = join(directory, "check.ps1");
      const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
      writeFileSync(
        script,
        "\ufeff" +
          "$ErrorActionPreference='Stop'\n$PSModuleAutoLoadingPreference='None'\n" +
          implementation +
          "\n" +
          "$result=Get-InstalledFileSha256 " +
          literal(material) +
          "\n" +
          "$stream=[IO.File]::Open(" +
          literal(material) +
          ",[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)\n" +
          "$stream.Dispose()\n[Console]::WriteLine($result)\n",
      );
      const run = () =>
        spawnSync(
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
            script,
          ],
          { encoding: "utf8", windowsHide: true, timeout: 30000 },
        );
      for (const bytes of [
        Buffer.from([0, 128, 255, 13, 10]),
        Buffer.from("changed synthetic bytes"),
      ]) {
        writeFileSync(material, bytes);
        const result = run();
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          result.stdout.trim().toLowerCase(),
          createHash("sha256").update(bytes).digest("hex"),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
