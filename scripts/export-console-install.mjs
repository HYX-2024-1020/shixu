import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "win32") throw Error("WINDOWS_REQUIRED");
const output = resolve(process.argv[2] || "");
if (!output.startsWith(join(root, ".private") + "\\") || existsSync(output))
  throw Error("NEW_PRIVATE_OUTPUT_REQUIRED");
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw Error("CLEAN_COMMITTED_SOURCE_REQUIRED");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const app = join(process.env.LOCALAPPDATA, "Shixu/AdminConsole"),
  connection = join(process.env.LOCALAPPDATA, "Shixu/Connection");
const current = JSON.parse(readFileSync(join(app, "current.json")));
if (!/^cloud-[a-f0-9]{40}$/.test(current.release))
  throw Error("INVALID_RELEASE");
const releaseRoot = join(app, "releases", current.release);
const manifest = JSON.parse(
  readFileSync(join(releaseRoot, "installation-manifest.json")),
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
mkdirSync(output, { recursive: true });
const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], {
  encoding: "utf8",
}).match(/S-1-5-[\d-]+/)?.[0];
if (!sid) throw Error("USER_SID_REQUIRED");
execFileSync(
  "icacls.exe",
  [
    output,
    "/inheritance:r",
    "/grant:r",
    "*" + sid + ":(OI)(CI)F",
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F",
  ],
  { stdio: "ignore" },
);
const files = [];
function add(group, name, bytes) {
  if (
    !["console", "connection"].includes(group) ||
    name.includes("..") ||
    !/^[\w./-]+$/.test(name)
  )
    throw Error("INVALID_FILE");
  const path = join(output, "payload", group, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx" });
  files.push({ group, path: name, sha256: digest(bytes) });
}
for (const entry of manifest.files) {
  const source = resolve(releaseRoot, entry.path);
  if (relative(releaseRoot, source).startsWith(".."))
    throw Error("INVALID_ASSET_PATH");
  const bytes = readFileSync(source);
  if (digest(bytes) !== entry.sha256) throw Error("ASSET_INTEGRITY_FAILED");
  add("console", "releases/" + current.release + "/" + entry.path, bytes);
}
add(
  "console",
  "releases/" + current.release + "/installation-manifest.json",
  readFileSync(join(releaseRoot, "installation-manifest.json")),
);
for (const name of ["Launch-Cloud.ps1", "Launch.ps1"])
  add(
    "console",
    name,
    readFileSync(join(root, "deploy/windows/Launch-Console.ps1")),
  );
for (const name of ["Cloud-Start.vbs", "Launch.vbs"])
  add(
    "console",
    name,
    readFileSync(join(root, "deploy/windows/Launch-Console.vbs")),
  );
add(
  "console",
  "console-xu-v1.ico",
  readFileSync(join(app, "console-xu-v1.ico")),
);
for (const name of [
  "connection.json",
  "known_hosts",
  "id_ed25519",
  "ssh_config",
])
  add("connection", name, readFileSync(join(connection, name)));
const runtime = {};
for (const name of ["cloud-running.json", "gateway-running.json"])
  if (existsSync(join(app, name)))
    runtime[name] = JSON.parse(
      readFileSync(join(app, name), "utf8").replace(/^\uFEFF/, ""),
    );
const next = {
  ...current,
  sourceCommit: revision,
  launcher: "Launch-Cloud.ps1",
  launcherSha256: digest(
    readFileSync(join(root, "deploy/windows/Launch-Console.ps1")),
  ),
};
add(
  "console",
  "current.json",
  Buffer.from(JSON.stringify(next, null, 2) + "\n"),
);
copyFileSync(
  join(root, "deploy/windows/Install-ConsoleBundle.ps1"),
  join(output, "Install-ConsoleBundle.ps1"),
);
const command =
  '@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Install-ConsoleBundle.ps1"\r\npause\r\n';
writeFileSync(join(output, "Install.cmd"), command);
writeFileSync(
  join(output, "delivery.json"),
  JSON.stringify(
    {
      sourceRevision: revision,
      release: current.release,
      fingerprint: current.fingerprint,
      files,
      runtime,
      installerSha256: digest(
        readFileSync(join(output, "Install-ConsoleBundle.ps1")),
      ),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    directory: output,
    files: files.length,
    sourceRevision: revision,
    containsDedicatedConnectionKey: true,
    private: true,
  }),
);
