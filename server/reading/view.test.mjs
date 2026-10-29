import test from "node:test";
import assert from "node:assert/strict";
import { readingView, sourceLocation, pdfProgressView } from "../../shared/reading-view.mjs";
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

test("archive PDF progress tolerates malformed legacy members and keeps each valid member separate",()=>{
  assert.doesNotThrow(()=>pdfProgressView([{name:{toString:{}},archivePdfPages:[{archivePath:"a",checked:1,total:1}]}]));
  assert.equal(pdfProgressView([null,{archivePdfPages:[null,{}, {archivePath:3}, {archivePath:"x",checked:-1,total:2}]}]),"");
  assert.match(pdfProgressView([{name:"包.zip",archivePdfPages:[{archivePath:"a.pdf",checked:8,total:19},{archivePath:"b.pdf",checked:2,total:2}]}]),
    /a.pdf.*8 \/ 19.*b.pdf.*2 \/ 2/);
});
