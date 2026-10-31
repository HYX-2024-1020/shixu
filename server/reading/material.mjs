import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { validateArchiveWindow } from "./archive-window.mjs";
import { isImageName, validateImageWindow } from "./image.mjs";
import { validatePdfVisualWindow } from "./pdf-visual.mjs";
import { validatePdfWindow } from "./pdf-window.mjs";

export const READER_VERSION = "text-csv/2;docx/1;xlsx/1;pdf-text/3;pdf-visual/1;archive/10";
export const NORMALIZATION_VERSION = "unicode-lf/1";
export const WINDOW_CODEPOINTS = 120000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const length = (s) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

// Offsets always refer to the normalized document, never UTF-16 code units.
function* windows(text, size) {
  let start = 0,
    units = 0,
    count = 0;
  for (const char of text) {
    units += char.length;
    if (++count === size) {
      yield { text: text.slice(start, units), size: count };
      start = units;
      count = 0;
    }
  }
  if (start < text.length) yield { text: text.slice(start), size: count };
}

// RFC 4180 quoting, accepting LF after normalization. No spreadsheet formulas
// are evaluated; cell contents remain untrusted data. A malformed record never
// consumes the preceding complete records.
function* csvRecords(text) {
  let cells = [],
    cell = "",
    state = "start",
    start = 0,
    line = 1,
    firstLine = 1;
  const endCell = () => {
    cells.push(cell);
    cell = "";
    state = "start";
  };
  const endRow = (end) => {
    endCell();
    const record = { start, end, cells, firstLine, lastLine: line };
    cells = [];
    start = end;
    firstLine = line + 1;
    return record;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === "quoted") {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else state = "closed";
      } else {
        cell += c;
        if (c === "\n") line++;
      }
    } else if (c === ",") endCell();
    else if (c === "\n") {
      yield endRow(i + 1);
      line++;
    } else if (c === '"' && state === "start") state = "quoted";
    else if (c === '"' || state === "closed") {
      yield { failedStart: start };
      return;
    } else {
      cell += c;
      state = "plain";
    }
  }
  if (state === "quoted") {
    yield { failedStart: start };
    return;
  }
  if (start < text.length) {
    endCell();
    yield { start, end: text.length, cells, firstLine, lastLine: line };
  }
}

