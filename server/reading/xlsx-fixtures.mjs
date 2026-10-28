import { zipSync, strToU8 } from "fflate";
export const SHEET_NS =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const types = "application/vnd.openxmlformats-officedocument.spreadsheetml.";
export const escaped = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const inline = (ref, text) =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaped(text)}</t></is></c>`;
export function xlsxBytes(
  sheets = [
    { name: "合成表", xml: `<row r="1">${inline("A1", "合成文字")}</row>` },
  ],
  parts = {},
  { date1904 = false, level = 0 } = {},
) {
  const entries = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      `<Override PartName="/xl/workbook.xml" ContentType="${types}sheet.main+xml"/>` +
      sheets
        .map(
          (s, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${types}worksheet+xml"/>`,
        )
        .join("") +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="' +
      types +
      'sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="' +
      types +
      'styles+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<workbook xmlns="${SHEET_NS}" xmlns:r="${rel}"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets>` +
      sheets
        .map(
          (s, i) =>
            `<sheet name="${escaped(s.name)}" sheetId="${i + 1}" r:id="sheet${i + 1}" state="${s.visibility || "visible"}"/>`,
        )
        .join("") +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (s, i) =>
            `<Relationship Id="sheet${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst xmlns="${SHEET_NS}"><si><r><t xml:space="preserve"> 共享 </t></r><r><t>😀 &amp; 单元格</t></r></si></sst>`,
    "xl/styles.xml": `<styleSheet xmlns="${SHEET_NS}"><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
    ...Object.fromEntries(
      sheets.map((s, i) => [
        `xl/worksheets/sheet${i + 1}.xml`,
        s.fullXml ||
          `<worksheet xmlns="${SHEET_NS}"><dimension ref="A1:XFD1048576"/><sheetData>${s.xml}</sheetData>${s.after || ""}</worksheet>`,
      ]),
    ),
    ...parts,
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([name, value]) => [
          name,
          typeof value === "string" ? strToU8(value) : value,
        ]),
      ),
      { level },
    ),
  );
}
