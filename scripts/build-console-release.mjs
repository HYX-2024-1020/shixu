import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==revision ||
   execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const mappings = [
  ["server/console-gateway.mjs", join(root, "server/console-gateway.mjs")],
  ["node.exe", process.execPath],
  ...[
    "dist/admin/index.html",
    "dist/fonts/NotoSansSC.ttf",
    "dist/fonts/SpaceGrotesk.ttf",
    "dist/desktop-icon.svg",
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
const response = await fetch(source, {
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw Error("NODE_LICENSE_UNAVAILABLE");
const license = Buffer.from(await response.arrayBuffer());
if (
  license.length > 2000000 ||
  !license.toString().includes("Permission is hereby granted")
)
  throw Error("NODE_LICENSE_INVALID");
const content = await Promise.all(
  mappings.map(async ([path, source]) => ({
    path,
    bytes: await readFile(source),
  })),
);
content.push({ path: "notices/Node-LICENSE.txt", bytes: license });
content.sort((a, b) => a.path.localeCompare(b.path, "en"));
const files = content.map(({ path, bytes }) => ({
  path,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
}));
const fingerprint = createHash("sha256")
    .update(files.map((f) => `${f.sha256}  ${f.path}\n`).join(""))
    .digest("hex"),
  release = "cloud-" + fingerprint.slice(0, 40),
  target = join(appRoot, "releases", release);
await mkdir(target, { recursive: true });
for (const { path, bytes } of content) {
  const file = join(target, path);
  await mkdir(dirname(file), { recursive: true });
  if (existsSync(file)) {
    if (
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") !== createHash("sha256").update(bytes).digest("hex")
    )
      throw Error("IMMUTABLE_RELEASE_MISMATCH");
  } else await writeFile(file, bytes, { flag: "wx" });
}
const manifestPath = join(target, "installation-manifest.json");
if (!existsSync(manifestPath))
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        application: "shixu-console-gateway",
        fingerprint,
        sourceRevision: revision,
        node: process.version,
        nodeLicense: source,
        files,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
console.log(
  JSON.stringify({
    release,
    fingerprint,
    sourceRevision: JSON.parse(await readFile(manifestPath, "utf8"))
      .sourceRevision,
    files: files.length,
  }),
);
