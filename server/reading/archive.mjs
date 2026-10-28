import { openPackage } from "./ooxml-zip.mjs";
import { readMaterial, sha256, MAX_FILE_BYTES } from "./material.mjs";

// Only called inside the same restricted worker as the other material readers.
// No member path is ever used as a filesystem path or external program input.
export async function readArchive(bytes, result, { windowCodepoints }) {
  const missing = (code, archivePath) => {
    result.uncovered.push({ kind: "archive", ...(archivePath ? { archivePath } : {}), code });
    if (!result.reasons.includes(code)) result.reasons.push(code);
  };
  const budget = { expanded: 0 };
  let pkg;
  try {
    if (![0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0)))
      throw Error("FORMAT_MISMATCH");
    pkg = openPackage(bytes, { budget, archive: true });
  } catch (e) {
    const code = /^(PACKAGE_(INVALID|UNSUPPORTED|PATH|LIMIT)|ARCHIVE_ENCODING_UNSUPPORTED|FORMAT_MISMATCH)$/.test(e.message)
      ? e.message : "PACKAGE_INVALID";
    missing(code);
    result.state = /UNSUPPORTED/.test(code) ? "unsupported" : "failed";
    return result;
  }
  let offset = 0;
  for (const path of pkg.names) {
    if (path.endsWith("/")) continue;
    if (/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(path)) {
      missing("ARCHIVE_NESTED_UNSUPPORTED", path);
      continue;
    }
    const extension = /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase();
    if (!["txt", "csv", "docx", "xlsx", "pdf"].includes(extension)) {
      missing("FORMAT_UNSUPPORTED", path);
      continue;
    }
    if (pkg.size(path) > MAX_FILE_BYTES) {
      missing("ARCHIVE_ENTRY_LIMIT", path);
      continue;
    }
    if (!pkg.size(path)) {
      missing("ARCHIVE_EMPTY_ENTRY", path);
      continue;
    }
    let child;
    try {
      const body = pkg.read(path);
      // Magic-based rejection also catches nested packages renamed to text.
      if (extension !== "docx" && extension !== "xlsx" &&
          (body.subarray(0, 4).equals(Buffer.from("PK\x03\x04")) ||
           body.subarray(0, 4).equals(Buffer.from("PK\x05\x06")) ||
           body.subarray(0, 6).toString("hex") === "377abcaf271c" ||
           body.subarray(0, 4).toString("latin1") === "Rar!")) {
        missing("ARCHIVE_NESTED_UNSUPPORTED", path);
        continue;
      }
      child = await readMaterial({
        id: "entry_" + sha256(result.attachmentId + "\0" + path).slice(0, 48),
        name: "entry." + extension,
        body, hash: sha256(body), size: body.length,
      }, { windowCodepoints, expansionBudget: budget });
    } catch {
      missing("ARCHIVE_ENTRY_FAILED", path);
      continue;
    }
    const base = offset;
    for (const segment of child.segments) {
      const range = { ...segment.range, name: result.name, archivePath: path,
        start: segment.range.start + offset, end: segment.range.end + offset };
      result.segments.push({ ...segment, range });
      result.covered.push(range);
    }
    offset += Math.max(0, ...[...child.covered, ...child.uncovered]
      .map(r => Number.isSafeInteger(r.end) ? r.end : 0));
    for (const range of child.uncovered)
      result.uncovered.push({ ...range, archivePath: path,
        ...(Number.isSafeInteger(range.start) ? { start: range.start + base } : {}),
        ...(Number.isSafeInteger(range.end) ? { end: range.end + base } : {}) });
    for (const code of child.reasons)
      if (!result.reasons.includes(code)) result.reasons.push(code);
    if (!child.segments.length && !child.uncovered.length)
      missing("ARCHIVE_EMPTY_ENTRY", path);
  }
  result.state = result.uncovered.length
    ? result.segments.some((s) => s.text.trim()) ? "partial"
      : result.reasons.some((c) => /UNSUPPORTED/.test(c)) ? "unsupported" : "failed"
    : "read";
  if (!result.segments.length && !result.uncovered.length)
    result.reasons.push("EMPTY_TEXT");
  return result;
}
