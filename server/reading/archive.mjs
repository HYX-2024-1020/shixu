import { openPackage } from "./ooxml-zip.mjs";
import { readMaterial, sha256, MAX_FILE_BYTES } from "./material.mjs";

// Only called inside the same restricted worker as the other material readers.
// No member is extracted onto the filesystem. Native formats use a verified
// fixed reader with literal member selection inside this same worker budget.
export async function readArchive(
  bytes,
  result,
  { windowCodepoints, archiveWindow },
) {
  const missing = (code, archivePath) => {
    result.uncovered.push({
      kind: "archive",
      ...(archivePath ? { archivePath } : {}),
      code,
    });
    if (!result.reasons.includes(code)) result.reasons.push(code);
  };
  const budget = { expanded: archiveWindow?.expanded || 0 };
  let pkg;
  try {
    const extension = result.name.split(".").at(-1).toLowerCase();
    if (extension === "zip") {
      if (
        bytes.length < 4 ||
        ![0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0))
      )
        throw Error("FORMAT_MISMATCH");
      pkg = openPackage(bytes, { budget, archive: true });
    } else {
      const { openNativeArchive } = await import("./native-archive.mjs");
      pkg = await openNativeArchive(bytes, { budget, extension });
    }
  } catch (e) {
    const code =
      /^(PACKAGE_(INVALID|UNSUPPORTED|PATH|LIMIT)|ARCHIVE_(ENCODING|RAR4)_UNSUPPORTED|NATIVE_READER_UNSUPPORTED|FORMAT_MISMATCH)$/.test(
        e.message,
      )
        ? e.message
        : "PACKAGE_INVALID";
    missing(code);
    result.state = /UNSUPPORTED/.test(code) ? "unsupported" : "failed";
    return result;
  }
  if (!pkg.names.length) {
    await pkg.close?.();
    result.reasons.push("EMPTY_TEXT");
    return result;
  }
  const outerExpanded = budget.expanded - (archiveWindow?.expanded || 0);
  let offset = archiveWindow?.offset || 0;
  let childPagination, childImagePagination;
  let index = archiveWindow?.entry || 0;
  if (
    archiveWindow &&
    (index >= pkg.names.length ||
      (archiveWindow.page > 1 && !/\.(pdf|png|jpe?g)$/i.test(pkg.names[index])))
  ) {
    await pkg.close?.();
    throw Error("INVALID_ARCHIVE_WINDOW");
  }
  const end = archiveWindow ? index + 1 : pkg.names.length;
  try {
    for (; index < end; index++) {
      const path = pkg.names[index];
      if (path.endsWith("/")) continue;
      if (/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(path)) {
        missing("ARCHIVE_NESTED_UNSUPPORTED", path);
        continue;
      }
      const extension = /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase();
      if (!["txt", "csv", "docx", "xlsx", "pdf", "png", "jpg", "jpeg"].includes(extension)) {
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
        const body = await pkg.read(path);
        // Magic-based rejection also catches nested packages renamed to text.
        if (
          extension !== "docx" &&
          extension !== "xlsx" &&
          (body.subarray(0, 4).equals(Buffer.from("PK\x03\x04")) ||
            body.subarray(0, 4).equals(Buffer.from("PK\x05\x06")) ||
            body.subarray(0, 6).toString("hex") === "377abcaf271c" ||
            body.subarray(0, 4).toString("latin1") === "Rar!")
        ) {
          missing("ARCHIVE_NESTED_UNSUPPORTED", path);
          continue;
        }
        child = await readMaterial(
          {
            id:
              "entry_" + sha256(result.attachmentId + "\0" + path).slice(0, 48),
            name: "entry." + extension,
            body,
            hash: sha256(body),
            size: body.length,
          },
          {
            windowCodepoints,
            expansionBudget: budget,
            ...(["png", "jpg", "jpeg"].includes(extension)
              ? { imageWindow: { tile: archiveWindow?.page || 1 } }
              : {}),
            ...(archiveWindow && extension === "pdf"
              ? {
                  pdfWindow: {
                    page: archiveWindow.page,
                    offset: archiveWindow.offset - archiveWindow.base,
                  },
                }
              : {}),
          },
        );
      } catch {
        missing("ARCHIVE_ENTRY_FAILED", path);
        continue;
      }
      childPagination = child.pagination;
      childImagePagination = child.imagePagination;
      const base = archiveWindow?.base ?? offset;
      for (const segment of child.segments) {
        const range = {
          ...segment.range,
          name: result.name,
          archivePath: path,
          start: segment.range.start + base,
          end: segment.range.end + base,
        };
        result.segments.push({ ...segment, range });
        result.covered.push(range);
      }
      offset =
        base +
        Math.max(
          archiveWindow ? archiveWindow.offset - base : 0,
          ...[...child.covered, ...child.uncovered].map((r) =>
            Number.isSafeInteger(r.end) ? r.end : 0,
          ),
        );
      for (const range of child.uncovered)
        result.uncovered.push({
          ...range,
          archivePath: path,
          ...(Number.isSafeInteger(range.start)
            ? { start: range.start + base }
            : {}),
          ...(Number.isSafeInteger(range.end) ? { end: range.end + base } : {}),
        });
      for (const code of child.reasons)
        if (!result.reasons.includes(code)) result.reasons.push(code);
      if (!child.segments.length && !child.uncovered.length)
        missing("ARCHIVE_EMPTY_ENTRY", path);
    }
  } finally {
    await pkg.close?.();
  }
  if (archiveWindow) {
    const path = pkg.names[archiveWindow.entry];
    const nextPage = childPagination?.nextPage ?? childImagePagination?.nextTile;
    const morePages = nextPage > archiveWindow.page;
    const next = morePages
      ? { ...archiveWindow, page: nextPage, offset }
      : index < pkg.names.length
        ? {
            entry: index,
            page: 1,
            offset,
            base: offset,
            expanded: budget.expanded - outerExpanded,
          }
        : null;
    result.archivePagination = {
      start: archiveWindow,
      next,
      entries: pkg.names.length,
      archivePath: path,
      ...(childPagination ? { pdf: childPagination } : {}),
      ...(childImagePagination ? { image: childImagePagination } : {}),
    };
    // Future members are metadata only. They have not been read or modeled.
    for (const pending of pkg.names.slice(index))
      if (!pending.endsWith("/")) missing("ARCHIVE_WINDOW_PENDING", pending);
    if (childImagePagination)
      result.archiveImageTiles = [{
        archivePath: path,
        checked: childImagePagination.startTile,
        total: childImagePagination.totalTiles,
      }];
    if (childPagination)
      result.archivePdfPages = [
        {
          archivePath: path,
          checked:
            childPagination.nextPage === null
              ? childPagination.totalPages
              : childPagination.nextPage - 1,
          total: childPagination.totalPages,
        },
      ];
  }
  result.state = result.uncovered.length
    ? result.segments.some((s) => s.text.trim())
      ? "partial"
      : result.reasons.some((c) => /UNSUPPORTED/.test(c))
        ? "unsupported"
        : "failed"
    : "read";
  if (!result.segments.length && !result.uncovered.length)
    result.reasons.push("EMPTY_TEXT");
  return result;
}
