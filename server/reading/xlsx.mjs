import { posix } from "node:path";
import { SSF } from "xlsx/xlsx.mjs";
import { openPackage } from "./ooxml-zip.mjs";
import { parseXml } from "./ooxml-xml.mjs";

export const XLSX_READER_VERSION = "xlsx/1";
const mainUris = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const relUris = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);
const officeRelUris = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const attr = (node, name) => node.attributes[name]?.value;
const is = (node, name) =>
  node && mainUris.has(node.uri) && node.local === name;
const fail = (code) => {
  throw Error(code);
};
const spreadsheetString = (value) =>
  value
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\r\n?/g, "\n");
const xml = (bytes, open, close, text) =>
  parseXml(bytes, open, close, text, "XLSX");
const integer = (value, min, max) => {
  if (!/^\d+$/.test(value || "")) fail("XLSX_STRUCTURE_INVALID");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    fail("XLSX_STRUCTURE_INVALID");
  return n;
};
function address(ref) {
  const m = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref || "");
  if (!m) fail("XLSX_STRUCTURE_INVALID");
  const column = [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const row = integer(m[2], 1, 1048576);
  if (column > 16384) fail("XLSX_STRUCTURE_INVALID");
  return { row, column };
}
function columnName(column) {
  let name = "";
  while (column > 0) {
    column--;
    name = String.fromCharCode(65 + (column % 26)) + name;
    column = Math.floor(column / 26);
  }
  return name;
}
function target(base, raw) {
  let name;
  try {
    name = decodeURIComponent(raw || "");
  } catch {
    fail("PACKAGE_PATH");
  }
  if (!name || /[\\:#?\x00-\x1f]/.test(name) || name.startsWith("//"))
    fail("PACKAGE_PATH");
  const resolved = posix.normalize(
    name.startsWith("/")
      ? name.slice(1)
      : posix.join(posix.dirname(base), name),
  );
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    resolved.startsWith("/")
  )
    fail("PACKAGE_PATH");
  return resolved;
}

// Only cell values/structure are read. Formula evaluation, links, rendering,
// VBA and filesystem extraction never enter this layer. SSF formats a number;
// the complete SheetJS workbook/ZIP parsers are deliberately not invoked.
export function readXlsx(bytes, { add, missing, budget }) {
  const omitted = new Set();
  const note = (code, range = { kind: "xlsx" }) => {
    const key = JSON.stringify([code, range]);
    if (!omitted.has(key)) {
      omitted.add(key);
      missing(code, range);
    }
  };
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    note("XLSX_ENCRYPTED_UNSUPPORTED");
    return;
  }
  let pkg;
  try {
    pkg = openPackage(bytes, { budget });
  } catch (e) {
    note(e.message);
    return;
  }
  if (pkg.names.some((name) => /vbaProject\.bin$|vbaData\.xml$/i.test(name))) {
    note("XLSX_MACRO_UNSUPPORTED");
    return;
  }
  const types = new Map(),
    relations = new Map(),
    sheets = [],
    shared = [],
    formats = new Map(),
    styles = [];
  let date1904 = false;
  const relationships = (part, base) => {
    const values = new Map();
    if (!pkg.names.includes(part)) return values;
    let root = false,
      depth = 0;
    xml(
      pkg.read(part),
      (node) => {
        if (depth++ === 0) {
          if (node.local !== "Relationships" || !relUris.has(node.uri))
            fail("XLSX_STRUCTURE_INVALID");
          root = true;
        }
        if (node.local !== "Relationship" || !relUris.has(node.uri)) return;
        if (depth !== 2) fail("XLSX_STRUCTURE_INVALID");
        const id = attr(node, "Id"),
          type = attr(node, "Type") || "";
        if (!id || values.has(id)) fail("XLSX_STRUCTURE_INVALID");
        if (attr(node, "TargetMode") === "External") {
          note("XLSX_EXTERNAL_LINK", { kind: "xlsx", part });
          values.set(id, { type, external: true });
        } else {
          if (
            attr(node, "TargetMode") &&
            attr(node, "TargetMode") !== "Internal"
          )
            fail("XLSX_STRUCTURE_INVALID");
          values.set(id, { type, target: target(base, attr(node, "Target")) });
        }
      },
      () => {
        depth--;
      },
    );
    if (!root) fail("XLSX_STRUCTURE_INVALID");
    return values;
  };
  try {
    let contentRoot = false,
      contentDepth = 0;
    xml(
      pkg.read("[Content_Types].xml"),
      (node) => {
        if (contentDepth++ === 0) {
          if (
            node.local !== "Types" ||
            node.uri !==
              "http://schemas.openxmlformats.org/package/2006/content-types"
          )
            fail("XLSX_STRUCTURE_INVALID");
          contentRoot = true;
        }
        if (
          node.uri !==
          "http://schemas.openxmlformats.org/package/2006/content-types"
        )
          return;
        if (node.local === "Types") contentRoot = true;
        if (node.local === "Override") {
          if (contentDepth !== 2) fail("XLSX_STRUCTURE_INVALID");
          const part = attr(node, "PartName"),
            type = attr(node, "ContentType");
          if (!part?.startsWith("/") || types.has(part.slice(1)))
            fail("XLSX_STRUCTURE_INVALID");
          if (/macroEnabled|vbaProject/i.test(type || ""))
            fail("XLSX_MACRO_UNSUPPORTED");
          types.set(part.slice(1), type);
        }
      },
      () => {
        contentDepth--;
      },
    );
    if (
      !contentRoot ||
      types.get("xl/workbook.xml") !==
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
    )
      fail("XLSX_PACKAGE_MISSING");
    const rootRelations = relationships("_rels/.rels", "");
    if (
      ![...rootRelations.values()].some(
        (r) =>
          !r.external &&
          /\/officeDocument$/.test(r.type) &&
          r.target === "xl/workbook.xml",
      )
    )
      fail("XLSX_PACKAGE_MISSING");
    for (const [id, value] of relationships(
      "xl/_rels/workbook.xml.rels",
      "xl/workbook.xml",
    ))
      relations.set(id, value);
    const names = new Set(),
      ids = new Set(),
      stack = [];
    let root = false;
    xml(
      pkg.read("xl/workbook.xml"),
      (node) => {
        const parent = stack.at(-1);
        if (!stack.length) {
          if (!is(node, "workbook")) fail("XLSX_STRUCTURE_INVALID");
          root = true;
        }
        if (is(node, "workbookPr") && is(parent, "workbook")) {
          if (
            attr(node, "date1904") !== undefined &&
            !["0", "1", "true", "false"].includes(attr(node, "date1904"))
          )
            fail("XLSX_STRUCTURE_INVALID");
          date1904 = ["1", "true"].includes(attr(node, "date1904"));
        }
        if (is(node, "sheet") && is(parent, "sheets")) {
          if (!is(stack.at(-2), "workbook")) fail("XLSX_STRUCTURE_INVALID");
          const name = attr(node, "name"),
            id = Object.values(node.attributes).find(
              (a) => a.local === "id" && officeRelUris.has(a.uri),
            )?.value;
          const sheetId = integer(attr(node, "sheetId"), 1, 2147483647);
          if (
            !name ||
            name.length > 31 ||
            names.has(name) ||
            ids.has(sheetId) ||
            !id
          )
            fail("XLSX_STRUCTURE_INVALID");
          names.add(name);
          ids.add(sheetId);
          const relation = relations.get(id);
          const visibility = attr(node, "state") || "visible";
          if (
            !["visible", "hidden", "veryHidden"].includes(visibility) ||
            sheets.some((s) => s.part === relation?.target)
          )
            fail("XLSX_STRUCTURE_INVALID");
          if (
            !relation ||
            relation.external ||
            !/\/worksheet$/.test(relation.type) ||
            types.get(relation.target) !==
              "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
          ) {
            note("XLSX_SHEET_UNREAD", { kind: "xlsx", sheet: name, sheetId });
          } else
            sheets.push({
              name,
              id: sheetId,
              part: relation.target,
              visibility,
            });
        }
        if (is(node, "definedName"))
          note("XLSX_DEFINED_NAME", { kind: "xlsx", part: "xl/workbook.xml" });
        stack.push(node);
      },
      () => stack.pop(),
    );
    if (!root) fail("XLSX_STRUCTURE_INVALID");
  } catch (e) {
    note(e.message);
    return;
  }

  const relatedPart = (kind) => {
    const found = [...relations.values()].filter(
      (r) => !r.external && r.type.endsWith("/" + kind),
    );
    if (found.length > 1) fail("XLSX_STRUCTURE_INVALID");
    return found[0]?.target;
  };
  let sharedPart, stylesPart;
  try {
    sharedPart = relatedPart("sharedStrings");
    stylesPart = relatedPart("styles");
    if (sharedPart) {
      if (
        types.get(sharedPart) !==
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
      )
        fail("XLSX_PACKAGE_MISSING");
      let stack = [],
        item = null,
        root = false,
        total = 0;
      xml(
        pkg.read(sharedPart),
        (node) => {
          if (!stack.length) {
            if (!is(node, "sst")) fail("XLSX_STRUCTURE_INVALID");
            root = true;
          }
          if (is(node, "si")) {
            if (item !== null || !is(stack.at(-1), "sst"))
              fail("XLSX_STRUCTURE_INVALID");
            item = "";
          }
          if (is(node, "rPh"))
            note("XLSX_PHONETIC_UNREAD", { kind: "xlsx", part: sharedPart });
          stack.push(node);
        },
        () => {
          const node = stack.pop();
          if (is(node, "si")) {
            total += Buffer.byteLength(item);
            if (shared.length >= 100000 || total > 32 * 1024 * 1024)
              fail("XLSX_RESOURCE_LIMIT");
            shared.push(spreadsheetString(item));
            item = null;
          }
        },
        (text) => {
          if (
            item !== null &&
            is(stack.at(-1), "t") &&
            !stack.some((n) => is(n, "rPh"))
          )
            item += text.replace(/\r\n?/g, "\n");
        },
      );
      if (!root) fail("XLSX_STRUCTURE_INVALID");
    }
  } catch (e) {
    note(e.message, { kind: "xlsx", part: sharedPart });
  }
  try {
    if (stylesPart) {
      if (
        types.get(stylesPart) !==
        "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"
      )
        fail("XLSX_PACKAGE_MISSING");
      const stack = [];
      let root = false;
      xml(
        pkg.read(stylesPart),
        (node) => {
          if (!stack.length) {
            if (!is(node, "styleSheet")) fail("XLSX_STRUCTURE_INVALID");
            root = true;
          }
          if (is(node, "numFmt") && is(stack.at(-1), "numFmts")) {
            const id = integer(attr(node, "numFmtId"), 0, 65535),
              code = attr(node, "formatCode");
            if (formats.has(id) || !code || code.length > 1024)
              fail("XLSX_FORMAT_UNREAD");
            formats.set(id, code);
          }
          if (is(node, "xf") && is(stack.at(-1), "cellXfs")) {
            if (styles.length >= 10000) fail("XLSX_RESOURCE_LIMIT");
            const formatId = integer(attr(node, "numFmtId") || "0", 0, 65535);
            const inherited = integer(attr(node, "xfId") || "0", 0, 65535);
            if (
              ["0", "false"].includes(attr(node, "applyNumberFormat")) ||
              (inherited > 0 &&
                !["1", "true"].includes(attr(node, "applyNumberFormat")))
            ) {
              styles.push(null);
              note("XLSX_FORMAT_UNREAD", { kind: "xlsx", part: stylesPart });
            } else styles.push(formatId);
          }
          if (is(node, "conditionalFormatting"))
            note("XLSX_FORMAT_UNREAD", { kind: "xlsx", part: stylesPart });
          stack.push(node);
        },
        () => stack.pop(),
      );
      if (!root) fail("XLSX_STRUCTURE_INVALID");
    }
  } catch (e) {
    note(e.message, { kind: "xlsx", part: stylesPart });
  }

  let outputBytes = 0,
    totalCells = 0;
  const knownParts = new Set(sheets.map((s) => s.part));
  for (const sheet of sheets) {
    const locator = {
      kind: "xlsx",
      sheet: sheet.name,
      sheetId: sheet.id,
      part: sheet.part,
    };
    const stack = [];
    let root = false,
      row = null,
      cell = null,
      lastRow = 0,
      lastColumn = 0;
    const sheetMerges = [];
    const emitted = [];
    try {
      // Relationships are checked before any sheet text. External data is not
      // fetched, and drawing/comment omissions do not discard safe cell rows.
      const relPart = posix.join(
        posix.dirname(sheet.part),
        "_rels",
        posix.basename(sheet.part) + ".rels",
      );
      for (const r of relationships(relPart, sheet.part).values())
        if (!/\/(hyperlink|worksheet)$/.test(r.type))
          note("XLSX_OBJECT_UNREAD", locator);
      xml(
        pkg.read(sheet.part),
        (node) => {
          const parent = stack.at(-1);
          if (!stack.length) {
            if (!is(node, "worksheet")) fail("XLSX_STRUCTURE_INVALID");
            root = true;
          }
          if (is(node, "row")) {
            if (!is(parent, "sheetData") || !is(stack.at(-2), "worksheet"))
              fail("XLSX_STRUCTURE_INVALID");
            if (row) fail("XLSX_STRUCTURE_INVALID");
            const index = integer(
              attr(node, "r") || String(lastRow + 1),
              1,
              1048576,
            );
            if (index <= lastRow) fail("XLSX_STRUCTURE_INVALID");
            lastRow = index;
            lastColumn = 0;
            row = {
              index,
              hidden: ["1", "true"].includes(attr(node, "hidden")),
              cells: [],
            };
          }
          if (is(node, "c")) {
            if (!row || cell || !is(parent, "row"))
              fail("XLSX_STRUCTURE_INVALID");
            const ref =
                attr(node, "r") || columnName(lastColumn + 1) + row.index,
              point = address(ref);
            if (point.row !== row.index || point.column <= lastColumn)
              fail("XLSX_STRUCTURE_INVALID");
            if (++totalCells > 200000) fail("XLSX_RESOURCE_LIMIT");
            lastColumn = point.column;
            cell = {
              ref,
              ...point,
              type: attr(node, "t") || "n",
              style: integer(attr(node, "s") || "0", 0, 65535),
              raw: "",
              inline: "",
              formula: null,
              valueSeen: false,
            };
          }
          if (is(node, "f") && cell) {
            if (!is(parent, "c") || cell.formula !== null)
              fail("XLSX_STRUCTURE_INVALID");
            cell.formula = "";
            note("XLSX_FORMULA_CACHED", {
              ...locator,
              row: row.index,
              column: cell.column,
              cell: cell.ref,
            });
          }
          if (is(node, "v") && cell) {
            if (!is(parent, "c")) fail("XLSX_STRUCTURE_INVALID");
            if (cell.valueSeen) fail("XLSX_STRUCTURE_INVALID");
            cell.valueSeen = true;
          }
          if (is(node, "mergeCell") && is(parent, "mergeCells")) {
            const [a, b, ...extra] = (attr(node, "ref") || "").split(":");
            const start = address(a),
              end = address(b || a);
            if (
              extra.length ||
              start.row > end.row ||
              start.column > end.column
            )
              fail("XLSX_STRUCTURE_INVALID");
            if (sheetMerges.length >= 10000) fail("XLSX_RESOURCE_LIMIT");
            sheetMerges.push({ start, end, ref: attr(node, "ref") });
          }
          if (is(node, "col")) note("XLSX_VISUAL_LAYOUT", locator);
          if (
            [
              "drawing",
              "legacyDrawing",
              "oleObjects",
              "extLst",
              "conditionalFormatting",
              "autoFilter",
              "tableParts",
              "sheetProtection",
            ].some((n) => is(node, n))
          )
            note("XLSX_OBJECT_UNREAD", locator);
          if (is(node, "rPh")) note("XLSX_PHONETIC_UNREAD", locator);
          stack.push(node);
        },
        () => {
          const node = stack.pop();
          if (is(node, "c")) {
            const at = {
              ...locator,
              row: row.index,
              column: cell.column,
              cell: cell.ref,
            };
            let value = cell.raw;
            if (cell.type === "inlineStr")
              value = spreadsheetString(cell.inline);
            else if (cell.type === "str") value = spreadsheetString(value);
            else if (cell.type === "s") {
              const index = integer(value, 0, 99999);
              if (index >= shared.length) fail("XLSX_SHARED_STRING_MISSING");
              value = shared[index];
            } else if (cell.type === "b") {
              if (!["0", "1"].includes(value)) fail("XLSX_STRUCTURE_INVALID");
              value = value === "1" ? "TRUE" : "FALSE";
            } else if (cell.type === "e") note("XLSX_CELL_ERROR", at);
            else if (cell.type === "d") {
              if (!/^\d{4}-\d\d-\d\d(?:T[\d:.Z+-]+)?$/.test(value))
                fail("XLSX_STRUCTURE_INVALID");
            } else if (cell.type === "n" && value !== "") {
              if (
                !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
                  value,
                ) ||
                !Number.isFinite(Number(value))
              )
                fail("XLSX_STRUCTURE_INVALID");
              const id =
                styles[cell.style] ??
                (cell.style === 0 && !stylesPart ? 0 : undefined);
              const format = formats.get(id) ?? SSF.get_table()[id];
              if (id === undefined || format === undefined)
                note("XLSX_FORMAT_UNREAD", at);
              else
                try {
                  value = SSF.format(format, Number(value), { date1904 });
                  if (!value.trim()) {
                    value = cell.raw;
                    note("XLSX_FORMAT_UNREAD", at);
                  }
                  // Built-in locale date formats may show only two year
                  // digits. Preserve their display, also make the serial's
                  // actual Gregorian year explicit for downstream tasks.
                  if (
                    SSF.is_date(format) &&
                    /[yd]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g, ""))
                  ) {
                    const date = SSF.parse_date_code(Number(cell.raw), {
                      date1904,
                    });
                    if (date) {
                      value += ` [日期 ${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}]`;
                      if (
                        date.d < 1 ||
                        (date.y === 1900 && date.m === 2 && date.d === 29)
                      )
                        note("XLSX_DATE_COMPAT", at);
                    } else note("XLSX_FORMAT_UNREAD", at);
                  }
                } catch {
                  value = cell.raw;
                  note("XLSX_FORMAT_UNREAD", at);
                }
            } else if (
              !["n", "str", "inlineStr", "s", "b", "e", "d"].includes(cell.type)
            )
              fail("XLSX_STRUCTURE_INVALID");
            const noCache =
              cell.formula !== null &&
              (!cell.valueSeen || (cell.type !== "str" && cell.raw === ""));
            if (noCache) note("XLSX_FORMULA_NO_CACHE", at);
            const display =
              cell.formula !== null
                ? `${value} [${noCache ? "公式无缓存，未计算" : "公式缓存，未重算"}；${cell.formula || "共享公式"}]`
                : value;
            const text = cell.ref + "\t" + display + "\n";
            outputBytes += Buffer.byteLength(text);
            if (outputBytes > 32 * 1024 * 1024) fail("XLSX_RESOURCE_LIMIT");
            row.cells.push({
              meaningful: value.trim() !== "" || cell.formula !== null,
              ref: cell.ref,
              column: cell.column,
              type: cell.type,
              style: cell.style,
              raw: cell.raw,
              ...(cell.formula !== null ? { formula: cell.formula } : {}),
              text,
            });
            cell = null;
          }
          if (is(node, "row")) {
            if (!row.cells.some((c) => c.meaningful)) {
              row = null;
              return;
            }
            const columns = row.cells.map(({ text, meaningful, ...c }) => c);
            const text = row.cells.map((c) => c.text).join("") || "\n";
            const source = {
              ...locator,
              row: row.index,
              rowEnd: row.index,
              column: row.cells[0]?.column || 1,
              columnEnd: row.cells.at(-1)?.column || 1,
            };
            const structure = {
              encoding: "xlsx",
              row: row.index,
              hidden: row.hidden,
              sheetVisibility: sheet.visibility,
              date1904,
              columns,
              merges: sheetMerges,
            };
            add(text, source, structure);
            emitted.push(structure);
            row = null;
          }
        },
        (text) => {
          if (!cell) return;
          const node = stack.at(-1);
          if (is(node, "v")) cell.raw += text;
          else if (is(node, "f")) cell.formula += text;
          else if (is(node, "t") && !stack.some((n) => is(n, "rPh")))
            cell.inline += text.replace(/\r\n?/g, "\n");
        },
      );
      if (!root) fail("XLSX_STRUCTURE_INVALID");
    } catch (e) {
      note(e.message, {
        ...locator,
        row: row?.index || lastRow || 1,
        cell: cell?.ref,
      });
    }
    // Merges commonly follow sheetData. The shared array fills only after rows
    // have been emitted; no blank-cell grid or duplicate merged values is made.
    // Store a merge once at its anchor row; do not duplicate a workbook-sized
    // merge list into every source row or expand merged blank cells.
    for (const structure of emitted)
      structure.merges = sheetMerges.filter(
        (m) => m.start.row === structure.row,
      );
  }
  for (const name of pkg.names) {
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name) && !knownParts.has(name))
      note("XLSX_SHEET_UNREAD", { kind: "xlsx", part: name });
    if (
      /^xl\/(?:media|drawings|embeddings|externalLinks|comments|charts|pivotTables)\//.test(
        name,
      )
    )
      note("XLSX_OBJECT_UNREAD", { kind: "xlsx", part: name });
  }
}
