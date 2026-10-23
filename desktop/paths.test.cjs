const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveAsset } = require("./paths.cjs");
const root = path.resolve("dist");
test("serves bundled root and assets", () => {
  assert.equal(
    resolveAsset(root, "shixu://app/"),
    path.join(root, "index.html"),
  );
  assert.equal(
    resolveAsset(root, "shixu://app/assets/a.js"),
    path.join(root, "assets/a.js"),
  );
});
test("rejects encoded traversal, foreign origins and malformed paths", () => {
  for (const url of [
    "https://app/",
    "shixu://other/",
    "shixu://app/..%2fsecret",
    "shixu://app/%5csecret",
    "shixu://app/%00",
    "shixu://app/%zz",
  ]) {
    assert.equal(resolveAsset(root, url), null, url);
  }
});
