import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
