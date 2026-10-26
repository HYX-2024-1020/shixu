import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimePath = (file) =>
  /^(?:app\.(?:js|json|wxss)|sitemap\.json|(?:pages|lib|assets)\/[^:]+)$/.test(
    file,
  ) &&
  !file
    .split("/")
    .some((part) => part === ".." || part === "." || part.startsWith("."));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Deploy source only to an explicitly named, already existing IDE project.
// Never inspect private IDE config, storage, user data, or remove destination files.
export async function syncPreview({ source, target, files, check = false }) {
  const from = await realpath(source),
    to = await realpath(target);
  const relation = path.relative(from, to);
  if (
    !relation ||
    (!relation.startsWith("..") && !path.isAbsolute(relation)) ||
    from.startsWith(to + path.sep)
  )
    throw Error("Preview must be a separate existing project directory");
  const sourceConfig = JSON.parse(
    await readFile(path.join(from, "project.config.json"), "utf8"),
  );
  const targetConfig = JSON.parse(
    await readFile(path.join(to, "project.config.json"), "utf8"),
  );
  if (
    !sourceConfig.appid ||
    targetConfig.appid !== sourceConfig.appid ||
    targetConfig.compileType !== "miniprogram"
  )
    throw Error(
      "Preview appid or project type does not match; no files copied",
    );
  for (const file of files)
    if (!runtimePath(file)) throw Error(`Not a runtime source path: ${file}`);
  const changed = [];
  for (const file of files) {
    const input = path.join(from, file),
      output = path.join(to, file);
    if (!(await lstat(input)).isFile())
      throw Error(`Source must be a regular file: ${file}`);
    // Reject symlink traversal before creating or copying runtime paths.
    let current = to;
    for (const part of file.split("/")) {
      current = path.join(current, part);
      const entry = await lstat(current).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (entry?.isSymbolicLink())
        throw Error(`Destination symlink refused: ${file}`);
    }
    const sourceBytes = await readFile(input);
    const existing = await readFile(output).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!existing || digest(existing) !== digest(sourceBytes)) {
      changed.push(file);
      if (!check) {
        await mkdir(path.dirname(output), { recursive: true });
        await copyFile(input, output);
      }
    }
  }
  return { target: to, files: files.length, changed };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const target = process.argv[process.argv.indexOf("--target") + 1];
  if (!process.argv.includes("--target") || !target || target.startsWith("--"))
    throw Error("Pass --target with the exact existing IDE project directory");
  const files = execFileSync("git", ["ls-files", "-z", "--", "miniprogram"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((file) => file.slice("miniprogram/".length))
    .filter(runtimePath);
  const check = process.argv.includes("--check");
  const result = await syncPreview({
    source: path.join(root, "miniprogram"),
    target,
    files,
    check,
  });
  console.log(
    JSON.stringify(
      { ...result, action: check ? "checked" : "copied-runtime-source" },
      null,
      2,
    ),
  );
  if (check && result.changed.length) process.exitCode = 1;
}
