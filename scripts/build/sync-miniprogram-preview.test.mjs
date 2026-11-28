import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncPreview } from "./sync-miniprogram-preview.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "shixu-preview-source-test-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "repo"),
    target = path.join(root, "open-project");
  for (const dir of [source, target]) {
    await mkdir(path.join(dir, "pages/index"), { recursive: true });
    await writeFile(
      path.join(dir, "project.config.json"),
      JSON.stringify({ appid: "synthetic-app", compileType: "miniprogram" }),
    );
  }
  await writeFile(
    path.join(source, "pages/index/index.wxml"),
    '<view class="world-grid">new</view>',
  );
  await writeFile(
    path.join(target, "pages/index/index.wxml"),
    "<view>stale</view>",
  );
  return { source, target, files: ["pages/index/index.wxml"] };
}
test("preview check detects the stale project, then copies and verifies runtime source without replacing IDE configuration or data", async (t) => {
  const f = await fixture(t);
  const config = JSON.stringify({
    appid: "synthetic-app",
    compileType: "miniprogram",
    projectname: "already-open",
  });
  await writeFile(path.join(f.target, "project.config.json"), config);
  await writeFile(
    path.join(f.target, "project.private.config.json"),
    "synthetic-private-settings",
  );
  await writeFile(
    path.join(f.target, "keep-user-data.txt"),
    "synthetic-user-data",
  );
  assert.deepEqual((await syncPreview({ ...f, check: true })).changed, f.files);
  assert.match(
    await readFile(path.join(f.target, f.files[0]), "utf8"),
    /stale/,
  );
  assert.deepEqual((await syncPreview(f)).changed, f.files);
  assert.deepEqual((await syncPreview({ ...f, check: true })).changed, []);
  assert.equal(
    await readFile(path.join(f.target, "project.config.json"), "utf8"),
    config,
  );
  assert.equal(
    await readFile(path.join(f.target, "project.private.config.json"), "utf8"),
    "synthetic-private-settings",
  );
  assert.equal(
    await readFile(path.join(f.target, "keep-user-data.txt"), "utf8"),
    "synthetic-user-data",
  );
});
test("mismatched projects are rejected before copying any source", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.target, "project.config.json"),
    JSON.stringify({ appid: "different", compileType: "miniprogram" }),
  );
  await assert.rejects(syncPreview(f), /does not match/);
  assert.match(
    await readFile(path.join(f.target, f.files[0]), "utf8"),
    /stale/,
  );
});
test("preview synchronization refuses traversal and non-runtime files", async (t) => {
  const f = await fixture(t);
  for (const file of [
    "../escape",
    "project.config.json",
    "project.private.config.json",
    "lib/../../escape",
  ]) {
    await assert.rejects(
      syncPreview({ ...f, files: [file] }),
      /runtime source/,
    );
  }
});
