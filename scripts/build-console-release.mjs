import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const APPLICATION = "shixu-console-gateway";

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function verifyInstallationManifest(manifest, expected) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.application !== expected.application ||
    manifest.fingerprint !== expected.fingerprint ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceRevision || "") ||
    manifest.node !== expected.node ||
    manifest.nodeLicense !== expected.nodeLicense ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== expected.files.length
  ) {
    throw Error("INVALID_INSTALLATION_MANIFEST");
  }
  for (let i = 0; i < expected.files.length; i++) {
    const actual = manifest.files[i];
    const target = expected.files[i];
    if (
      !actual ||
      typeof actual !== "object" ||
      actual.path !== target.path ||
      actual.bytes !== target.bytes ||
      actual.sha256 !== target.sha256
    ) {
      throw Error("INVALID_INSTALLATION_MANIFEST");
    }
  }
  return manifest.sourceRevision;
}

async function verifyExistingRelease(target, content, expected) {
  for (const { path, bytes } of content) {
    const file = join(target, path);
    if (!existsSync(file)) throw Error("IMMUTABLE_RELEASE_MISMATCH");
    if (sha256Hex(await readFile(file)) !== sha256Hex(bytes))
      throw Error("IMMUTABLE_RELEASE_MISMATCH");
  }
  const manifestPath = join(target, "installation-manifest.json");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw Error("INVALID_INSTALLATION_MANIFEST");
  }
  return verifyInstallationManifest(parsed, expected);
}

export async function writeConsoleRelease({
  appRoot,
  revision,
  content,
  nodeVersion = process.version,
  nodeLicense,
}) {
  if (!/^[a-f0-9]{40}$/.test(revision || ""))
    throw Error("INSTALLATION_TARGET_REQUIRED");
  const sorted = [...content].sort((a, b) => a.path.localeCompare(b.path, "en"));
  const files = sorted.map(({ path, bytes }) => ({
    path,
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
  }));
  // 排序后的文件校验行共同决定发行目录名，空格和换行也参与指纹计算。
  const fingerprint = sha256Hex(
    files.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
  );
  const release = "cloud-" + fingerprint.slice(0, 40);
  const releasesRoot = join(appRoot, "releases");
  const target = join(releasesRoot, release);
  const expectedManifest = {
    application: APPLICATION,
    fingerprint,
    node: nodeVersion,
    nodeLicense,
    files,
  };
  if (existsSync(target)) {
    const existingRevision = await verifyExistingRelease(
      target,
      sorted,
      expectedManifest,
    );
    return {
      release,
      fingerprint,
      sourceRevision: existingRevision,
      files: files.length,
    };
  }
  await mkdir(releasesRoot, { recursive: true });
  const staging = await mkdtemp(join(releasesRoot, `.${release}-staging-`));
  try {
    for (const { path, bytes } of sorted) {
      const file = join(staging, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
    }
    await writeFile(
      join(staging, "installation-manifest.json"),
      JSON.stringify(
        {
          ...expectedManifest,
          sourceRevision: revision,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    await rename(staging, target);
    return {
      release,
      fingerprint,
      sourceRevision: revision,
      files: files.length,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (existsSync(target)) {
      const existingRevision = await verifyExistingRelease(
        target,
        sorted,
        expectedManifest,
      );
      return {
        release,
        fingerprint,
        sourceRevision: existingRevision,
        files: files.length,
      };
    }
    throw error;
  }
}

async function runCli() {
  if (process.platform !== "win32" || !/^v24\./.test(process.version))
    throw Error("WINDOWS_NODE24_REQUIRED");
  const appRoot = resolve(process.argv[2] || ""),
    revision = process.argv[3],
    root = fileURLToPath(new URL("../", import.meta.url));
  if (
    appRoot !== resolve(process.env.LOCALAPPDATA, "Shixu", "AdminConsole") ||
    !/^[a-f0-9]{40}$/.test(revision || "")
  )
    throw Error("INSTALLATION_TARGET_REQUIRED");
  if (
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim() !== revision ||
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim()
  )
    throw Error("CLEAN_COMMITTED_SOURCE_REQUIRED");
  const mappings = [
    ["server/console-gateway.mjs", join(root, "server/console-gateway.mjs")],
    ["node.exe", process.execPath],
    ...[
      "dist/admin/index.html",
      "dist/fonts/NotoSansSC.ttf",
      "dist/fonts/SpaceGrotesk.ttf",
      "dist/desktop-icon.svg",
      "dist/console-icon.svg",
      "dist/console-xu-v2.ico",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ].map((p) => [p, join(root, p)]),
    ...["NotoSansSC-OFL.txt", "SpaceGrotesk-OFL.txt"].map((p) => [
      "notices/" + p,
      join(root, "public/fonts", p),
    ]),
  ];
  for (const name of await readdir(join(root, "dist/assets")))
    if (/^[\w.-]+\.(js|css|woff2?)$/.test(name))
      mappings.push(["dist/assets/" + name, join(root, "dist/assets", name)]);
  const source = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  let license;
  // A launcher-only update need not redownload an already verified, identical
  // runtime's official license. Never reuse it for a different Node binary.
  try {
    const current = JSON.parse(
      await readFile(join(appRoot, "current.json"), "utf8"),
    );
    if (!/^cloud-[a-f0-9]{40}$/.test(current.release))
      throw Error("INVALID_CACHE");
    const cachedRoot = join(appRoot, "releases", current.release);
    const manifest = JSON.parse(
      await readFile(join(cachedRoot, "installation-manifest.json"), "utf8"),
    );
    const nodeFile = manifest.files.find((f) => f.path === "node.exe");
    const notice = manifest.files.find(
      (f) => f.path === "notices/Node-LICENSE.txt",
    );
    if (
      manifest.node !== process.version ||
      manifest.nodeLicense !== source ||
      sha256Hex(await readFile(process.execPath)) !== nodeFile?.sha256
    )
      throw Error("RUNTIME_CHANGED");
    const cached = await readFile(join(cachedRoot, "notices/Node-LICENSE.txt"));
    if (sha256Hex(cached) !== notice?.sha256) throw Error("LICENSE_CHANGED");
    license = cached;
  } catch {
    /* first install or changed runtime: retrieve exact official version */
  }
  if (!license) {
    const response = await fetch(source, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error("NODE_LICENSE_UNAVAILABLE");
    license = Buffer.from(await response.arrayBuffer());
  }
  if (
    license.length > 2000000 ||
    !license.toString().includes("Permission is hereby granted")
  )
    throw Error("NODE_LICENSE_INVALID");
  const content = await Promise.all(
    mappings.map(async ([path, fileSource]) => ({
      path,
      bytes: await readFile(fileSource),
    })),
  );
  content.push({ path: "notices/Node-LICENSE.txt", bytes: license });
  const result = await writeConsoleRelease({
    appRoot,
    revision,
    content,
    nodeVersion: process.version,
    nodeLicense: source,
  });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runCli();
}
