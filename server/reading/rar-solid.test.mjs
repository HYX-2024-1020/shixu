import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { rarBytes } from "./native-archive-fixtures.mjs";
import { rarSolidSample, rarSolidMultiBlockSample } from "./rar-solid-fixtures.mjs";
import { openNativeArchive, parseNativeListing, validateSolidCompression } from "./native-archive.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";

for (const version of [4, 5]) {
  test(`RAR${version} genuine shared dictionary: exact full text, tail-only extraction and resume coverage`, async () => {
    const { body, expectedText, packed } = await rarSolidSample(version);
    const budget = { expanded: 7 };
    const pkg = await openNativeArchive(body, { budget, extension: "rar" });
    try {
      assert.equal(budget.expanded, 61);
      assert.equal((await pkg.read("file9.txt")).toString(), "file9\n");
      assert.deepEqual(pkg.compression, {
        solid: true, ratioLimit: 100, expandedBytes: 54, packedBytes: packed,
        blocks: [{ block: 0, packedBytes: packed, expandedBytes: 54, members: 9 }],
      });
      validateSolidCompression(pkg.compression);
    } finally { await pkg.close(); }
    const file = { id: "solid", name: "solid.rar", body, size: body.length, hash: sha256(body) };
    const all = await readMaterial(file);
    assert.equal(all.state, "read", JSON.stringify(all.reasons));
    assert.equal(all.segments.map(s => s.text).join(""), expectedText);
    assert.deepEqual(all.covered.map(r => r.archivePath), Array.from({ length: 9 }, (_, i) => `file${i + 1}.txt`));
    const resumed = await readMaterial(file, { archiveWindow: { ...FIRST_ARCHIVE_WINDOW, entry: 8, offset: 48, base: 48 } });
    assert.equal(resumed.state, "read", JSON.stringify(resumed.reasons));
    assert.equal(resumed.segments.map(s => s.text).join(""), "file9\n");
    assert.deepEqual(resumed.archiveCompression, all.archiveCompression);
    assert.equal(resumed.archivePagination.next, null);
  });
}

for (const version of [4,5]) test(`RAR${version} tail extraction depends on earlier dictionary bytes, and damaged predecessors cannot produce accepted tail data`, async () => {
  const { body } = await rarSolidSample(version);
  // First member retains its header/CRC/size but loses its compressed stream.
  const broken = Buffer.from(body);
  const file = version === 4 ? 20 : 8 + 5 + broken[12];
  const start = file + (version === 4 ? broken.readUInt16LE(file + 5) : 5 + broken[file + 4]);
  let packed = version === 4 ? broken.readUInt32LE(file + 7) : 0;
  if (version === 5) {
    // The upstream sample uses a valid overlong two-byte data-size vint.
    for (let p=file+7, scale=1; ; p++, scale*=128) {
      packed += (broken[p]&127)*scale;
      if (!(broken[p]&128)) break;
    }
  }
  broken.fill(0, start, start + packed);
  const pkg = await openNativeArchive(broken, { budget: { expanded: 0 }, extension: "rar" });
  try { await assert.rejects(pkg.read("file9.txt"), /ARCHIVE_ENTRY_FAILED|PACKAGE_UNSUPPORTED/); }
  finally { await pkg.close(); }
});

test("RAR4/RAR5 two genuine dictionary chains preserve both blocks and select the last member without concatenation", async () => {
  for (const version of [4,5]) {
    const {body,packed,expectedText} = await rarSolidMultiBlockSample(version);
    const pkg = await openNativeArchive(body,{budget:{expanded:0},extension:"rar"});
    try {
      assert.equal(pkg.compression.blocks.length,2);
      assert.equal(pkg.compression.packedBytes,packed);
      assert.deepEqual(pkg.compression.blocks.map(b=>b.members),[9,9]);
      assert.equal((await pkg.read("copy9.txt")).toString(),"file9\n");
    } finally {await pkg.close();}
    const all = await readMaterial({id:"multi",name:"multi.rar",body,size:body.length,hash:sha256(body)});
    assert.equal(all.state,"read",JSON.stringify(all.reasons));
    assert.equal(all.segments.map(s=>s.text).join(""),expectedText);
  }
});

