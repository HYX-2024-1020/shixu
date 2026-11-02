import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Read-only: fetch origin separately before invoking this check.
export function checkDevelopmentBase({
  cwd = process.cwd(),
  start = false,
} = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const root = realpathSync(git("rev-parse", "--show-toplevel"));
  const registry = path.join(
    path.dirname(root),
    ".codex",
    "shixu-workspaces.json",
  );
  let registered = false;
  if (existsSync(registry)) {
    const config = JSON.parse(readFileSync(registry, "utf8"));
    if (config.version !== 1 || typeof config.canonicalCheckout !== "string")
      throw new Error(
        "Invalid local workspace registry; repair it before editing.",
      );
    const expected = realpathSync(
      path.resolve(path.dirname(registry), config.canonicalCheckout),
    );
    if (root !== expected)
      throw new Error(
        "Reference checkout: use the registered development checkout.",
      );
    registered = true;
  }
  const branch = git("branch", "--show-current");
  if (
    !/^(feat|fix|docs|refactor|test|chore|ci|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      branch,
    )
  )
    throw new Error(
      "Use a dedicated task branch; main and detached HEAD are not development branches.",
    );
  let base;
  try {
    base = git("rev-parse", "--verify", "refs/remotes/origin/main");
  } catch {
    throw new Error("origin/main is missing; fetch origin before continuing.");
  }
  const head = git("rev-parse", "HEAD");
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", base, head],
    {
      cwd,
      stdio: "ignore",
    },
  );
  if (ancestor.status !== 0)
    throw new Error(
      "Task branch does not contain origin/main; reconcile the latest merged fixes before continuing.",
    );
  if (git("ls-files", "--unmerged"))
    throw new Error(
      "Unresolved merge conflicts; do not edit or build a delivery yet.",
    );
  const dirty = Boolean(
    git("status", "--porcelain=v1", "--untracked-files=all"),
  );
  if (start && dirty)
    throw new Error(
      "Checkout has pending changes; finish the existing task before starting another.",
    );
  return { branch, base, head, dirty, registered };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--start"))
      throw new Error(
        "Usage: node scripts/check-development-base.mjs [--start]",
      );
    console.log(
      JSON.stringify(
        checkDevelopmentBase({ start: process.argv.includes("--start") }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`Workspace check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
