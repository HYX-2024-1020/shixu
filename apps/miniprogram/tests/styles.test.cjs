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
    ".attachment-actions",
    ".draft-file-copy",
    ".search-clear",
    ".filter-footer",
    ".empty-action",
  ])
    assert.ok(css.includes(selector), `missing shipped style ${selector}`);
});

test("mobile styles retire unused card rules and keep DDL content heights flexible", () => {
  const css = readFileSync(
    resolve(__dirname, "../pages/index/index.wxss"),
    "utf8",
  );
  assert.doesNotMatch(css, /(^|[\s,{])\.item-card\b/);
  assert.match(css, /\.page \.ddl-item\[class\*="urgency-"\][\s\S]*?height: auto;/);
  assert.doesNotMatch(css, /\.page \.ddl-item \{[^}]*height: calc\(/s);
  for (const selector of [".xc-hit", ".search-clear", ".filter-trigger"])
    assert.match(
      css,
      new RegExp(`${selector.replace(".", "\\.")}[^{]*\\{[^}]*44px`),
      `${selector} keeps a 44px touch target`,
    );
});
