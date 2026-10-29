import test from "node:test";
import assert from "node:assert/strict";
import { readMaterial, sha256 } from "./material.mjs";
import { archiveWindowSample, zipBytes } from "./archive-fixtures.mjs";
import { rarBytes, sevenZipBytes } from "./native-archive-fixtures.mjs";
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import { openPackage, PACKAGE_LIMITS } from "./ooxml-zip.mjs";
import {
  FIRST_ARCHIVE_WINDOW,
  validateArchiveWindow,
} from "./archive-window.mjs";
import { ReadingWindows } from "./windows.mjs";

const descriptor = (body, name = "分页.zip") => ({
  id: "archive",
  name,
  body,
  size: body.length,
  hash: sha256(body),
});
const verifier = Object.create(ReadingWindows.prototype);
for (const format of ["zip", "rar", "7z"])
  test(`${format} member/PDF windows match independent full text, order, source IDs, offsets and omissions`, async () => {
    const sample = archiveWindowSample();
    const bytes =
      format === "zip"
        ? sample.body
        : format === "rar"
          ? rarBytes(sample.entries)
          : await sevenZipBytes(sample.entries);
    const file = descriptor(bytes, "分页." + format);
    const full = await readMaterial(file);
    assert.equal(
      full.segments.map((s) => s.text).join(""),
      sample.expectedText,
    );
    const segments = [],
      uncovered = [];
    let cursor = FIRST_ARCHIVE_WINDOW,
      count = 0;
    while (cursor && count++ < 20) {
      const m = await readMaterial(file, { archiveWindow: cursor });
      verifier.verify(m, undefined, cursor);
      segments.push(...m.segments);
      uncovered.push(
        ...m.uncovered.filter((r) => !/WINDOW_PENDING/.test(r.code)),
      );
      if (cursor.entry === 1 && cursor.page === 1) {
        for (const modify of [
          (p) => ({ ...p, next: { ...p.next, page: p.next.page + 1 } }),
          (p) => ({ ...p, next: { ...p.next, entry: p.next.entry + 1 } }),
          (p) => ({ ...p, next: { ...p.next, offset: p.next.offset + 1 } }),
          (p) => ({
            ...p,
            pdf: { ...p.pdf, nextOffset: p.pdf.nextOffset + 1 },
          }),
          (p) => ({ ...p, entries: 1 }),
        ])
          assert.throws(
            () =>
              verifier.verify(
                { ...m, archivePagination: modify(m.archivePagination) },
                undefined,
                cursor,
              ),
            /INVALID_READER_WINDOW/,
          );
      }
      cursor = m.archivePagination.next;
    }
    assert.equal(cursor, null);
    assert.equal(count, 7); // Includes an unsupported image metadata window.
    assert.deepEqual(segments, full.segments);
    assert.deepEqual(uncovered, full.uncovered);
    assert.equal(
      sha256(segments.map((s) => s.text).join("")),
      sha256(sample.expectedText),
    );
    assert.equal(segments.at(-1).text, "尾部唯一标记");
  });

test("archive window protocol rejects path injection, invalid bounds and late dangerous names before any prefix is read", async () => {
  for (const value of [
    null,
    [],
    {},
    { ...FIRST_ARCHIVE_WINDOW, path: "a.pdf" },
    { ...FIRST_ARCHIVE_WINDOW, entry: 1000 },
    { ...FIRST_ARCHIVE_WINDOW, page: 0 },
    { ...FIRST_ARCHIVE_WINDOW, offset: 1 },
    { ...FIRST_ARCHIVE_WINDOW, expanded: 1 },
    { ...FIRST_ARCHIVE_WINDOW, base: 1 },
    { ...FIRST_ARCHIVE_WINDOW, expanded: 67108865 },
  ])
    assert.throws(() => validateArchiveWindow(value), /INVALID_ARCHIVE_WINDOW/);
  const empty = await readMaterial(descriptor(zipBytes({})), {
    archiveWindow: FIRST_ARCHIVE_WINDOW,
  });
  assert.deepEqual(empty.reasons, ["EMPTY_TEXT"]);
  const bad = descriptor(
    zipBytes({ "01.txt": "不能先读", "../late.txt": "危险" }),
  );
  const m = await readMaterial(bad, { archiveWindow: FIRST_ARCHIVE_WINDOW });
  assert.equal(m.segments.length, 0);
  assert.deepEqual(m.reasons, ["PACKAGE_PATH"]);
  await assert.rejects(
    () =>
      readMaterial(descriptor(zipBytes({ "a.txt": "text" })), {
        archiveWindow: { entry: 0, page: 9, offset: 0, base: 0, expanded: 0 },
      }),
    /INVALID_ARCHIVE_WINDOW/,
  );
});

test("Office expansion remains cumulative across archive windows, matching the unwindowed safety boundary", async () => {
  // A deterministic incompressible 16KiB seed repeated 48 times keeps each
  // Office media member below 100:1, while 85 copies exceed 64MiB in total.
  let state = 123456789;
  const seed = Buffer.alloc(16384);
  for (let i = 0; i < seed.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    seed[i] = state & 255;
  }
  const office = docxBytes(
    paragraph("安全正文"),
    { "word/media/image.png": Buffer.concat(Array(48).fill(seed)) },
    { level: 6 },
  );
  const expectedBudget = { expanded: 0 };
  openPackage(office, { budget: expectedBudget });
  const entries = Object.fromEntries(
    Array.from({ length: 85 }, (_, i) => [`${i}.docx`, office]),
  );
  const file = descriptor(zipBytes(entries));
  assert.ok(file.size < 10 * 1024 * 1024);
  const full = await readMaterial(file);
  let cursor = FIRST_ARCHIVE_WINDOW,
    body = "",
    count = 0,
    limited = false;
  while (cursor && count++ < 100) {
    const m = await readMaterial(file, { archiveWindow: cursor });
    verifier.verify(m, undefined, cursor);
    body += m.segments.map((s) => s.text).join("");
    limited ||= m.reasons.includes("PACKAGE_LIMIT");
    const next = m.archivePagination.next;
    if (count === 1) assert.equal(next.expanded, expectedBudget.expanded);
    if (next) assert.ok(next.expanded <= PACKAGE_LIMITS.expanded);
    cursor = next;
  }
  assert.equal(cursor, null);
  assert.equal(limited, true);
  assert.equal(body, full.segments.map((s) => s.text).join(""));
  assert.ok(full.reasons.includes("PACKAGE_LIMIT"));
});

test("a trailing empty directory cannot turn unread archive members into a fully read file", async () => {
  const file = descriptor(
    zipBytes({ "未读.jpg": Buffer.from("image"), "尾目录/": new Uint8Array() }),
  );
  let cursor = FIRST_ARCHIVE_WINDOW,
    coverage;
  while (cursor) {
    const m = await readMaterial(file, { archiveWindow: cursor });
    coverage = verifier.merge(coverage, m);
    cursor = m.archivePagination.next;
  }
  assert.equal(coverage.state, "unsupported");
  assert.deepEqual(coverage.uncovered, (await readMaterial(file)).uncovered);
});
