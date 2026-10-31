import { posix } from "node:path";
import { parseXml } from "./ooxml-xml.mjs";
const ns = (name) =>
  new Set([
    `http://schemas.openxmlformats.org/${name}/2006/main`,
    `http://purl.oclc.org/ooxml/${name}/main`,
  ]);
const word = ns("wordprocessingml"),
  sheet = ns("spreadsheetml"),
  drawing = ns("drawingml");
const picture = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/picture",
  "http://purl.oclc.org/ooxml/drawingml/picture",
]);
const xdr = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing",
]);
const relations = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);
const officeRel = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const contentNS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const attr = (n, k) => n.attributes[k]?.value;
const relAttr = (n, k) =>
  Object.values(n.attributes).find((a) => a.local === k && officeRel.has(a.uri))
    ?.value;
const is = (n, set, name) => !!n && set.has(n.uri) && n.local === name;
const fail = () => {
  throw Error("OFFICE_IMAGE_REFERENCE_INVALID");
};
function target(base, raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw || "");
  } catch {
    fail();
  }
  if (
    !decoded ||
    /[\\:#?\x00-\x1f\x7f]/.test(decoded) ||
    decoded.startsWith("//")
  )
    fail();
  const resolved = posix.normalize(
    decoded.startsWith("/")
      ? decoded.slice(1)
      : posix.join(posix.dirname(base), decoded),
  );
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    resolved.startsWith("/")
  )
    fail();
  return resolved;
}
function rels(pkg, part) {
  const file = posix.join(
      posix.dirname(part),
      "_rels",
      posix.basename(part) + ".rels",
    ),
    result = new Map();
  if (!pkg.names.includes(file)) return result;
  let depth = 0;
  parseXml(
    pkg.read(file),
    (node) => {
      depth++;
      if (
        depth === 1 &&
        (!relations.has(node.uri) || node.local !== "Relationships")
      )
        fail();
      if (depth === 1) return;
      if (
        depth !== 2 ||
        !relations.has(node.uri) ||
        node.local !== "Relationship"
      )
        fail();
      const id = attr(node, "Id"),
        type = attr(node, "Type"),
        mode = attr(node, "TargetMode");
      if (
        !id ||
        id.length > 200 ||
        result.has(id) ||
        !type ||
        (mode && !["Internal", "External"].includes(mode))
      )
        fail();
      result.set(id, {
        type,
        external: mode === "External",
        target: mode === "External" ? null : target(part, attr(node, "Target")),
      });
    },
    () => depth--,
    () => {},
    "OFFICE",
  );
  return result;
}
const typeIs = (type, kind) =>
  [...officeRel].some((base) => type === base + "/" + kind);
function contentTypes(pkg) {
  const defaults = new Map(),
    overrides = new Map();
  let depth = 0;
  parseXml(
    pkg.read("[Content_Types].xml"),
    (n) => {
      depth++;
      if (n.uri !== contentNS) fail();
      if (depth === 1) {
        if (n.local !== "Types") fail();
        return;
      }
      if (depth !== 2 || !["Default", "Override"].includes(n.local)) fail();
      const override = n.local === "Override",
        raw = attr(n, override ? "PartName" : "Extension"),
        value = attr(n, "ContentType");
      if (
        !raw ||
        !value ||
        value.length > 200 ||
        (override && !raw.startsWith("/"))
      )
        fail();
      const key = override ? target("", raw) : raw.toLowerCase(),
        map = override ? overrides : defaults;
      if (map.has(key)) fail();
      map.set(key, value);
    },
    () => depth--,
    () => {},
    "OFFICE",
  );
  return (name) =>
    overrides.get(name) ||
    defaults.get(posix.extname(name).slice(1).toLowerCase());
}
const imageTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const cell = (column, row) => {
  let text = "";
  for (let c = column + 1; c > 0; ) {
    c--;
    text = String.fromCharCode(65 + (c % 26)) + text;
    c = Math.floor(c / 26);
  }
  return text + (row + 1);
};

