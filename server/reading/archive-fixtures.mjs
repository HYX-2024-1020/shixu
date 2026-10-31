// Project-authored synthetic materials. fflate is only a fixture writer.
import { zipSync } from "fflate";
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import { xlsxBytes, inline } from "./xlsx-fixtures.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
export function zipBytes(entries, options = {}) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(
    ([name, body]) => [name, typeof body === "string" ? Buffer.from(body) : body],
  )), { level: 0, ...options }));
}
export function archiveSample({ long = false } = {}) {
  const first = long ? "归档课程材料😀。\n".repeat(22000) : "第一项😀\r\n保留空白  ";
  const entries = {
    "资料/": new Uint8Array(),
    "资料/说明.txt": first,
    "资料/数据.csv": '名称,值\r\n"多\n行",😀\r\n',
    "文档/说明.docx": docxBytes(paragraph("正文中文😀")),
    "表格/数据.xlsx": xlsxBytes([{ name: "表一", xml: `<row r="1">${inline("A1", "单元格😀")}</row>` }]),
    "页面/正文.pdf": pdfBytes([{ text: "页内文字😀" }, { text: "" }]),
    "未读/扫描.png": Buffer.from("synthetic image, no vision input"),
    "未读/嵌套.zip": zipBytes({ "内层.txt": "不得递归" }),
    "损坏/数据.csv": "安全行,1\n\"损坏尾部",
    "尾部.txt": "尾部唯一标记",
  };
  return {
    name: "合成.zip", type: "application/zip", body: zipBytes(entries),
    // Calculated from fixture specifications, independently of the reader.
    expectedText: first.replace(/\r\n?/g, "\n") + '名称,值\n"多\n行",😀\n' +
      "正文中文😀\nA1\t单元格😀\n页内文字😀\n安全行,1\n尾部唯一标记",
  };
}

export function archiveWindowSample() {
  const pages = Array.from({length:19},(_,i)=>({text:i===8?"":`包内第${i+1}页中文😀\n`}));
  const entries={"01前件.txt":Buffer.from("前件中文😀\r\n"),
    "02分页.pdf":pdfBytes(pages,{compress:true}),
    "03另一份.pdf":pdfBytes([{text:"另一份第一页😀"},{text:"另一份尾页"}],{compress:true}),
    "04未读.png":Buffer.from("synthetic image"),"05尾部.txt":Buffer.from("尾部唯一标记")};
  return {name:"包内分页.zip",type:"application/zip",body:zipBytes(entries),entries,
    expectedText:"前件中文😀\n"+pages.map(p=>p.text).join("")+"另一份第一页😀\n另一份尾页\n尾部唯一标记"};
}
