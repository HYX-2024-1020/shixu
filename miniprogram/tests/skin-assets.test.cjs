const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { resolve, join } = require("node:path");
const root = resolve(__dirname, "..");

test("fox atlas retains true-color alpha at 240px and lives in a bounded resource package", () => {
  const config = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
  const pkg = config.subPackages.find((p) => p.name === "fox-skin");
  assert.equal(pkg.root, "assets/fox");
  const atlas = readFileSync(join(root, pkg.root, "atlas.webp"));
  assert.equal(atlas.subarray(0, 4).toString(), "RIFF");
  assert.equal(atlas.subarray(12, 16).toString(), "VP8X");
  assert.ok(atlas[20] & 16, "alpha is present");
  assert.equal(atlas.readUIntLE(24, 3) + 1, 2400);
  assert.equal(atlas.readUIntLE(27, 3) + 1, 3828);
  const size = (folder, exclude) =>
    readdirSync(folder).reduce((n, name) => {
      const p = join(folder, name);
      if (exclude?.(p)) return n;
      return (
        n + (statSync(p).isDirectory() ? size(p, exclude) : statSync(p).size)
      );
    }, 0);
  const packageRoot = join(root, pkg.root);
  assert.ok(
    size(packageRoot) < 2 * 1024 * 1024,
    "fox resource package fits 2MiB",
  );
  assert.ok(
    size(root, (p) => p === packageRoot || p === join(root, "tests")) <
      2 * 1024 * 1024,
    "main package fits 2MiB without sacrificing face colors",
  );
  const png = readFileSync(join(root, "assets/bunny.png"));
  assert.equal(png[25], 6, "idle PNG is true RGBA, not a limited palette");
  assert.equal(png.readUInt32BE(16), 480);
});
