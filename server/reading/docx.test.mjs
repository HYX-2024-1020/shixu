import test from "node:test";
import assert from "node:assert/strict";
import {
  readMaterial,
  modelMaterial,
  modelBatches,
  coverageOnly,
  sha256,
} from "./material.mjs";
import { docxBytes, paragraph, WORD_NS } from "./docx-fixtures.mjs";
import { readingView, sourceLocation } from "../../shared/reading-view.mjs";
const input = (body) => ({
  id: "docx-original",
  name: "合成.docx",
  body,
  size: body.length,
  hash: sha256(body),
});
const read = (body, options) => readMaterial(input(body), options);

test("DOCX retains paragraph/run whitespace, Unicode, tabs/breaks, table cell coordinates and related-story identity in reading order", () => {
  const body = docxBytes(
    paragraph(" 开头😀é ") +
      "<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>" +
      '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
      paragraph("合并格") +
      "</w:tc><w:tc>" +
      paragraph("第三列") +
      "</w:tc></w:tr><w:tr><w:tc>" +
      paragraph("下一行") +
      "</w:tc></w:tr></w:tbl>" +
      paragraph("尾部"),
    {
      "word/header1.xml": `<w:hdr xmlns:w="${WORD_NS}">${paragraph("页眉")}</w:hdr>`,
      "word/footnotes.xml": `<w:footnotes xmlns:w="${WORD_NS}"><w:footnote w:id="4">${paragraph("注释")}</w:footnote></w:footnotes>`,
    },
  );
  const result = read(body);
  assert.equal(result.state, "read");
  assert.deepEqual(
    result.segments.map((s) => s.text),
    [
      " 开头😀é \n",
      "A\tB\nC\n",
      "合并格\n",
      "第三列\n",
      "下一行\n",
      "尾部\n",
      "注释\n",
      "页眉\n",
    ],
  );
  assert.deepEqual(
    result.covered
      .slice(2, 5)
      .map((r) => [r.table, r.row, r.column, r.columnSpan]),
    [
      [1, 1, 1, 2],
      [1, 1, 3, 1],
      [1, 2, 1, 1],
    ],
  );
  assert.equal(result.covered[6].note, "4");
  assert.ok(!JSON.stringify(coverageOnly(result)).includes("合并格"));
  assert.match(
    sourceLocation([result], result.segments[2].sourceId),
    /表.*1.*行.*1/,
  );
});

test("DOCX long paragraphs and many paragraph boundaries remain lossless across model windows", () => {
  const texts = [
    "😀中文 é ".repeat(25000),
    ...Array.from({ length: 200 }, (_, i) => `第${i}段：下一步整理资料。`),
    "不能漏掉的末尾",
  ];
  const result = read(docxBytes(texts.map(paragraph).join("")));
  assert.equal(result.state, "read");
  const batches = [...modelBatches([modelMaterial(result)])];
  assert.ok(batches.length > 2);
  assert.equal(
    batches
      .flat()
      .map((s) => s.text)
      .join(""),
    texts.map((s) => s + "\n").join(""),
  );
  assert.ok(result.covered.filter((r) => r.paragraph === 1).length > 1);
  assert.ok(
    batches.every(
      (batch) => batch.reduce((n, s) => n + s.text.length, 0) <= 120000,
    ),
  );
});

test("DOCX preserves safe complete paragraphs and lists malformed tail, images, links and dynamic/revision omissions without fetching or executing", () => {
  const result = read(
    docxBytes(paragraph("安全段") + "<w:p><w:r><w:t>未闭合", {
      "word/media/image1.png": Buffer.from("not-decoded"),
      "word/_rels/document.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" TargetMode="External" Target="https://127.0.0.1/private" Type="external"/></Relationships>',
    }),
  );
  assert.equal(result.state, "partial");
  assert.deepEqual(
    result.segments.map((s) => s.text),
    ["安全段\n"],
  );
  assert.ok(result.reasons.includes("DOCX_XML_MALFORMED"));
  assert.ok(result.reasons.includes("DOCX_OBJECT_UNREAD"));
  assert.ok(result.reasons.includes("DOCX_EXTERNAL_LINK"));
  assert.match(readingView([result])[0].missing, /未/);
  const revision = read(
    docxBytes(
      '<w:p><w:del><w:r><w:delText>旧文</w:delText></w:r></w:del><w:ins><w:r><w:t>新文</w:t></w:r></w:ins><w:fldSimple w:instr="DDE evil"><w:r><w:t>缓存值</w:t></w:r></w:fldSimple></w:p>',
    ),
  );
  assert.equal(revision.state, "partial");
  assert.equal(revision.segments[0].text, "新文缓存值\n");
  assert.ok(revision.reasons.includes("DOCX_REVISIONS"));
  assert.ok(revision.reasons.includes("DOCX_DYNAMIC_FIELD"));
});

test("DOCX rejects traversal, links, encryption, bombs, lying lengths/CRC, macros, DTD and wrong document root", () => {
  const unsafe = [
    [docxBytes(paragraph("x"), { "../escape": "bad" }), "PACKAGE_PATH"],
    [
      docxBytes(paragraph("x"), { "word/vbaProject.bin": "macro" }),
      "DOCX_MACRO_UNSUPPORTED",
    ],
    [
      docxBytes(paragraph("x"), {
        "word/header1.xml":
          '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>',
      }),
      "DOCX_XML_UNSAFE",
    ],
    [
      docxBytes(paragraph("x"), { "word/document.xml": "<wrong/>" }),
      "DOCX_STRUCTURE_INVALID",
    ],
    [
      docxBytes(paragraph("a".repeat(1000000)), {}, { level: 9 }),
      "PACKAGE_LIMIT",
    ],
  ];
  const normal = docxBytes(paragraph("safe"));
  const central = normal.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  for (const [offset, value, code] of [
    [8, 1, "PACKAGE_UNSUPPORTED"],
    [38, 0xa0000000, "PACKAGE_PATH"],
    [24, 0xfffffffe, "PACKAGE_LIMIT"],
    [16, 0, "PACKAGE_INVALID"],
  ]) {
    const b = Buffer.from(normal);
    if (offset === 8) b.writeUInt16LE(value, central + offset);
    else b.writeUInt32LE(value, central + offset);
    unsafe.push([b, code]);
  }
  for (const [body, reason] of unsafe) {
    const r = read(body);
    assert.ok(r.reasons.includes(reason), JSON.stringify(r.reasons));
    assert.notEqual(r.state, "read");
  }
  const corrupt = Buffer.from(normal);
  corrupt[40] ^= 1;
  assert.notEqual(read(corrupt).state, "read");
  const deflated = docxBytes(paragraph("safe"), {}, { level: 6 });
  const cd = deflated.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  deflated.writeUInt32LE(1, cd + 24);
  deflated.writeUInt32LE(1, 22);
  assert.ok(
    read(deflated).reasons.includes("PACKAGE_INVALID"),
    "actual expansion cannot exceed the claimed bounded output",
  );
  const orphan = read(
    docxBytes(paragraph("正文"), {
      "word/header2.xml": `<w:hdr xmlns:w="${WORD_NS}">${paragraph("不能混入正文")}</w:hdr>`,
      "word/_rels/document.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    }),
  );
  assert.equal(orphan.segments.map((s) => s.text).join(""), "正文\n");
  assert.ok(orphan.reasons.includes("DOCX_UNLINKED_PART"));
});
