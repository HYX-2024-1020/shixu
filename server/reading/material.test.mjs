import test from "node:test";
import assert from "node:assert/strict";
import {
  readMaterial,
  materialBatches,
  coverageOnly,
  sha256,
} from "./material.mjs";
const file = (text, name = "合成.txt") => {
  const body = Buffer.isBuffer(text) ? text : Buffer.from(text);
  return { id: "a", name, body, size: body.length, hash: sha256(body) };
};
test("raw hash and size must match; MIME and client body cannot replace originals", () => {
  const f = file("真正原文");
  assert.throws(
    () => readMaterial({ ...f, hash: "0".repeat(64) }),
    /INPUT_INTEGRITY/,
  );
  assert.throws(
    () => readMaterial({ ...f, size: f.size + 1 }),
    /INPUT_INTEGRITY/,
  );
  assert.throws(
    () => readMaterial({ ...f, name: "../escape.txt" }),
    /INVALID_DESCRIPTOR/,
  );
  assert.equal(
    readMaterial({ ...f, text: "伪造预览", type: "application/pdf" })
      .segments[0].text,
    "真正原文",
  );
});
test("LF normalization retains whitespace and Unicode; windows cover every codepoint once", () => {
  const input = "\ufeff第一行\r\n A😀é \r最后\n";
  const expected = "第一行\n A😀é \n最后\n";
  const r = readMaterial(file(input), { windowCodepoints: 4 });
  assert.equal(r.state, "read");
  assert.equal(r.segments.map((s) => s.text).join(""), expected);
  let end = 0;
  for (const s of r.segments) {
    assert.equal(s.range.start, end);
    assert.equal(s.range.end - s.range.start, [...s.text].length);
    assert.ok(!/[\ud800-\udbff]$/.test(s.text));
    end = s.range.end;
  }
  assert.equal(end, [...expected].length);
  assert.ok(!JSON.stringify(coverageOnly(r)).includes("第一行"));
});
test("CSV preserves logical rows, empty columns, escaped quotes and multiline cell structure", () => {
  const r = readMaterial(
    file(
      '名称,内容,空列\r\n"报告,甲","第一行\r\n第二行""引号",\r\n末行,,尾',
      "表.csv",
    ),
  );
  assert.equal(r.state, "read");
  assert.deepEqual(
    r.segments.map((s) => s.structure.cells),
    [
      ["名称", "内容", "空列"],
      ["报告,甲", '第一行\n第二行"引号', ""],
      ["末行", "", "尾"],
    ],
  );
  assert.deepEqual(
    r.covered.map((s) => [s.row, s.firstLine, s.lastLine, s.columns]),
    [
      [1, 1, 1, 3],
      [2, 2, 3, 3],
      [3, 4, 4, 3],
    ],
  );
});
test("malformed CSV tail yields exact uncovered range and keeps safe complete rows", () => {
  const text = 'a,b\n1,2\n"unfinished';
  const r = readMaterial(file(text, "表.csv"));
  assert.equal(r.state, "partial");
  assert.equal(r.segments.map((s) => s.text).join(""), "a,b\n1,2\n");
  assert.deepEqual(r.uncovered, [
    { kind: "csv", start: 8, end: text.length, row: 3, code: "CSV_MALFORMED" },
  ]);
  for (const text of ['"bad', 'a"b,c', '"a"x,b']) {
    const result = readMaterial(file(text, "bad.csv"));
    assert.equal(result.state, "failed");
    assert.equal(result.segments.length, 0);
  }
});
test("long text and a giant CSV row continue across windows without hidden total limits", () => {
  for (const name of ["long.txt", "long.csv"]) {
    const text = "😀中文".repeat(90000) + "\n尾部不能遗漏";
    const result = readMaterial(file(text, name));
    const batches = [...materialBatches([result])];
    assert.ok(batches.length >= 3);
    assert.equal(
      batches
        .flat()
        .map((s) => s.text)
        .join(""),
      text,
    );
    assert.equal(result.state, "read");
    assert.equal(result.uncovered.length, 0);
    for (const batch of batches)
      assert.ok(batch.reduce((n, s) => n + [...s.text].length, 0) <= 120000);
  }
});
test("unsupported, corrupt, binary, empty and partial states are distinct and never invent material", () => {
  for (const [value, name, state, reason] of [
    [Buffer.from([255, 254]), "bad.txt", "unsupported", "ENCODING_UNSUPPORTED"],
    ["%PDF-binary", "fake.txt", "failed", "FORMAT_MISMATCH"],
    ["hello\0world", "bad.csv", "failed", "BINARY_TEXT"],
    ["body", "legacy.doc", "unsupported", "FORMAT_UNSUPPORTED"],
  ]) {
    const result = readMaterial(file(value, name));
    assert.equal(result.state, state);
    assert.equal(result.segments.length, 0);
    assert.equal(result.uncovered[0].code, reason);
  }
  const empty = readMaterial(file(" \n"));
  assert.equal(empty.state, "read");
  assert.deepEqual(empty.reasons, ["EMPTY_TEXT"]);
});
test("dense CSV coalesces metadata without losing raw records or row/column relations", () => {
  const rows = Array.from({ length: 2048 }, (_, i) =>
    i % 2 ? `"第${i}行\n续行",,尾\n` : `${i},a\n`,
  );
  const result = readMaterial(file(rows.join(""), "dense.csv"));
  assert.equal(result.segments.map((s) => s.text).join(""), rows.join(""));
  assert.equal(result.segments.length, 16);
  let row = 1;
  for (const s of result.segments) {
    assert.equal(s.range.row, row);
    assert.equal(s.range.rowEnd, row + 127);
    assert.equal(s.structure.encoding, "csv");
    for (const run of s.structure.columnRuns) {
      assert.equal(run.row, row);
      assert.equal(run.rowEnd, row);
      assert.equal(run.columns, row % 2 ? 2 : 3);
      row++;
    }
  }
  assert.equal(row, 2049);
});
