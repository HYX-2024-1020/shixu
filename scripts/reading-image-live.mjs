import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)),
  require = createRequire(import.meta.url);
const probe = await mkdtemp(join(tmpdir(), "shixu-image-live-"));
const dry = process.argv.includes("--dry-run");
const existing =
  process.env.SHIXU_LIVE_PROFILE || join(process.env.APPDATA, "ShixuDesktop");
try {
  await copyFile(join(existing, "Local State"), join(probe, "Local State"));
  const env = { ...process.env, SHIXU_IMAGE_PROBE_DIR: probe };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!dry) {
    const output = resolve(root, "../outputs");
    await mkdir(output, { recursive: true });
    const ledgerDirectory = await mkdtemp(join(output, "shixu-image-ledger-"));
    env.SHIXU_IMAGE_LEDGER_PATH = join(ledgerDirectory, "ledger.sqlite");
    env.SHIXU_IMAGE_REPORT ||= join(ledgerDirectory, "image-live.json");
  }
  const exit = await new Promise((done, reject) => {
    const child = spawn(
      require("electron"),
      [
        join(root, "scripts/reading-image-live.cjs"),
        ...(dry ? ["--dry-run"] : []),
      ],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    child.stdout.on("data", (b) => process.stdout.write(b));
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("error", reject);
    child.on("close", (code) => done(code ?? 1));
  });
  process.exitCode = exit;
} finally {
  if (
    dirname(probe) !== resolve(tmpdir()) ||
    !basename(probe).startsWith("shixu-image-live-")
  )
    throw Error("UNSAFE_PROBE_CLEANUP");
  // Only the parent removes the profile, after Electron releases Local State.
  await rm(probe, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