export function readMaterial(
  { id, name, body, hash, size },
  { windowCodepoints = WINDOW_CODEPOINTS, expansionBudget, pdfTextUnits, pdfWindow, archiveWindow, imageWindow, pdfVisualWindow } = {},
) {
  if (
    typeof id !== "string" ||
    !/^[\w-]{1,100}$/.test(id) ||
    typeof name !== "string" ||
    !name ||
    name.length > 200 ||
    /[\x00-\x1f\\/]/.test(name)
  )
    throw Error("INVALID_DESCRIPTOR");
  if (
    !Number.isSafeInteger(windowCodepoints) ||
    windowCodepoints < 1 ||
    windowCodepoints > WINDOW_CODEPOINTS
  )
    throw Error("INVALID_WINDOW");
  const bytes = Buffer.from(body);
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw Error("INPUT_SIZE");
  const contentHash = sha256(bytes);
  if (hash !== contentHash || size !== bytes.length)
    throw Error("INPUT_INTEGRITY");
  const result = {
    attachmentId: id,
    name,
    contentHash,
    readerVersion: READER_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    state: "read",
    covered: [],
    uncovered: [],
    reasons: [],
    segments: [],
  };
  const fail = (state, code, range = { kind: "file" }) => {
    result.state = state;
    result.uncovered.push({ ...range, code });
    result.reasons.push(code);
    return result;
  };
  archiveWindow = validateArchiveWindow(archiveWindow);
  if (archiveWindow && !/\.(zip|rar|7z)$/i.test(name)) throw Error("INVALID_ARCHIVE_WINDOW");
  pdfVisualWindow=validatePdfVisualWindow(pdfVisualWindow);
  if(pdfVisualWindow && (!/\.pdf$/i.test(name)||pdfWindow||imageWindow||archiveWindow))throw Error("INVALID_PDF_VISUAL_WINDOW");
  if(pdfVisualWindow)return import("./pdf-visual.mjs").then(({readPdfVisual})=>readPdfVisual(bytes,result,pdfVisualWindow));
  pdfWindow = validatePdfWindow(pdfWindow);
  if (pdfWindow && !/\.pdf$/i.test(name)) throw Error("INVALID_PDF_WINDOW");
  imageWindow=validateImageWindow(imageWindow);
  if(imageWindow && !isImageName(name))throw Error('INVALID_IMAGE_WINDOW');
  if(isImageName(name))return import('./image.mjs').then(({readImage})=>readImage(bytes,result,imageWindow));
  let offset = pdfWindow?.offset || 0,
    index = 0;
  const add = (raw, locator, structure) => {
    let part = 0;
    for (const chunk of windows(raw, windowCodepoints)) {
      const sourceId = `${id.slice(0, 64)}_${sha256(id).slice(0, 12)}_${locator.kind === "pdf" ? "p"+locator.page+"_"+part : index++}`;
      const range = {
        sourceId,
        name,
        start: offset,
        end: offset + chunk.size,
        ...locator,
        ...(["docx", "xlsx"].includes(locator.kind)
          ? { fragment: part++ }
          : { part: part++ }),
      };
      result.covered.push(range);
      result.segments.push({
        sourceId,
        text: chunk.text,
        range,
        ...(structure ? { structure } : {}),
      });
      offset += chunk.size;
    }
  };
  if (/\.(zip|rar|7z)$/i.test(name)) {
    return import("./archive.mjs").then(({ readArchive }) =>
      readArchive(bytes, result, { windowCodepoints, archiveWindow }),
    );
  }
  if (/\.pdf$/i.test(name)) {
    return import("./pdf.mjs").then(async ({ readPdf, PDF_READER_VERSION }) => {
      result.readerVersion = PDF_READER_VERSION;
      const pagination = await readPdf(bytes, {
        add,
        textUnitLimit: pdfTextUnits,
        window: pdfWindow,
        missing: (code, range = { kind: "file" }) => {
          result.uncovered.push({ ...range, code });
          if (!result.reasons.includes(code)) result.reasons.push(code);
        },
      });
      if (pagination) result.pagination = { ...pagination, startOffset:pdfWindow.offset, nextOffset:offset };
      result.state = result.segments.some((s) => s.text.trim())
        ? "partial"
        : result.reasons.includes("PDF_ENCRYPTED_UNSUPPORTED")
          ? "unsupported"
          : "failed";
      return result;
    });
  }
  if (/\.(docx|xlsx)$/i.test(name)) {
    const isXlsx = /\.xlsx$/i.test(name);
    const reader = isXlsx
      ? require("./xlsx-reader.cjs")
      : require("./docx-reader.cjs");
    result.readerVersion = isXlsx
      ? reader.XLSX_READER_VERSION
      : reader.DOCX_READER_VERSION;
    (isXlsx ? reader.readXlsx : reader.readDocx)(bytes, {
      add,
      budget: expansionBudget,
      missing: (code, range = { kind: "file" }) => {
        result.uncovered.push({ ...range, code });
        if (!result.reasons.includes(code)) result.reasons.push(code);
      },
    });
    const readable = result.segments.some((s) => s.text.trim());
    result.state = result.uncovered.length
      ? readable
        ? "partial"
        : result.reasons.some((c) =>
              /UNSUPPORTED|DOCX_OBJECT_UNREAD|DOCX_EXTERNAL_LINK/.test(c),
            )
          ? "unsupported"
          : "failed"
      : "read";
    if (!readable && !result.uncovered.length)
      result.reasons.push("EMPTY_TEXT");
    return result;
  }
  if (!/\.(txt|csv)$/i.test(name))
    return fail("unsupported", "FORMAT_UNSUPPORTED");
  // Detect obvious binary masquerading without trusting a client MIME label.
  if (
    /^(%PDF-|PK\x03\x04|\x89PNG|GIF8|RIFF)/.test(
      bytes.subarray(0, 8).toString("latin1"),
    )
  )
    return fail("failed", "FORMAT_MISMATCH");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/\r\n?/g, "\n");
  } catch {
    return fail("unsupported", "ENCODING_UNSUPPORTED");
  }
  if (text.includes("\0")) return fail("failed", "BINARY_TEXT");
  if (/\.csv$/i.test(name)) {
    let row = 0,
      group = null;
    const flush = () => {
      if (!group) return;
      add(
        text.slice(group.start, group.end),
        {
          kind: "csv",
          row: group.row,
          rowEnd: group.rowEnd,
          firstLine: group.firstLine,
          lastLine: group.lastLine,
        },
        { encoding: "csv", columnRuns: group.runs },
      );
      group = null;
    };
    for (const r of csvRecords(text)) {
      if (r.failedStart !== undefined) {
        flush();
        return fail(
          result.segments.length ? "partial" : "failed",
          "CSV_MALFORMED",
          {
            kind: "csv",
            start: offset,
            end: offset + length(text.slice(r.failedStart)),
            row: row + 1,
          },
        );
      }
      row++;
      const raw = text.slice(r.start, r.end),
        count = length(raw);
      if (text.length <= 4096 || count > windowCodepoints) {
        flush();
        add(
          raw,
          {
            kind: "csv",
            row,
            columns: r.cells.length,
            firstLine: r.firstLine,
            lastLine: r.lastLine,
          },
          count <= windowCodepoints
            ? { cells: r.cells }
            : { encoding: "csv", columns: r.cells.length },
        );
        continue;
      }
      if (
        group &&
        (group.count + count > windowCodepoints || row - group.row >= 128)
      )
        flush();
      if (!group)
        group = {
          start: r.start,
          end: r.end,
          row,
          rowEnd: row,
          count: 0,
          firstLine: r.firstLine,
          lastLine: r.lastLine,
          runs: [],
        };
      group.end = r.end;
      group.rowEnd = row;
      group.lastLine = r.lastLine;
      group.count += count;
      const previous = group.runs.at(-1);
      if (previous?.columns === r.cells.length) previous.rowEnd = row;
      else group.runs.push({ row, rowEnd: row, columns: r.cells.length });
    }
    flush();
  } else add(text, { kind: "text" });
  if (!text.trim()) result.reasons.push("EMPTY_TEXT");
  return result;
}