const raw = s => "SHIXU_U32:" + [...s].map(c => c.codePointAt(0).toString(16).toUpperCase().padStart(8, "0")).join("");
const listing = (format, entries, { blocks = 1, solid = "+" } = {}) =>
  `preamble\n--\nType = ${format}\nPhysical Size = 2000\nSolid = ${solid}\nBlocks = ${blocks}\nEncrypted = -\nMultivolume = -\nVolumes = 1\n\n----------\n` + entries.map((e, i) =>
    `Path = ${raw(i + ".txt")}\nFolder = -\nSize = ${e.size}\nPacked Size = ${e.packed ?? ""}\nEncrypted = -\nSolid = ${e.solid}\nVersion = ${format === "Rar" ? "29" : ""}\nCRC = 12345678\n${e.extra || ""}`
  ).join("\n\n") + "\n";
for (const format of ["Rar", "Rar5"]) test(`${format} preflight validates complete contiguous blocks before changing budget`, () => {
  const good = [{size:500, packed:10, solid:"-"}, {size:500, packed:0, solid:"+"}];
  const parsed = parseNativeListing(listing(format, good), format, 2000, { expanded: 0 });
  assert.equal(parsed.get("1.txt").compressed, 0);
  assert.equal(parsed.compression.packedBytes, 10);
  validateSolidCompression(parsed.compression);
  for (const [entries, options, code] of [
    [[{...good[0], solid:"+"}, good[1]], {}, "PACKAGE_UNSUPPORTED"],
    [good, {blocks:2}, "PACKAGE_UNSUPPORTED"],
    [good, {solid:"-"}, "PACKAGE_UNSUPPORTED"],
    [[good[0], {...good[1], packed:null}], {}, "PACKAGE_UNSUPPORTED"],
    [[good[0], {...good[1], size:501}], {}, "PACKAGE_LIMIT"],
    // Large second block cannot subsidize a bomb in the first block.
    [[{size:1001, packed:10, solid:"-"}, {size:10, packed:1000, solid:"-"}], {blocks:2}, "PACKAGE_LIMIT"],
    [[good[0], {...good[1], extra:"Split Before = +\n"}], {}, "PACKAGE_UNSUPPORTED"],
    [[good[0], {...good[1], extra:"Block = 0\n"}], {}, "PACKAGE_UNSUPPORTED"],
  ]) {
    const budget = { expanded: 17 };
    assert.throws(() => parseNativeListing(listing(format, entries, options), format, 2000, budget), new RegExp(code));
    assert.equal(budget.expanded, 17);
  }
  const zero = parseNativeListing(listing(format, [{size:0, packed:0, solid:"-"}]), format, 2000, {expanded:0});
  validateSolidCompression(zero.compression);
});

test("RAR5 opaque preflight rejects hidden services, unknown/split headers, missing terminators and bad CRC before any readable prefix", async () => {
  const original = rarBytes({"one.txt":"one", "two.txt":"two"});
  // This tiny authored fixture has one-byte header-size/type/flags fields.
  const first = 8 + 5 + original[12];
  const second = first + 5 + original[first + 4] + 3;
  const mutate = (start, fn) => {
    const b = Buffer.from(original), end = start + 5 + b[start + 4];
    fn(b, start);
    b.writeUInt32LE(crc32(b.subarray(start + 4, end)), start);
    return b;
  };
  const bodies = [
    mutate(second, (b, s) => b[s + 5] = 3), // hidden service
    mutate(second, (b, s) => b[s + 5] = 4), // encryption record
    mutate(second, (b, s) => b[s + 6] |= 8), // split from previous volume
    mutate(second, (b, s) => b[s + 8] |= 8), // unknown unpacked size
    mutate(8, (b, s) => b[s + 7] |= 1), // volume archive
    original.subarray(0, original.length - 8),
    Buffer.concat([original, Buffer.from([0])]),
    Buffer.concat([original.subarray(0, first), original.subarray(8, first), original.subarray(first)]),
  ];
  const badCrc = Buffer.from(original); badCrc[second] ^= 1; bodies.push(badCrc);
  for (const body of bodies) {
    const m = await readMaterial({id:"attack", name:"attack.rar", body, size:body.length, hash:sha256(body)});
    assert.equal(m.segments.length, 0);
    assert.ok(["PACKAGE_INVALID", "PACKAGE_UNSUPPORTED"].includes(m.reasons[0]), JSON.stringify(m.reasons));
  }
});
