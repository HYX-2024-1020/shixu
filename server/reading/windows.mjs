import { coverageOnly } from "./material.mjs";
import { PDF_WINDOW_PAGES } from "./pdf-window.mjs";

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
  select(task, file) {
    const row = this.db
      .prepare("SELECT * FROM reading_windows WHERE task=? AND attachment=?")
      .get(task, file.id);
    if (row && row.content_hash !== file.hash) throw Error("INPUT_CHANGED");
    if (row?.next_page === 0) return { skip: true };
    return {
      skip: false,
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
  verify(material, requested) {
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
  merge(previous, material) {
    const next = coverageOnly(material);
    if (!previous) return next;
    if (previous.contentHash !== next.contentHash) throw Error("INPUT_CHANGED");
    const uncovered = [
      ...previous.uncovered.filter((r) => r.code !== "PDF_WINDOW_PENDING"),
      ...next.uncovered,
    ];
    const covered = [...previous.covered, ...next.covered];
    return {
      ...next,
      covered,
      uncovered,
      reasons: [
        ...new Set([
          ...previous.reasons.filter((c) => c !== "PDF_WINDOW_PENDING"),
          ...next.reasons,
        ]),
      ],
      state: covered.length && uncovered.length ? "partial" : next.state,
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
      const next = p?.nextPage && p.nextPage > p.startPage ? p.nextPage : 0;
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
  pending(task, files) {
    return files.some((f) => !this.select(task, f).skip);
  }
}
