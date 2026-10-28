import { writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { docxBytes, paragraph } from "../server/reading/docx-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
const destination = resolve(process.argv[2] || "");
if (!basename(destination).startsWith("shixu-docx-package-"))
  throw Error("EXPLICIT_SYNTHETIC_FIXTURE_DIRECTORY_REQUIRED");
const fixture = (name, body, text, state = "read") => ({
  name,
  body: Buffer.from(body).toString("base64"),
  textHash: sha256(text),
  state,
});
const samples = [
  ["small.txt", "会议😀通知\n".repeat(400)],
  ["medium.txt", "中文😀段落 abc\n".repeat(14000)],
  ["long.txt", "中文😀段落 abc\n".repeat(380000) + "不可遗漏的尾部"],
  ["table.csv", "名称,说明,空列\n" + '"甲,乙","多行\n说明",\n'.repeat(10000)],
  ["dense.csv", "\n".repeat(100000)],
  ["partial.csv", 'a,b\n1,2\n"broken'],
].map(([name, text]) =>
  fixture(
    name,
    Buffer.from(text),
    name === "partial.csv" ? "a,b\n1,2\n" : text,
    name === "partial.csv" ? "partial" : "read",
  ),
);
const table =
  "<w:tbl><w:tr><w:tc>" +
  paragraph("甲😀") +
  "</w:tc><w:tc>" +
  paragraph("第二列") +
  "</w:tc></w:tr></w:tbl>";
samples.push(
  fixture(
    "small.docx",
    docxBytes(paragraph(" 段首 ") + table + paragraph("尾部")),
    " 段首 \n甲😀\n第二列\n尾部\n",
  ),
);
const texts = [
  "合成报告要求与顺序😀。\n".repeat(20000),
  ...Array.from({ length: 1500 }, (_, i) => `段落${i}，保持原文。`),
  "尾部唯一标记",
];
samples.push(
  fixture(
    "long.docx",
    docxBytes(texts.map(paragraph).join("")),
    texts.map((t) => t + "\n").join(""),
  ),
);
samples.push(
  fixture(
    "partial.docx",
    docxBytes(paragraph("安全文字") + "<w:p><w:r><w:t>损坏尾部"),
    "安全文字\n",
    "partial",
  ),
);
await writeFile(
  join(destination, "docx-benchmark-fixtures.json"),
  JSON.stringify(samples),
);
await writeFile(
  join(destination, "docx-loop-fixture.json"),
  JSON.stringify({
    name: "合成.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    body: docxBytes(paragraph(texts[0]) + table + paragraph("尾部唯一标记"), {
      "word/media/image1.png": Buffer.from("not OCRed"),
    }).toString("base64"),
  }),
);
console.log("Synthetic DOCX benchmark/loop fixtures prepared");
