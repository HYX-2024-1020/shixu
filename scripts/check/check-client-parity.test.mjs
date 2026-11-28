import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClientParity } from "./check-client-parity.mjs";

test("desktop, mobile, shared and server changes require a dual-client impact update", () => {
  for (const file of [
    "apps/web/src/bucket/SkinMascot.tsx",
    "apps/desktop/main.cjs",
    "apps/miniprogram/pages/index/index.wxml",
    "apps/miniprogram/lib/world.js",
    "apps/miniprogram/assets/laugh.mp3",
    "apps/miniprogram/app.js",
    "packages/shared/bucket-engine.mjs",
    "apps/server/sync-server.mjs",
  ]) {
    assert.equal(validateClientParity([file]).length, 1, file);
    assert.deepEqual(validateClientParity([file, "docs/client-parity.md"]), []);
  }
});
test("test, documentation and generated-only updates do not pretend to be product changes", () => {
  assert.deepEqual(
    validateClientParity([
      "apps/desktop/cloud.test.cjs",
      "apps/server/sync.test.mjs",
      "apps/miniprogram/tests/world.test.cjs",
      "docs/README.md",
      "apps/miniprogram/lib/generated/desktop.js",
    ]),
    [],
  );
});
