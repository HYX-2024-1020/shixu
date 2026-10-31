import { solidText } from "./solid-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNativeListing,
  validateSolidCompression,
} from "./native-archive.mjs";
import { sevenZipBytes } from "./native-archive-fixtures.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
const raw = (s) =>
  "SHIXU_U32:" +
  Array.from(s, (c) =>
    c.codePointAt(0).toString(16).toUpperCase().padStart(8, "0"),
  ).join("");
const listing = (entries, { blocks = 2, physical = 1050, headers = 40 } = {}) =>
  "preamble\n--\nType = 7z\nPhysical Size = " +
  physical +
  "\nHeaders Size = " +
  headers +
  "\nSolid = +\nBlocks = " +
  blocks +
  "\n\n----------\n" +
  entries
    .map(
      (e, i) =>
        "Path = " +
        raw(e.name || i + ".txt") +
        "\nSize = " +
        e.size +
        "\nPacked Size = " +
        (e.packed ?? "") +
        "\nAttributes = A\nCRC = 12345678\nEncrypted = -\nBlock = " +
        e.block,
    )
    .join("\n\n") +
  "\n";
test("7z solid preflight checks every shared block, its sole packed-size owner and complete declared block set", () => {
  const good = [
      { size: 500, packed: 10, block: 0 },
      { size: 500, block: 0 },
      { size: 1000, packed: 1000, block: 1 },
    ],
    budget = { expanded: 7 };
  const parsed = parseNativeListing(listing(good), "7z", 1050, budget);
  assert.equal(budget.expanded, 2007);
  validateSolidCompression(parsed.compression);
  for (const mutate of [
    (v) => v.blocks[0].expandedBytes++,
    (v) => (v.blocks[0].packedBytes = 0),
    (v) => (v.blocks[1].block = 0),
    (v) => (v.ratioLimit = 101),
    (v) => (v.blocks[0].members = 1001),
  ]) {
    const value = structuredClone(parsed.compression);
    mutate(value);
    assert.throws(
      () => validateSolidCompression(value),
      /INVALID_READER_WINDOW/,
    );
  }

  const nearLimit = { expanded: 64 * 1024 * 1024 - 2000 };
  parseNativeListing(listing(good), "7z", 1050, nearLimit);
  assert.equal(nearLimit.expanded, 64 * 1024 * 1024);
  const overLimit = { expanded: 64 * 1024 * 1024 - 1999 };
  assert.throws(
    () => parseNativeListing(listing(good), "7z", 1050, overLimit),
    /PACKAGE_LIMIT/,
  );
  assert.equal(overLimit.expanded, 64 * 1024 * 1024 - 1999);
  assert.throws(
    () =>
      parseNativeListing(
        listing(good).replace("Solid = +", "Warning Flags = 1\nSolid = +"),
        "7z",
        1050,
        { expanded: 0 },
      ),
    /PACKAGE_UNSUPPORTED/,
  );
  assert.equal(parsed.get("0.txt").compressed, null);
  assert.deepEqual(parsed.compression.blocks, [
    { block: 0, packedBytes: 10, expandedBytes: 1000, members: 2 },
    { block: 1, packedBytes: 1000, expandedBytes: 1000, members: 1 },
  ]);
  for (const [entries, options, error] of [
    [[good[0], { ...good[1], size: 501 }, good[2]], {}, "PACKAGE_LIMIT"],
    [
      [good[0], { ...good[1], packed: 10 }, good[2]],
      { physical: 1060 },
      "PACKAGE_UNSUPPORTED",
    ],
    [
      [{ ...good[0], packed: null }, good[1], good[2]],
      {},
      "PACKAGE_UNSUPPORTED",
    ],
    [[good[0], good[1], { ...good[2], block: 2 }], {}, "PACKAGE_UNSUPPORTED"],
    [good, { blocks: 3 }, "PACKAGE_UNSUPPORTED"],
    [good, { headers: 41 }, "PACKAGE_UNSUPPORTED"],
    [[good[0], { ...good[1], block: "" }, good[2]], {}, "PACKAGE_UNSUPPORTED"],
  ]) {
    const b = { expanded: 7 };
    assert.throws(
      () =>
        parseNativeListing(
          listing(entries, options),
          "7z",
          options.physical || 1050,
          b,
        ),
      new RegExp(error),
    );
    assert.equal(b.expanded, 7);
  }
});

