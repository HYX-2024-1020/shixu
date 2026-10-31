import { zipSync, strToU8 } from "fflate";
export const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const paragraph = (text) =>
  `<w:p><w:r><w:t xml:space="preserve">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</w:t></w:r></w:p>`;
export function docxBytes(content, parts = {}, { level = 0 } = {}) {
  const related = Object.keys(parts).filter((n) =>
    /^word\/(?:header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(n),
  );
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries({
          "[Content_Types].xml":
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          "_rels/.rels":
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
          ...(related.length
            ? {
                "word/_rels/document.xml.rels":
                  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                  related
                    .map(
                      (name, i) =>
                        `<Relationship Id="story${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${name.includes("header") ? "header" : name.includes("footer") ? "footer" : name.split("/").at(-1).replace(".xml", "")}" Target="${name.slice(5)}"/>`,
                    )
                    .join("") +
                  "</Relationships>",
              }
            : {}),
          "word/document.xml": `<w:document xmlns:w="${WORD_NS}"><w:body>${content}</w:body></w:document>`,
          ...parts,
        }).map(([name, text]) => [
          name,
          typeof text === "string" ? strToU8(text) : text,
        ]),
      ),
      { level },
    ),
  );
}
