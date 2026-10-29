import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMaterial, sha256, coverageOnly } from "./material.mjs";
import { encodePng, decodePng } from "./image.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import {
  rarBytes,
  rar4Bytes,
  sevenZipBytes,
} from "./native-archive-fixtures.mjs";
import { ReadingWindows } from "./windows.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { runImageClients } from "../../scripts/reading-image-clients.mjs";

const reader = Object.assign((f, o) => readMaterial(f, o), {
  pdfWindows: true,
  imageWindows: true,
  archiveWindows: true,
});
for (const format of ["zip", "rar4", "rar", "7z"])
  test(`${format} PNG tiles preserve complete pixels, paths, order and cumulative expansion across members`, async () => {
    const width = 2051,
      height = 3,
      pixels = Buffer.alloc(width * height * 4, 255);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = i % 251;
      pixels[i + 1] = (i >> 8) % 256;
    }
    const png = encodePng(width, height, pixels),
      entries = {
        "01.txt": Buffer.from("前言"),
        "02.png": png,
        "03.png": encodePng(1, 1, Buffer.from([3, 7, 11, 255])),
        "04.txt": Buffer.from("尾部唯一标记"),
      };
    const body =
      format === "zip"
        ? zipBytes(entries)
        : format === "rar4"
          ? rar4Bytes(entries)
          : format === "rar"
            ? rarBytes(entries)
            : await sevenZipBytes(entries);
    const file = {
      id: "archive",
      name: "合成." + (format === "rar4" ? "rar" : format),
      body,
      size: body.length,
      hash: sha256(body),
    };
    let cursor = FIRST_ARCHIVE_WINDOW,
      all = [],
      windows = 0,
      expanded,
      coverage;
    const verifier = Object.create(ReadingWindows.prototype),
      reconstructed = Buffer.alloc(pixels.length);
    while (cursor) {
      const m = await reader(file, { archiveWindow: cursor });
      verifier.verify(m, undefined, cursor);
      all.push(...m.segments);
      windows++;
      coverage = verifier.merge(coverage, m);
      if (cursor.entry === 1) {
        const s = m.segments[0],
          r = s.range,
          decoded = decodePng(Buffer.from(s.image.data, "base64"));
        assert.equal(r.archivePath, "02.png");
        assert.equal(r.start, 2 + r.tile - 1);
        for (let y = 0; y < r.height; y++)
          decoded.pixels.copy(
            reconstructed,
            ((r.y + y) * width + r.x) * 4,
            y * r.width * 4,
            (y + 1) * r.width * 4,
          );
        assert.ok(!JSON.stringify(coverageOnly(m)).includes(s.image.data));
        assert.equal(m.archivePagination.next?.expanded ?? expanded, expanded);
        for (const mutate of [
          (p) => ({ ...p, image: { ...p.image, startTile: 9 } }),
          (p) => ({ ...p, image: { ...p.image, totalTiles: 2 } }),
          (p) => ({ ...p, pdf: {} }),
        ])
          assert.throws(
            () =>
              verifier.verify(
                { ...m, archivePagination: mutate(m.archivePagination) },
                undefined,
                cursor,
              ),
            /INVALID_READER_WINDOW/,
          );
        const bad = structuredClone(m);
        bad.covered[0].x++;
        assert.throws(
          () => verifier.verify(bad, undefined, cursor),
          /INVALID_READER_WINDOW/,
        );
      }
      expanded = m.archivePagination.next?.expanded ?? expanded;
      cursor = m.archivePagination.next;
    }
    assert.equal(windows, 6);
    assert.deepEqual(coverage.archiveImageTiles, [
      { archivePath: "02.png", checked: 3, total: 3 },
      { archivePath: "03.png", checked: 1, total: 1 },
    ]);
    assert.deepEqual(reconstructed, pixels);
    assert.deepEqual(
      all.map((s) => s.range.archivePath),
      ["01.txt", "02.png", "02.png", "02.png", "03.png", "04.txt"],
    );
    assert.equal(all.at(-1).text, "尾部唯一标记");
    assert.equal(new Set(all.map((s) => s.sourceId)).size, 6);
  });
for (const deleted of [false, true])
  test(
    `archive image stop/revalidation/revision crosses both clients (${deleted ? "deleted" : "temporary"})`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "shixu-archive-images-"));
      try {
        await runImageClients({
          directory,
          deleted,
          reader,
          archiveFormat: deleted ? "rar4" : "zip",
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