test("real 7z solid and multiple solid blocks preserve all text, Unicode names/order/tail and charge shared expansion once per window", async () => {
  for (const options of [["-ms=on"], ["-ms=2f"]]) {
    const random = solidText(),
      entries = {
        "01😀.txt": random,
        "02.txt": random,
        "03.txt": random,
        "04.txt": Buffer.from("尾部唯一标记"),
      },
      body = await sevenZipBytes(entries, ["-mx=1", ...options]);
    let cursor = FIRST_ARCHIVE_WINDOW,
      actual = [],
      metadata;
    while (cursor) {
      const m = await readMaterial(
        {
          id: "solid",
          name: "合成.7z",
          body,
          size: body.length,
          hash: sha256(body),
        },
        { archiveWindow: cursor },
      );
      assert.notEqual(m.state, "failed", JSON.stringify(m));
      assert.equal(m.archiveCompression.solid, true);
      if (metadata) assert.deepEqual(m.archiveCompression, metadata);
      metadata = m.archiveCompression;
      actual.push(...m.segments.map((s) => s.text));
      assert.equal(m.archivePagination.next?.expanded ?? 0, 0);
      cursor = m.archivePagination.next;
    }
    assert.equal(
      actual.join(""),
      Buffer.concat(Object.values(entries)).toString("utf8"),
    );
    assert.equal(
      metadata.expandedBytes,
      random.length * 3 + Buffer.byteLength("尾部唯一标记"),
    );
    assert.equal(metadata.blocks.length, options[0] === "-ms=on" ? 1 : 2);
  }
});

import { officeImageBytes } from "./office-fixtures.mjs";
import { decodePng } from "./image.mjs";
import { openPackage } from "./ooxml-zip.mjs";
test("solid Office tiles count the shared outer block once and each inner package once across repeated windows", async () => {
  const sample = officeImageBytes("xlsx"),
    entries = {
      "01.txt": solidText(),
      "02.xlsx": sample.body,
      "03.txt": Buffer.from("尾部唯一标记"),
    },
    body = await sevenZipBytes(entries, ["-mx=1", "-ms=on"]);
  let cursor = {
      ...FIRST_ARCHIVE_WINDOW,
      office: 1,
      image: 0,
      text: 1,
      tile: 1,
    },
    count = 0,
    tail = false,
    lastExpanded;
  const pixels = Buffer.alloc(sample.pixels.length);
  while (cursor) {
    const m = await readMaterial(
      {
        id: "solid",
        name: "solid.7z",
        body,
        size: body.length,
        hash: sha256(body),
      },
      { archiveWindow: cursor },
    );
    assert.notEqual(m.state, "failed", JSON.stringify(m));
    assert.equal(
      m.archiveCompression.expandedBytes,
      Object.values(entries).reduce((n, b) => n + b.length, 0),
    );
    for (const s of m.segments) {
      if (s.image) {
        count++;
        assert.equal(s.range.cell, "B3");
        decodePng(Buffer.from(s.image.data, "base64")).pixels.copy(
          pixels,
          s.range.x * 4,
        );
      } else tail ||= s.text === "尾部唯一标记";
    }
    lastExpanded = cursor.expanded;
    cursor = m.archivePagination.next;
  }
  assert.equal(count, 3);
  assert.equal(tail, true);
  assert.deepEqual(pixels, sample.pixels);
  const pkg = openPackage(sample.body);
  assert.equal(
    lastExpanded,
    pkg.names.reduce((n, name) => n + pkg.size(name), 0),
  );
});
