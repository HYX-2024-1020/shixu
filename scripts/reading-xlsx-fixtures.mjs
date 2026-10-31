import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  xlsxBytes,
  inline,
  SHEET_NS,
} from "../server/reading/xlsx-fixtures.mjs";
import { sha256 } from "../server/reading/material.mjs";
import { utils, write } from "xlsx/xlsx.mjs";
const destination = resolve(process.argv[2] || "");
if (!basename(destination).startsWith("shixu-docx-package-"))
  throw Error("EXPLICIT_SYNTHETIC_FIXTURE_DIRECTORY_REQUIRED");
execFileSync(process.execPath, [
  fileURLToPath(new URL("./reading-docx-fixtures.mjs", import.meta.url)),
  destination,
]);
const fixtures = JSON.parse(
  await readFile(join(destination, "docx-benchmark-fixtures.json"), "utf8"),
);
const realBook=utils.book_new();
const tableRows=Array.from({length:2000},(_,i)=>[`第${i+1}行中文😀`,i+1,0.125]);
const realSheet=utils.aoa_to_sheet(tableRows);
for(let i=1;i<=2000;i++)realSheet["C"+i].z="0.00%";
utils.book_append_sheet(realBook,realSheet,"实际生成表");
const realBookBytes=write(realBook,{type:"buffer",bookType:"xlsx",compression:true,bookSST:true});
const fixture = (name, body, text, state = "read") => ({
  name,
  body: body.toString("base64"),
  textHash: sha256(text),
  state,
});
fixtures.push(fixture("table.xlsx",realBookBytes,tableRows.map((row,i)=>`A${i+1}\t${row[0]}\nB${i+1}\t${row[1]}\nC${i+1}\t12.50%\n`).join("")));
fixtures.push(
  fixture(
    "small.xlsx",
    xlsxBytes([
      {
        name: "首表",
        xml: `<row r="2"><c r="B2" t="s"><v>0</v></c><c r="D2" s="1"><v>1.5</v></c></row>`,
        after: '<mergeCells><mergeCell ref="B2:C3"/></mergeCells>',
      },
      {
        name: "次表",
        visibility: "hidden",
        xml: `<row r="4">${inline("C4", "第二表😀尾部")}</row>`,
      },
    ]),
    "B2\t 共享 😀 & 单元格\nD2\t1900-01-01 12:00 [日期 1900-01-01]\nC4\t第二表😀尾部\n",
  ),
);
const head = "长单元格中文😀。\n".repeat(20000);
const rows = Array.from({ length: 2000 }, (_, i) => ({
  index: i + 2,
  text: `第${i + 2}行中文😀`,
}));
const long = xlsxBytes([
  {
    name: "长资料表",
    xml:
      `<row r="1">${inline("A1", head)}</row>` +
      rows
        .map(
          (r) =>
            `<row r="${r.index}">${inline("B" + r.index, r.text)}<c r="D${r.index}"><v>${r.index}</v></c></row>`,
        )
        .join("") +
      `<row r="3000">${inline("C3000", "尾部唯一标记")}</row>`,
  },
]);
fixtures.push(
  fixture(
    "long.xlsx",
    long,
    "A1\t" +
      head +
      "\n" +
      rows
        .map((r) => `B${r.index}\t${r.text}\nD${r.index}\t${r.index}\n`)
        .join("") +
      "C3000\t尾部唯一标记\n",
  ),
);
fixtures.push(
  fixture(
    "partial.xlsx",
    xlsxBytes([
      {
        name: "损坏表",
        fullXml: `<worksheet xmlns="${SHEET_NS}"><sheetData><row r="1">${inline("A1", "完整行")}</row><row r="7"><c r="C7"><f>1+1</f><v>999</v></c></row><row r="8">${inline("A8", "损坏行")}<c r="B8">`,
      },
    ]),
    "A1\t完整行\nC7\t999 [公式缓存，未重算；1+1]\n",
    "partial",
  ),
);
await writeFile(
  join(destination, "xlsx-benchmark-fixtures.json"),
  JSON.stringify(fixtures),
);
await writeFile(
  join(destination, "xlsx-loop-fixture.json"),
  JSON.stringify({
    name: "合成.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: xlsxBytes([
      {
        name: "资料表",
        xml: `<row r="1">${inline("A1", head)}</row><row r="7"><c r="C7"><f>1+1</f><v>999</v></c>${inline("D7", "尾部唯一标记")}</row>`,
      },
    ]).toString("base64"),
  }),
);
console.log("Synthetic XLSX and existing-format golden fixtures prepared");
