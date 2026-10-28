import { parser } from "sax";
import { openPackage } from "./ooxml-zip.mjs";
import { posix } from "node:path";

export const DOCX_READER_VERSION = "docx/1";
const wordUris = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const relationUris = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);
const fail = (code) => {
  throw Error(code);
};
function xml(bytes) {
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const declared = text
      .match(/^\s*<\?xml[^?]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]
      .toLowerCase();
    if (
      declared &&
      !(encoding === "utf-8"
        ? ["utf-8", "utf8"].includes(declared)
        : ["utf-16", encoding].includes(declared))
    )
      fail("DOCX_XML_ENCODING");
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("DOCX_XML_UNSAFE");
    return text;
  } catch (e) {
    if (e.message === "DOCX_XML_UNSAFE") throw e;
    fail("DOCX_XML_ENCODING");
  }
}
function parseXml(bytes, open, close = () => {}, text = () => {}) {
  const p = parser(true, {
    xmlns: true,
    strictEntities: true,
    trim: false,
    normalize: false,
  });
  let depth = 0;
  p.ondoctype = () => fail("DOCX_XML_UNSAFE");
  p.onerror = () => fail("DOCX_XML_MALFORMED");
  p.onopentag = (node) => {
    if (++depth > 128) fail("DOCX_XML_DEPTH");
    open(node);
  };
  p.onclosetag = () => {
    close();
    depth--;
  };
  p.ontext = text;
  p.oncdata = text;
  p.write(xml(bytes)).close();
}
const attr = (node, local) =>
  Object.values(node.attributes).find(
    (a) => a.local === local && (wordUris.has(a.uri) || !a.uri),
  )?.value;
const isWord = (node, name) => wordUris.has(node.uri) && node.local === name;

