import test from "node:test";
import assert from "node:assert/strict";
import { readingView, sourceLocation } from "../../shared/reading-view.mjs";
test("malformed local/legacy coverage cannot crash the shared view or use prototype names as statuses", () => {
  const coverage = [
    null,
    {
      name: {},
      state: "constructor",
      covered: [null],
      uncovered: [null, { code: "constructor" }],
      reasons: ["__proto__"],
    },
  ];
  const rows = readingView(coverage);
  assert.equal(
    readingView([
      {
        state: { toString: {} },
        reasons: [{ toString: {} }],
        uncovered: [{ code: { toString: {} } }],
      },
    ])[0].label,
    "读取状态待核对",
  );
  assert.equal(rows[0].label, "读取状态待核对");
  assert.equal(rows[0].name, "未命名附件");
  assert.match(rows[0].missing, /未处理/);
  assert.equal(sourceLocation([null, { covered: "bad" }], "x"), "");
  assert.equal(
    readingView([{ name: "<script>alert(1)</script>", state: "read" }])[0].name,
    "<script>alert(1)</script>",
    "view returns inert text; native renderers escape it",
  );
});
