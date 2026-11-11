import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  realpathSync,
  copyFileSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const consoleRoot = join(process.env.LOCALAPPDATA, "Shixu/AdminConsole"),
  connection = join(process.env.LOCALAPPDATA, "Shixu/Connection");
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const destination = (f) => {
  if (
    !["console", "connection"].includes(f.group) ||
    f.path.includes("..") ||
    !/^[\w./-]+$/.test(f.path)
  )
    throw Error("INVALID_DESTINATION");
  const root = f.group === "console" ? consoleRoot : connection,
    target = resolve(root, f.path);
  if (!target.toLowerCase().startsWith((root + "\\").toLowerCase()))
    throw Error("OUTSIDE_INSTALLATION");
  return target;
};
try {
  const metadata = JSON.parse(
    readFileSync(process.argv[3], "utf8").replace(/^\uFEFF/, ""),
  );
  let client;
  if (metadata.client) {
    const c = metadata.client;
    if (
      c.relativeRoot !== "Programs/shixu" ||
      c.exeName !== "拾序.exe" ||
      !/^\d+\.\d+\.\d+$/.test(c.version) ||
      !/^[a-f0-9]{40}$/.test(c.source) ||
      ![c.asarSha256, c.exeSha256, c.installerSha256].every((h) =>
        /^[a-f0-9]{64}$/.test(h),
      )
    )
      throw Error("INVALID_CLIENT_DELIVERY");
    const root = join(process.env.LOCALAPPDATA, "Programs/shixu");
    if (
      existsSync(root) &&
      realpathSync.native(root).toLowerCase() !== resolve(root).toLowerCase()
    )
      throw Error("CLIENT_INSTALLATION_REDIRECTED");
    client = { ...c, physicalRoot: root };
  }
  if (process.argv[2] === "--preflight") {
    try {
      if (lstatSync(consoleRoot).isSymbolicLink()) {
        console.error("INSTALLATION_REDIRECTED: " + consoleRoot);
        process.exit(3);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const log = join(consoleRoot, "logs");
    mkdirSync(log, { recursive: true });
    const probe = join(log, ".physical-probe-" + process.pid);
    writeFileSync(probe, "owned installation probe", { flag: "wx" });
    let physical;
    try {
      physical = realpathSync.native(probe);
    } finally {
      unlinkSync(probe);
    }
    if (physical.toLowerCase() !== resolve(probe).toLowerCase()) {
      console.error("INSTALLATION_REDIRECTED: " + physical);
      process.exit(3);
    }
    mkdirSync(connection, { recursive: true });
    const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
    }).match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw Error("USER_SID_MISSING");
    execFileSync(
      join(process.env.SystemRoot, "System32/icacls.exe"),
      [
        connection,
        "/inheritance:r",
        "/grant:r",
        "*" + sid + ":(OI)(CI)F",
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
      ],
      { stdio: "pipe" },
    );
    const stamp = new Date().toISOString().replace(/\D/g, "");
    for (const f of metadata.files) {
      const target = destination(f);
      if (
        existsSync(target) &&
        realpathSync.native(target).toLowerCase() !== target.toLowerCase()
      ) {
        console.error(
          "INSTALLATION_REDIRECTED: " + realpathSync.native(target),
        );
        process.exit(3);
      }
      if (existsSync(target) && digest(target) !== f.sha256) {
        if (f.path.startsWith("releases/"))
          throw Error("IMMUTABLE_RELEASE_DIFFERS");
        const backup = join(
          f.group === "console" ? consoleRoot : connection,
          "backups",
          stamp,
          f.path,
        );
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(target, backup);
      }
    }
    console.log("Physical user installation directory verified");
  } else if (process.argv[2] === "--verify") {
    if (client) {
      for (const [name, expected] of [
        ["拾序.exe", client.exeSha256],
        ["resources/app.asar", client.asarSha256],
      ]) {
        const target = join(client.physicalRoot, name);
        if (
          realpathSync.native(target).toLowerCase() !==
            resolve(target).toLowerCase() ||
          digest(target) !== expected
        )
          throw Error("CLIENT_PHYSICAL_INSTALL_VERIFICATION_FAILED");
      }
    }
    for (const f of metadata.files) {
      const target = destination(f);
      if (
        digest(target) !== f.sha256 ||
        realpathSync.native(target).toLowerCase() !== target.toLowerCase()
      )
        throw Error("USER_FILE_NOT_PHYSICAL_OR_CHECKSUM_FAILED");
    }
    execFileSync(
      join(process.env.SystemRoot, "System32/cscript.exe"),
      ["//Nologo", join(consoleRoot, "Cloud-Start.vbs"), "/headless"],
      { stdio: "pipe", timeout: 90000, windowsHide: true },
    );
    const launch = JSON.parse(
      readFileSync(join(consoleRoot, "logs/last-launch.json"), "utf8").replace(
        /^\uFEFF/,
        "",
      ),
    );
    if (launch.phase !== "ready" || launch.fingerprint !== metadata.fingerprint)
      throw Error("USER_CONSOLE_NOT_READY");
    writeFileSync(
      join(consoleRoot, "logs/user-install-result.json"),
      JSON.stringify(
        {
          success: true,
          physicalRoot: realpathSync.native(consoleRoot),
          source: metadata.sourceRevision,
          files: metadata.files.length,
          gatewayPID: launch.gatewayPID,
          ...(client ? { client } : {}),
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log("User installation files and cloud gateway verified");
  } else throw Error("UNKNOWN_INSTALL_PHASE");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
