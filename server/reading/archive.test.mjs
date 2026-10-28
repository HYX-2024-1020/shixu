import test from "node:test";
import assert from "node:assert/strict";
import { archiveSample, zipBytes } from "./archive-fixtures.mjs";
import { readMaterial, sha256, modelMaterial, coverageOnly } from "./material.mjs";
import { openPackage, PACKAGE_LIMITS } from "./ooxml-zip.mjs";
import { readingView, sourceLocation } from "../../shared/reading-view.mjs";
const read = (body, options) => readMaterial({ id: "zip", name: "合成.zip", body,
  hash: sha256(body), size: body.length }, options);
test("mixed ZIP exhausts text, order, locations and explicit omissions with no persistent body", async () => {
  const f = archiveSample();
  const m = modelMaterial(await read(f.body, { windowCodepoints: 7 }));
  assert.equal(m.state, "partial");
  assert.equal(m.segments.map(s => s.text).join(""), f.expectedText);
  assert.equal(new Set(m.covered.map(r => r.sourceId)).size, m.covered.length);
  assert.ok(m.covered.every(r => r.archivePath && r.name === f.name));
  assert.ok(m.uncovered.some(r => r.archivePath === "未读/嵌套.zip" && r.code === "ARCHIVE_NESTED_UNSUPPORTED"));
  assert.ok(m.uncovered.some(r => r.archivePath === "损坏/数据.csv" && r.code === "CSV_MALFORMED"));
  assert.ok(m.covered.find(r => r.archivePath === "尾部.txt").start >=
    m.uncovered.find(r => r.code === "CSV_MALFORMED").end);
  assert.match(readingView([m])[0].missing, /页面\/正文.pdf.*第 2 页/);
  const sheet = m.covered.find(r => r.kind === "xlsx");
  assert.match(sourceLocation([m], sheet.sourceId), /表格\/数据.xlsx.*表一.*第 1 行/);
  assert.ok(!JSON.stringify(coverageOnly(m)).includes("正文中文"));
  for (const s of m.segments) assert.equal([...s.text].length, s.range.end - s.range.start);
});
test("long archive windows retain the whole independent golden and tail", async () => {
  const f = archiveSample({ long: true });
  const m = modelMaterial(await read(f.body));
  assert.equal(sha256(m.segments.map(s => s.text).join("")), sha256(f.expectedText));
  assert.match(m.segments.at(-1).text, /尾部唯一标记$/);
  assert.ok(m.segments.length > 6);
});
test("deflated ZIP reads all supported members and retains empty/legacy omissions", async () => {
  const b = zipBytes({ "压缩/说明.txt": "中文😀保留尾部", "空.txt": "", "旧.doc": "unsupported", "未读.7z": "nested" }, { level: 6 });
  const m = await read(b);
  assert.equal(m.segments.map(s => s.text).join(""), "中文😀保留尾部");
  assert.equal(m.state, "partial");
  assert.deepEqual(m.uncovered.map(r => [r.archivePath, r.code]), [
    ["空.txt", "ARCHIVE_EMPTY_ENTRY"], ["旧.doc", "FORMAT_UNSUPPORTED"], ["未读.7z", "ARCHIVE_NESTED_UNSUPPORTED"],
  ]);
});
test("unsafe paths and special member types reject the entire archive before reading", async () => {
  for (const path of ["../逃逸.txt", "C:/逃逸.txt", "/绝对.txt", "a\\b.txt", "a//b.txt", "a/./b.txt", "a/../../b.txt", "x/".repeat(17) + "a.txt"]) {
    const m = await read(zipBytes({ "安全.txt": "safe", [path]: "unsafe" }));
    assert.equal(m.state, "failed", path);
    assert.deepEqual(m.segments, []);
    assert.ok(m.reasons.includes("PACKAGE_PATH"), path);
  }
  for (const mode of [0o120777, 0o060600, 0o020600, 0o010600]) {
    const b = zipBytes({ "a.txt": "never" });
    const central = b.indexOf(Buffer.from("504b0102", "hex"));
    b.writeUInt32LE((mode << 16) >>> 0, central + 38);
    assert.equal((await read(b)).reasons[0], "PACKAGE_PATH");
  }
});
test("CRC failure isolates one member, duplicate basenames have distinct stable sources", async () => {
  const b = zipBytes({ "a/同名.txt": "first", "b/同名.txt": "second", "尾.txt": "tail" });
  b[b.indexOf(Buffer.from("first"))] ^= 1;
  const m = await read(b);
  assert.equal(m.state, "partial");
  assert.equal(m.segments.map(s => s.text).join(""), "secondtail");
  assert.equal(m.uncovered[0].archivePath, "a/同名.txt");
  assert.equal(m.uncovered[0].code, "ARCHIVE_ENTRY_FAILED");
  const good = await read(zipBytes({ "a/同名.txt": "a", "b/同名.txt": "b" }));
  assert.notEqual(good.covered[0].sourceId, good.covered[1].sourceId);
  assert.deepEqual(good, await read(zipBytes({ "a/同名.txt": "a", "b/同名.txt": "b" })));
});
test("archive rejects ambiguous encoding, encrypted and nested disguised packages; empty ZIP is honest", async () => {
  const ambiguous = zipBytes({ "中文.txt": "x" });
  const central = ambiguous.indexOf(Buffer.from("504b0102", "hex"));
  ambiguous.writeUInt16LE(0, 6); ambiguous.writeUInt16LE(0, central + 8);
  assert.equal((await read(ambiguous)).reasons[0], "ARCHIVE_ENCODING_UNSUPPORTED");
  const encrypted = zipBytes({ "a.txt": "x" });
  const c = encrypted.indexOf(Buffer.from("504b0102", "hex"));
  encrypted.writeUInt16LE(1, 6); encrypted.writeUInt16LE(1, c + 8);
  assert.equal((await read(encrypted)).state, "unsupported");
  const nested = await read(zipBytes({ "假.txt": zipBytes({ "内.txt": "never" }), "正常.txt": "safe" }));
  assert.equal(nested.reasons[0], "ARCHIVE_NESTED_UNSUPPORTED");
  assert.equal(nested.segments[0].text, "safe");
  assert.equal((await read(zipBytes({}))).reasons[0], "EMPTY_TEXT");
  assert.equal((await read(Buffer.from("not zip"))).reasons[0], "FORMAT_MISMATCH");
});
test("expansion and entry limits hold; shared Office budget is charged before allocation", async () => {
  const bomb = zipBytes({ "大.txt": "x".repeat(200000) }, { level: 9 });
  assert.equal((await read(bomb)).reasons[0], "PACKAGE_LIMIT");
  const many = zipBytes(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i + ".txt", "x"])));
  assert.equal((await read(many)).reasons[0], "PACKAGE_LIMIT");
  const budget = { expanded: PACKAGE_LIMITS.expanded - 3 };
  assert.throws(() => openPackage(zipBytes({ "a": "four" }), { budget }), /PACKAGE_LIMIT/);
  assert.equal(budget.expanded, PACKAGE_LIMITS.expanded - 3);
  const f = archiveSample();
  const pkg = openPackage(f.body, { archive: true });
  const office = pkg.read("文档/说明.docx");
  const m = await readMaterial({ id: "a", name: "a.docx", body: office, hash: sha256(office), size: office.length }, { expansionBudget: { expanded: PACKAGE_LIMITS.expanded } });
  assert.equal(m.reasons[0], "PACKAGE_LIMIT");
  assert.deepEqual(m.segments, []);
});