// This enumerates referenced original image assets, never rasterizes Office
// layout or fetches links. All paths stay exact names inside the checked ZIP.
export function scanOfficeImages(pkg, format, parts) {
  const images = [],
    missing = [];
  let references = 0;
  const note = (code, range) => {
    if (missing.length >= 1000) throw Error("OFFICE_IMAGE_REFERENCE_LIMIT");
    missing.push({ ...range, code });
  };
  let mime;
  try {
    mime = contentTypes(pkg);
  } catch (e) {
    return { images: [], missing: [{ kind: format, code: e.message }] };
  }
  const image = (part, id, links, locator) => {
    if (++references > 1000) throw Error("OFFICE_IMAGE_REFERENCE_LIMIT");
    const relation = links.get(id);
    if (!relation || !typeIs(relation.type, "image")) fail();
    if (relation.external) {
      note("OFFICE_EXTERNAL_IMAGE_UNREAD", locator);
      return null;
    }
    const media = relation.target,
      extension = posix.extname(media).slice(1).toLowerCase();
    if (!pkg.names.includes(media) || media.endsWith("/")) fail();
    if (!imageTypes[extension] || mime(media) !== imageTypes[extension]) {
      note("OFFICE_IMAGE_ENCODING_UNSUPPORTED", {
        ...locator,
        mediaPart: media,
      });
      return null;
    }
    if (pkg.size(media) > 10 * 1024 * 1024) {
      note("OFFICE_IMAGE_SIZE_LIMIT", { ...locator, mediaPart: media });
      return null;
    }
    return { ...locator, part, mediaPart: media, relationship: id, extension };
  };
  for (const entry of parts) {
    const part = typeof entry === "string" ? entry : entry.part,
      locator = {
        kind: format,
        part,
        ...(format === "xlsx"
          ? {
              sheet: entry.name,
              sheetId: entry.id,
              ...(["hidden", "veryHidden"].includes(entry.visibility)
                ? { hiddenSheet: entry.visibility }
                : {}),
            }
          : {}),
      };
    const pending = [];
    try {
      const links = rels(pkg, part),
        stack = [];
      let paragraph = 0,
        skip = 0;
      if (format === "docx") {
        parseXml(
          pkg.read(part),
          (n) => {
            stack.push(n);
            if (
              stack.length === 1 &&
              (!word.has(n.uri) ||
                ![
                  "document",
                  "hdr",
                  "ftr",
                  "footnotes",
                  "endnotes",
                  "comments",
                ].includes(n.local))
            )
              fail();
            if (skip) {
              skip++;
              return;
            }
            if (
              (word.has(n.uri) &&
                ["del", "moveFrom", "object", "pict", "txbxContent"].includes(
                  n.local,
                )) ||
              n.local === "AlternateContent"
            ) {
              skip = 1;
              return;
            }
            if (is(n, word, "p")) paragraph++;
            if (!is(n, drawing, "blip")) return;
            if (
              !stack.some((x) => is(x, picture, "pic")) ||
              !stack.some((x) => is(x, word, "drawing")) ||
              !paragraph ||
              (part === "word/document.xml" &&
                !stack.some((x) => is(x, word, "body")))
            )
              fail();
            const at = { ...locator, paragraph };
            if (relAttr(n, "link")) {
              note("OFFICE_EXTERNAL_IMAGE_UNREAD", at);
              return;
            }
            const found = image(part, relAttr(n, "embed"), links, at);
            if (found) pending.push(found);
          },
          () => {
            if (skip) skip--;
            stack.pop();
          },
          () => {},
          "OFFICE",
        );
      } else {
        let depth = 0;
        const drawingParts = [];
        parseXml(
          pkg.read(part),
          (n) => {
            depth++;
            if (depth === 1 && !is(n, sheet, "worksheet")) fail();
            if (!is(n, sheet, "drawing")) return;
            if (depth !== 2) fail();
            const relation = links.get(relAttr(n, "id"));
            if (
              !relation ||
              !typeIs(relation.type, "drawing") ||
              relation.external ||
              !pkg.names.includes(relation.target)
            )
              fail();
            if (drawingParts.includes(relation.target)) fail();
            drawingParts.push(relation.target);
          },
          () => depth--,
          () => {},
          "OFFICE",
        );
        for (const drawingPart of drawingParts) {
          const imageLinks = rels(pkg, drawingPart),
            nodes = [];
          let anchor = null,
            marker = null,
            capture = null,
            skipped = 0;
          parseXml(
            pkg.read(drawingPart),
            (n) => {
              nodes.push(n);
              if (nodes.length === 1 && !is(n, xdr, "wsDr")) fail();
              if (skipped) {
                skipped++;
                return;
              }
              if (n.local === "AlternateContent") {
                skipped = 1;
                note("OFFICE_DRAWING_LAYOUT_UNREAD", {
                  ...locator,
                  drawingPart,
                });
                return;
              }
              if (nodes.length === 2) {
                if (
                  !xdr.has(n.uri) ||
                  ![
                    "oneCellAnchor",
                    "twoCellAnchor",
                    "absoluteAnchor",
                  ].includes(n.local)
                )
                  fail();
                anchor = { type: n.local, from: {}, to: {}, refs: [] };
              }
              if (!anchor) return;
              if (
                xdr.has(n.uri) &&
                ["from", "to"].includes(n.local) &&
                nodes.length === 3
              )
                marker = n.local;
              if (
                marker &&
                xdr.has(n.uri) &&
                ["col", "row", "colOff", "rowOff"].includes(n.local) &&
                nodes.length === 4
              ) {
                capture = { name: n.local, text: "" };
              }
              if (is(n, drawing, "blip")) {
                if (!nodes.some((x) => is(x, xdr, "pic"))) fail();
                if (relAttr(n, "link")) {
                  note("OFFICE_EXTERNAL_IMAGE_UNREAD", {
                    ...locator,
                    drawingPart,
                  });
                  return;
                }
                anchor.refs.push(relAttr(n, "embed"));
              }
            },
            () => {
              const n = nodes.at(-1);
              if (skipped) skipped--;
              else if (capture && n.local === capture.name) {
                if (!/^\d+$/.test(capture.text)) fail();
                const value = Number(capture.text);
                if (
                  !Number.isSafeInteger(value) ||
                  value < 0 ||
                  value >
                    (capture.name === "col"
                      ? 16383
                      : capture.name === "row"
                        ? 1048575
                        : 2147483647) ||
                  Object.hasOwn(anchor[marker], capture.name)
                )
                  fail();
                anchor[marker][capture.name] = value;
                capture = null;
              } else if (marker && n.local === marker) marker = null;
              if (nodes.length === 2 && anchor) {
                const from = anchor.from,
                  to = anchor.to;
                if (
                  anchor.type !== "absoluteAnchor" &&
                  (!Number.isInteger(from.col) || !Number.isInteger(from.row))
                )
                  fail();
                if (
                  anchor.type === "twoCellAnchor" &&
                  (!Number.isInteger(to.col) ||
                    !Number.isInteger(to.row) ||
                    to.col < from.col ||
                    to.row < from.row)
                )
                  fail();
                const at = {
                  ...locator,
                  drawingPart,
                  anchorType: anchor.type,
                  ...(anchor.type === "absoluteAnchor"
                    ? {}
                    : { cell: cell(from.col, from.row), anchorFrom: from }),
                  ...(anchor.type === "twoCellAnchor"
                    ? { cellEnd: cell(to.col, to.row), anchorTo: to }
                    : {}),
                };
                for (const id of anchor.refs) {
                  const found = image(drawingPart, id, imageLinks, at);
                  if (found) pending.push({ ...found, part });
                }
                anchor = null;
              }
              nodes.pop();
            },
            (text) => {
              if (capture) capture.text += text;
            },
            "OFFICE",
          );
        }
      }
      if (images.length + pending.length > 1000)
        throw Error("OFFICE_IMAGE_REFERENCE_LIMIT");
      images.push(...pending);
    } catch (e) {
      note(
        /^(OFFICE|PACKAGE)_[A-Z_]+$/.test(e.message)
          ? e.message
          : "OFFICE_IMAGE_REFERENCE_INVALID",
        locator,
      );
    }
  }
  return { images, missing };
}