export function* materialBatches(materials, max = WINDOW_CODEPOINTS) {
  if (!Number.isSafeInteger(max) || max < 1 || max > WINDOW_CODEPOINTS)
    throw Error("INVALID_WINDOW");
  let batch = [],
    used = 0;
  for (const material of materials)
    for (const segment of material.segments) {
      const size = segment.range.end - segment.range.start;
      if (size > max) throw Error("SEGMENT_EXCEEDS_WINDOW");
      if (batch.length && used + size > max) {
        yield batch;
        batch = [];
        used = 0;
      }
      batch.push(segment);
      used += size;
    }
  if (batch.length) yield batch;
}

// Safe metadata projection for task state / synchronization. Never persist the
// segments (full extracted text) or CSV cells to the long-lived task database.
export function coverageOnly({ segments, decoderMetrics, ...coverage }) {
  return coverage;
}

// Adapt to the existing model validator's UTF-16 envelope without treating
// that request envelope as a document limit. Every fragment retains location.
export function modelMaterial(material) {
  const segments = [];
  for (const segment of material.segments) {
    if(segment.image){segments.push(segment);continue;}
    let start = 0,
      point = segment.range.start,
      part = 0;
    while (start < segment.text.length) {
      let end = Math.min(start + 60000, segment.text.length);
      if (
        end < segment.text.length &&
        /[\ud800-\udbff]/.test(segment.text[end - 1])
      )
        end--;
      const text = segment.text.slice(start, end),
        count = length(text);
      const sourceId = `${segment.sourceId}_m${part++}`;
      const range = {
        ...segment.range,
        sourceId,
        start: point,
        end: point + count,
      };
      segments.push({
        sourceId,
        text,
        range,
        ...(segment.structure ? { structure: segment.structure } : {}),
      });
      start = end;
      point += count;
    }
  }
  return { ...material, segments, covered: segments.map((s) => s.range) };
}

export function* modelBatches(materials) {
  // Original boundaries make windows stable when another input is revised.
  // Small originals can now require separate calls; all calls retain budgets.
  for (const material of materials) {
    let batch = [],
      units = 0;
    for (const s of material.segments) {
      if (!s.text.trim()) continue;
      if (
        batch.length &&
        (units + s.text.length > 120000 || batch.length >= 128 || (s.image && batch.filter(s=>s.image).length>=2))
      ) {
        yield batch;
        batch = [];
        units = 0;
      }
      batch.push(s);
      units += s.text.length;
    }
    if (batch.length) yield batch;
  }
}
