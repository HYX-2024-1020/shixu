import { coverageOnly } from "./material.mjs";
import { PDF_WINDOW_PAGES } from "./pdf-window.mjs";
import {
  FIRST_ARCHIVE_WINDOW,
  validateArchiveWindow,
} from "./archive-window.mjs";

// Only trusted cursor/coverage metadata is durable. Text stays in the current
// execution window until its paid blocks are confirmed, then is discarded.
export class ReadingWindows {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS reading_windows(task TEXT NOT NULL,attachment TEXT NOT NULL,
      content_hash TEXT NOT NULL,next_page INTEGER NOT NULL,next_offset INTEGER NOT NULL,coverage TEXT NOT NULL,
      PRIMARY KEY(task,attachment));`);
  }
  rows(task) {
    return this.db
      .prepare("SELECT * FROM reading_windows WHERE task=? ORDER BY rowid")
      .all(task);
  }
  select(task, file, { archiveWindows = false } = {}) {
    const row = this.db
      .prepare("SELECT * FROM reading_windows WHERE task=? AND attachment=?")
      .get(task, file.id);
    if (row && row.content_hash !== file.hash) throw Error("INPUT_CHANGED");
    if (row?.next_page === 0) return { skip: true };
    const saved = row && JSON.parse(row.coverage).archivePagination;
    if (saved && !archiveWindows) throw Error("READER_WINDOW_REQUIRED");
    return {
      skip: false,
      ...(archiveWindows && /\.(zip|rar|7z)$/i.test(file.name)
        ? {
            archiveWindow: validateArchiveWindow(
              saved?.next || FIRST_ARCHIVE_WINDOW,
            ),
          }
        : {}),
      ...(/\.pdf$/i.test(file.name)
        ? {
            pdfWindow: {
              page: row?.next_page || 1,
              offset: row?.next_offset || 0,
            },
          }
        : {}),
    };
  }
  verify(material, requested, archiveWindow) {
    if (archiveWindow) return this.verifyArchive(material, archiveWindow);
    if (!requested) return;
    const p = material.pagination;
    if (!p) {
      if (material.segments?.length) throw Error("INVALID_READER_WINDOW");
      return; // Whole-file failure is terminal, never an implicit first window.
    }
    if (
      p.startPage !== requested.page ||
      p.startOffset !== requested.offset ||
      !Number.isSafeInteger(p.totalPages) ||
      p.totalPages < p.startPage ||
      !Number.isSafeInteger(p.nextOffset) ||
      p.nextOffset < p.startOffset ||
      (p.nextPage === null &&
        p.startPage + PDF_WINDOW_PAGES - 1 < p.totalPages) ||
      (p.nextPage !== null &&
        (!Number.isSafeInteger(p.nextPage) ||
          p.nextPage < p.startPage ||
          p.nextPage > p.totalPages ||
          p.nextPage >
            Math.min(p.totalPages, p.startPage + PDF_WINDOW_PAGES - 1) + 1)) ||
      (material.covered || []).some(
        (r) =>
          r.kind !== "pdf" ||
          !Number.isSafeInteger(r.page) ||
          r.page < p.startPage ||
          r.page >= p.startPage + PDF_WINDOW_PAGES ||
          r.page > p.totalPages,
      )
    )
      throw Error("INVALID_READER_WINDOW");
    let offset = requested.offset,
      page = requested.page;
    for (const range of material.covered || []) {
      if (
        range.page < page ||
        range.start !== offset ||
        !Number.isSafeInteger(range.end) ||
        range.end <= offset ||
        (p.nextPage !== null && range.page >= p.nextPage)
      )
        throw Error("INVALID_READER_WINDOW");
      offset = range.end;
      page = range.page;
    }
    if (p.nextOffset !== offset) throw Error("INVALID_READER_WINDOW");
  }
  verifyArchive(material, requested) {
    const p = material.archivePagination;
    if (!p) {
      if (material.segments?.length) throw Error("INVALID_READER_WINDOW");
      return;
    }
    const invalid = () => {
      throw Error("INVALID_READER_WINDOW");
    };
    let start, next;
    try {
      start = validateArchiveWindow(p.start);
      next = p.next === null ? null : validateArchiveWindow(p.next);
    } catch {
      invalid();
    }
    if (
      !start ||
      JSON.stringify(start) !== JSON.stringify(requested) ||
      !Number.isSafeInteger(p.entries) ||
      p.entries <= requested.entry ||
      p.entries > 1000 ||
      typeof p.archivePath !== "string" ||
      (next &&
        (next.entry >= p.entries ||
          next.offset < start.offset ||
          next.expanded < start.expanded ||
          !(
            (next.entry === start.entry &&
              next.page > start.page &&
              next.base === start.base &&
              next.expanded === start.expanded) ||
            (next.entry === start.entry + 1 &&
              next.page === 1 &&
              next.base === next.offset)
          ))) ||
      (!next && start.entry !== p.entries - 1) ||
      (material.covered || []).some(
        (r) => r.archivePath !== p.archivePath || r.start < start.offset,
      )
    )
      invalid();
    if (p.pdf) {
      const relative = start.offset - start.base;
      this.verify(
        {
          pagination: p.pdf,
          segments: material.segments,
          covered: material.covered.map((r) => ({
            ...r,
            start: r.start - start.base,
            end: r.end - start.base,
          })),
        },
        { page: start.page, offset: relative },
      );
      const more = p.pdf.nextPage > start.page;
      if (
        more !== (next?.entry === start.entry) ||
        (more && next.page !== p.pdf.nextPage) ||
        (next && next.offset !== start.base + p.pdf.nextOffset)
      )
        invalid();
    } else if (next?.entry === start.entry) invalid();
    const ranges = [
      ...(material.covered || []),
      ...(material.uncovered || []).filter(
        (r) => r.archivePath === p.archivePath,
      ),
    ];
    const end = Math.max(
      start.offset,
      ...ranges.map((r) => (Number.isSafeInteger(r.end) ? r.end : 0)),
    );
    if (next && next.offset !== end) invalid();
  }
  merge(previous, material) {
    const next = coverageOnly(material);
    if (!previous) return next;
    if (previous.contentHash !== next.contentHash) throw Error("INPUT_CHANGED");
    const uncovered = [
      ...previous.uncovered.filter(
        (r) =>
          !["PDF_WINDOW_PENDING", "ARCHIVE_WINDOW_PENDING"].includes(r.code),
      ),
      ...next.uncovered,
    ];
    const covered = [...previous.covered, ...next.covered];
    return {
      ...next,
      ...(previous.archivePdfPages || next.archivePdfPages
        ? {
            archivePdfPages: [
              ...new Map(
                [
                  ...(previous.archivePdfPages || []),
                  ...(next.archivePdfPages || []),
                ].map((p) => [p.archivePath, p]),
              ).values(),
            ],
          }
        : {}),
      covered,
      uncovered,
      reasons: [
        ...new Set([
          ...previous.reasons.filter(
            (c) =>
              !["PDF_WINDOW_PENDING", "ARCHIVE_WINDOW_PENDING"].includes(c),
          ),
          ...next.reasons,
        ]),
      ],
      state: uncovered.length
        ? covered.length
          ? "partial"
          : [...previous.reasons, ...next.reasons].some((c) =>
                /UNSUPPORTED/.test(c),
              )
            ? "unsupported"
            : "failed"
        : next.state,
    };
  }
  coverage(task, materials) {
    const map = new Map(
      this.rows(task).map((r) => [r.attachment, JSON.parse(r.coverage)]),
    );
    for (const material of materials)
      map.set(
        material.attachmentId,
        this.merge(map.get(material.attachmentId), material),
      );
    return [...map.values()];
  }
  advance(task, materials) {
    const previous = new Map(
      this.rows(task).map((r) => [r.attachment, JSON.parse(r.coverage)]),
    );
    const save = this.db.prepare(
      "INSERT OR REPLACE INTO reading_windows VALUES(?,?,?,?,?,?)",
    );
    for (const material of materials) {
      const p = material.pagination;
      const next = material.archivePagination
        ? material.archivePagination.next
          ? 1
          : 0
        : p?.nextPage && p.nextPage > p.startPage
          ? p.nextPage
          : 0;
      const coverage = this.merge(
        previous.get(material.attachmentId),
        material,
      );
      save.run(
        task,
        material.attachmentId,
        material.contentHash,
        next,
        p?.nextOffset || 0,
        JSON.stringify(coverage),
      );
    }
    return this.rows(task).some((r) => r.next_page > 0);
  }
  purge(task) {
    this.db.prepare("DELETE FROM reading_windows WHERE task=?").run(task);
  }
  pending(task, files, options) {
    return files.some((f) => !this.select(task, f, options).skip);
  }
}
