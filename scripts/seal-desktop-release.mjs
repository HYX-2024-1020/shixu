import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extractFile } from "@electron/asar";
const root = fileURLToPath(new URL("../", import.meta.url));
if (
  process.platform !== "win32" ||
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw Error("CLEAN_WINDOWS_SOURCE_REQUIRED");
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
const path = join(root, "release/win-unpacked"),
  asar = join(path, "resources/app.asar");
if (
  JSON.parse(extractFile(asar, "package.json").toString()).version !== version
)
  throw Error("CLIENT_VERSION_MISMATCH");
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const value = {
  source,
  version,
  asarSha256: hash(asar),
  exeSha256: hash(join(path, "拾序.exe")),
  installerSha256: hash(join(root, "release", `Shixu-Setup-${version}.exe`)),
};
writeFileSync(
  join(root, "release/client-build-receipt.json"),
  JSON.stringify(value, null, 2) + "\n",
);
console.log(JSON.stringify(value));
