const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

test("deployed page bundles all native styles without WXSS importer lookups", () => {
  const css = readFileSync(
    resolve(__dirname, "../pages/index/index.wxss"),
    "utf8",
  );
  assert.doesNotMatch(
    css,
    /@import\b/,
    "DevTools must not resolve separate page style module IDs",
  );
  for (const selector of [
    ".xc-card",
    ".skin-body.skin-motion-wiggle",
    ".ice-voices",
    ".page",
    ".world-grid",
  ])
    assert.ok(css.includes(selector), `missing shipped style ${selector}`);
});
