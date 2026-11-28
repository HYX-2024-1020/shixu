import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClientParity } from "./check-client-parity.mjs";

test("desktop, mobile, shared and server changes require a dual-client impact update", () => {
  for (const file of [
    "src/bucket/SkinMascot.tsx",
    "desktop/main.cjs",
    "miniprogram/pages/index/index.wxml",
    "miniprogram/lib/world.js",
    "miniprogram/assets/laugh.mp3",
    "miniprogram/app.js",
    "shared/bucket-engine.mjs",
    "server/sync-server.mjs",
  ]) {
    assert.equal(validateClientParity([file]).length, 1, file);
    assert.deepEqual(validateClientParity([file, "docs/client-parity.md"]), []);
  }
});
test("test, documentation and generated-only updates do not pretend to be product changes", () => {
  assert.deepEqual(
    validateClientParity([
      "desktop/cloud.test.cjs",
      "server/sync.test.mjs",
      "miniprogram/tests/world.test.cjs",
      "docs/README.md",
      "miniprogram/lib/generated/desktop.js",
    ]),
    [],
  );
});
