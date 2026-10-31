import { docxBytes, paragraph, WORD_NS } from "./docx-fixtures.mjs";
import { xlsxBytes, inline, SHEET_NS } from "./xlsx-fixtures.mjs";
import { encodePng } from "./image.mjs";
export const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const DRAW = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
export const XDR =
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const types = (format, extension) =>
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="' +
  extension +
  '" ContentType="' +
  {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  }[extension] +
  '"/>' +
  (format === "docx"
    ? '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    : '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>') +
  "</Types>";
const relationships = (body) =>
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  body +
  "</Relationships>";
export function officeImageBytes(
  format,
  {
    width = 2051,
    visibility,
    body,
    imageTarget,
    external = false,
    duplicate = false,
    drawingSuffix = "",
    imageExtension = "png",
    partOverrides = {},
  } = {},
) {
  const pixels = Buffer.alloc(width * 4, 255);
  for (let x = 0; x < width; x++) pixels[x * 4] = x % 256;
  const png = body || encodePng(width, 1, pixels),
    base = format === "docx" ? "word" : "xl";
  const picture = `<a:blip xmlns:a="${DRAW}" xmlns:r="${REL}" r:embed="image1"/>`;
  const mediaRel = `<Relationship Id="image1" Type="${REL}/image" Target="${imageTarget || "../media/图像." + imageExtension}"${external ? ' TargetMode="External"' : ""}/>`;
  const parts = {
    "[Content_Types].xml": types(format, imageExtension),
    [base + "/media/图像." + imageExtension]: png,
    ...partOverrides,
  };
  if (format === "docx") {
    parts["word/_rels/document.xml.rels"] = relationships(
      mediaRel.replace("../media/", "media/") +
        (duplicate ? mediaRel.replace("../media/", "media/") : ""),
    );
    const image = `<w:p><w:r><w:drawing><pic:pic xmlns:pic="${PIC}"><pic:blipFill>${picture}</pic:blipFill></pic:pic>${drawingSuffix}</w:drawing></w:r></w:p>`;
    return {
      body: docxBytes(
        paragraph("Office图像之前😀") + image + paragraph("Office尾部唯一标记"),
        parts,
      ),
      pixels,
      width,
    };
  }
  parts["xl/worksheets/sheet1.xml"] =
    `<worksheet xmlns="${SHEET_NS}" xmlns:r="${REL}"><sheetData><row r="1">${inline("A1", "Office图像之前😀")}</row><row r="8">${inline("B8", "Office尾部唯一标记")}</row></sheetData><drawing r:id="drawing1"/></worksheet>`;
  parts["xl/worksheets/_rels/sheet1.xml.rels"] = relationships(
    `<Relationship Id="drawing1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/>`,
  );
  parts["xl/drawings/_rels/drawing1.xml.rels"] = relationships(
    mediaRel + (duplicate ? mediaRel : ""),
  );
  parts["xl/drawings/drawing1.xml"] =
    `<xdr:wsDr xmlns:xdr="${XDR}"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:row>6</xdr:row></xdr:to><xdr:pic>${picture}</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>${drawingSuffix}</xdr:wsDr>`;
  return {
    body: xlsxBytes([{ name: "图像工作表", xml: "", visibility }], parts),
    pixels,
    width,
  };
}