// This is structural text reading, never Word automation or rendering. Exact
// part/paragraph/table coordinates survive model windows; omitted objects are
// explicitly uncovered instead of being counted as fully read.
export function readDocx(bytes, { add, missing }) {
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    missing("DOCX_ENCRYPTED_UNSUPPORTED");
    return;
  }
  let pkg;
  try {
    pkg = openPackage(bytes);
  } catch (e) {
    missing(e.message);
    return;
  }
  if (
    !pkg.names.includes("[Content_Types].xml") ||
    !pkg.names.includes("word/document.xml")
  ) {
    missing("DOCX_PACKAGE_MISSING");
    return;
  }
  if (pkg.names.some((n) => /(?:vbaProject\.bin|vbaData\.xml)$/i.test(n))) {
    missing("DOCX_MACRO_UNSUPPORTED");
    return;
  }
  try {
    let mainType = false;
    parseXml(pkg.read("[Content_Types].xml"), (node) => {
      if (
        node.local === "Override" &&
        node.uri ===
          "http://schemas.openxmlformats.org/package/2006/content-types" &&
        node.attributes.PartName?.value === "/word/document.xml" &&
        node.attributes.ContentType?.value ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
      )
        mainType = true;
    });
    if (!mainType) {
      missing("DOCX_PACKAGE_MISSING");
      return;
    }
  } catch (e) {
    missing(e.message);
    return;
  }
  const omitted = new Set();
  const storyRoots = new Map([["word/document.xml", "document"]]);
  let mainLink = false;
  const noteMissing = (code, part, detail = {}) => {
    const key = JSON.stringify([code, part, detail]);
    if (!omitted.has(key)) {
      omitted.add(key);
      missing(code, { kind: "docx", part, ...detail });
    }
  };
  for (const name of pkg.names.filter((n) => n.endsWith(".rels"))) {
    try {
      parseXml(pkg.read(name), (node) => {
        if (node.local === "Relationship" && relationUris.has(node.uri)) {
          const type = node.attributes.Type?.value || "";
          if (node.attributes.TargetMode?.value === "External")
            noteMissing("DOCX_EXTERNAL_LINK", name);
          else {
            const rawTarget = node.attributes.Target?.value || "";
            if (
              name === "_rels/.rels" &&
              /\/officeDocument$/.test(type) &&
              ["word/document.xml", "/word/document.xml"].includes(rawTarget)
            )
              mainLink = true;
            const kind = type.split("/").at(-1);
            if (
              name === "word/_rels/document.xml.rels" &&
              [
                "header",
                "footer",
                "footnotes",
                "endnotes",
                "comments",
              ].includes(kind)
            ) {
              let target;
              try {
                target = decodeURIComponent(rawTarget);
              } catch {
                fail("DOCX_PACKAGE_MISSING");
              }
              if (!target || /[\\:#?\x00-\x1f]/.test(target))
                fail("DOCX_PACKAGE_MISSING");
              target = posix.normalize(
                target.startsWith("/") ? target.slice(1) : "word/" + target,
              );
              if (target.startsWith("../") || !pkg.names.includes(target))
                noteMissing("PACKAGE_PART_MISSING", name);
              else
                storyRoots.set(
                  target,
                  kind === "header" ? "hdr" : kind === "footer" ? "ftr" : kind,
                );
            }
          }
          if (/\/(?:aFChunk|oleObject|package|subDocument)$/.test(type))
            noteMissing("DOCX_OBJECT_UNREAD", name);
        }
      });
    } catch (e) {
      noteMissing(e.message, name);
    }
  }
  if (!mainLink) {
    missing("DOCX_PACKAGE_MISSING");
    return;
  }
  const parts = [
    "word/document.xml",
    ...[...storyRoots.keys()]
      .filter((n) => n !== "word/document.xml")
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
  ];
  for (const part of parts) {
    const stack = [],
      tables = [];
    let paragraph = null,
      paragraphIndex = 0,
      tableIndex = 0,
      skip = 0,
      note = null,
      bodySeen = false;
    try {
      parseXml(
        pkg.read(part),
        (node) => {
          stack.push(node);
          if (
            stack.length === 1 &&
            (!wordUris.has(node.uri) || node.local !== storyRoots.get(part))
          )
            fail("DOCX_STRUCTURE_INVALID");
          if (isWord(node, "body")) bodySeen = true;
          if (skip) {
            skip++;
            return;
          }
          if (
            (node.local === "AlternateContent" &&
              node.uri ===
                "http://schemas.openxmlformats.org/markup-compatibility/2006") ||
            [
              "drawing",
              "pict",
              "object",
              "txbxContent",
              "altChunk",
              "sym",
            ].some((n) => isWord(node, n)) ||
            node.uri ===
              "http://schemas.openxmlformats.org/officeDocument/2006/math"
          ) {
            noteMissing("DOCX_OBJECT_UNREAD", part, {
              paragraph: paragraphIndex || 1,
            });
            skip = 1;
            return;
          }
          if (isWord(node, "del") || isWord(node, "moveFrom")) {
            noteMissing("DOCX_REVISIONS", part, {
              paragraph: paragraphIndex || 1,
            });
            skip = 1;
            return;
          }
          if (isWord(node, "ins") || isWord(node, "moveTo"))
            noteMissing("DOCX_REVISIONS", part, {
              paragraph: paragraphIndex || 1,
            });
          if (["footnote", "endnote", "comment"].some((n) => isWord(node, n)))
            note = attr(node, "id");
          if (isWord(node, "tbl"))
            tables.push({
              table: ++tableIndex,
              row: 0,
              column: 0,
              columnSpan: 1,
              verticalMerge: "",
            });
          const table = tables.at(-1);
          if (table && isWord(node, "tr")) {
            table.row++;
            table.column = 0;
          }
          if (table && isWord(node, "tc")) {
            table.column++;
            table.columnSpan = 1;
            table.verticalMerge = "";
          }
          if (table && isWord(node, "gridSpan")) {
            const span = Number(attr(node, "val"));
            if (!Number.isSafeInteger(span) || span < 1 || span > 1024)
              fail("DOCX_TABLE_INVALID");
            table.columnSpan = span;
          }
          if (table && isWord(node, "vMerge"))
            table.verticalMerge = attr(node, "val") || "continue";
          if (isWord(node, "p")) {
            if (
              part === "word/document.xml" &&
              !stack.some((n) => isWord(n, "body"))
            )
              fail("DOCX_STRUCTURE_INVALID");
            if (paragraph) fail("DOCX_STRUCTURE_INVALID");
            paragraph = {
              text: "",
              index: ++paragraphIndex,
              ...(table ? { ...table } : {}),
              ...(note !== null ? { note } : {}),
              references: [],
            };
          }
          if (paragraph) {
            if (isWord(node, "tab")) paragraph.text += "\t";
            if (isWord(node, "noBreakHyphen")) paragraph.text += "\u2011";
            if (isWord(node, "softHyphen")) paragraph.text += "\u00ad";
            if (isWord(node, "br") || isWord(node, "cr"))
              paragraph.text += "\n";
            if (isWord(node, "numPr"))
              noteMissing("DOCX_NUMBERING", part, {
                paragraph: paragraphIndex,
              });
            if (
              ["fldChar", "fldSimple", "instrText", "dataBinding"].some((n) =>
                isWord(node, n),
              )
            )
              noteMissing("DOCX_DYNAMIC_FIELD", part, {
                paragraph: paragraphIndex,
              });
            if (
              [
                "footnoteReference",
                "endnoteReference",
                "commentReference",
              ].some((n) => isWord(node, n))
            )
              paragraph.references.push({
                kind: node.local,
                id: attr(node, "id") || "",
              });
          }
        },
        () => {
          const node = stack.pop();
          if (skip) {
            skip--;
            return;
          }
          if (isWord(node, "p")) {
            const { text, index, references, ...geometry } = paragraph;
            add(
              text + "\n",
              { kind: "docx", part, paragraph: index, ...geometry },
              {
                encoding: "docx",
                ...geometry,
                ...(references.length ? { references } : {}),
              },
            );
            paragraph = null;
          }
          if (isWord(node, "tc")) {
            const table = tables.at(-1);
            table.column += table.columnSpan - 1;
          }
          if (isWord(node, "tbl")) tables.pop();
          if (["footnote", "endnote", "comment"].some((n) => isWord(node, n)))
            note = null;
        },
        (text) => {
          if (!skip && paragraph && isWord(stack.at(-1) || {}, "t"))
            paragraph.text += text.replace(/\r\n?/g, "\n");
        },
      );
      if (part === "word/document.xml" && !bodySeen)
        fail("DOCX_STRUCTURE_INVALID");
    } catch (e) {
      noteMissing(e.message, part, { paragraph: paragraphIndex || 1 });
    }
  }
  for (const name of pkg.names)
    if (
      /^word\/(?:header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(
        name,
      ) &&
      !storyRoots.has(name)
    )
      noteMissing("DOCX_UNLINKED_PART", name);
  for (const name of pkg.names)
    if (/^word\/(?:media|embeddings)\//.test(name) && !name.endsWith("/"))
      noteMissing("DOCX_OBJECT_UNREAD", name);
}
