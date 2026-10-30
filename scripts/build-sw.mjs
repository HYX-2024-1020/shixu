import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
let revision = process.env.GITHUB_SHA;
if (!revision) {
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    revision = "unavailable";
  }
}
const buildInfo =
  JSON.stringify(
    { application: "shixu", version, revision, platform: "web" },
    null,
    2,
  ) + "\n";
await writeFile("dist/version.json", buildInfo);
await writeFile(
  "dist/admin-test/version.json",
  JSON.stringify(
    {
      application: "shixu",
      edition: "admin-test",
      name: "管理员测试版",
      version,
      revision,
      platform: "web",
    },
    null,
    2,
  ) + "\n",
);
const files = await readdir("dist", { recursive: true, withFileTypes: true });
const assets = files
  .filter((file) => file.isFile())
  .map((file) =>
    `${file.parentPath.replaceAll("\\", "/")}/${file.name}`.replace(
      /^dist\//,
      "",
    ),
  )
  .filter((file) => file !== "sw.js" && !file.startsWith("."));
const hash = createHash("sha256")
  .update(
    assets.join("\n") +
      buildInfo +
      (await readFile("dist/index.html", "utf8")) +
      (await readFile("public/sw.js", "utf8")),
  )
  .digest("hex")
  .slice(0, 12);
const worker = (await readFile("public/sw.js", "utf8"))
  .replace(/const CACHE = [^;]+;/, `const CACHE = CACHE_PREFIX + "${hash}";`)
  .replace(
    /const PRECACHE = \[[\s\S]*?\];/,
    `const PRECACHE = ${JSON.stringify(["./", ...assets.map((file) => "./" + file)])};`,
  );
await writeFile("dist/sw.js", worker);
console.log(`Offline shell ready: ${assets.length} assets, version ${hash}`);
