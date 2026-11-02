import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDevelopmentBase } from "./check-development-base.mjs";

function fixture(t) {
  const temporaryRoot = realpathSync(os.tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, "shixu-workspace-"));
  t.after(() => {
    assert.equal(path.dirname(directory), temporaryRoot);
    assert.ok(path.basename(directory).startsWith("shixu-workspace-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const cwd = path.join(directory, "development");
  mkdirSync(cwd);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Workspace Fixture");
  git("config", "user.email", "workspace@example.invalid");
  const commit = (text) => {
    writeFileSync(path.join(cwd, "kept.txt"), text);
    git("add", "--", "kept.txt");
    git("commit", "-m", "test: preserve a merged fix");
  };
  commit("original\n");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-c", "fix/current-task");
  return { cwd, directory, git, commit };
}

test("accepts a fresh task without modifying the checkout", (t) => {
  const f = fixture(t);
  const before = f.git("status", "--porcelain=v1");
  const result = checkDevelopmentBase({ cwd: f.cwd, start: true });
  assert.equal(result.head, result.base);
  assert.equal(result.dirty, false);
  assert.equal(f.git("status", "--porcelain=v1"), before);
});

test("rejects a task missing a newly merged main fix", (t) => {
  const f = fixture(t);
  f.git("switch", "main");
  f.commit("new merged fix\n");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("switch", "fix/current-task");
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd }),
    /does not contain origin\/main/,
  );
});

test("rejects main and detached builds", (t) => {
  const f = fixture(t);
  f.git("switch", "main");
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd }),
    /dedicated task branch/,
  );
  f.git("switch", "--detach");
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd }),
    /dedicated task branch/,
  );
});

test("uses the registered checkout and rejects an old reference checkout", (t) => {
  const f = fixture(t);
  const registryDirectory = path.join(f.directory, ".codex");
  mkdirSync(registryDirectory);
  const registry = path.join(registryDirectory, "shixu-workspaces.json");
  writeFileSync(
    registry,
    JSON.stringify({ version: 1, canonicalCheckout: "../development" }),
  );
  assert.equal(checkDevelopmentBase({ cwd: f.cwd }).registered, true);
  mkdirSync(path.join(f.directory, "other"));
  writeFileSync(
    registry,
    JSON.stringify({ version: 1, canonicalCheckout: "../other" }),
  );
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd }),
    /Reference checkout/,
  );
});

test("preserves pending work but refuses to start another task over it", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, "draft.txt"), "another task\n");
  assert.equal(checkDevelopmentBase({ cwd: f.cwd }).dirty, true);
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd, start: true }),
    /pending changes/,
  );
  assert.equal(f.git("status", "--porcelain=v1"), "?? draft.txt");
});

test("rejects unresolved real Git conflicts", (t) => {
  const f = fixture(t);
  f.git("switch", "-c", "fix/other-task", "main");
  f.commit("other\n");
  f.git("switch", "fix/current-task");
  f.commit("current\n");
  assert.notEqual(
    spawnSync("git", ["merge", "fix/other-task"], {
      cwd: f.cwd,
      stdio: "ignore",
    }).status,
    0,
  );
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd }),
    /Unresolved merge conflicts/,
  );
});

test("rejects a missing remote baseline", (t) => {
  const f = fixture(t);
  f.git("update-ref", "-d", "refs/remotes/origin/main");
  assert.throws(
    () => checkDevelopmentBase({ cwd: f.cwd }),
    /origin\/main is missing/,
  );
});
