// Original junrar fixtures, not generated or relabelled non-solid streams.
// Pinned provenance and upstream license: THIRD_PARTY_NOTICES.md.
import { readFile } from "node:fs/promises";
import { decodeUuFixture } from "./native-archive-fixtures.mjs";
import { sha256 } from "./material.mjs";
import { crc32 } from "node:zlib";
export async function rarSolidSample(version) {
  const expectedHash = {
    4: "afce8cdb5fd80f8c74225f9141976a86ecf7bc7421e8c9d186eae698a21c3f02",
    5: "804caecaf59adf3ea7f2cd8b3f2bdfb92e5658598b730cc1cfc9b5d38ce3ff44",
  }[version];
  if (!expectedHash) throw Error("FIXTURE_VERSION");
  const encoded = await readFile(new URL(`./fixtures/rar${version}-solid.uu`, import.meta.url), "utf8");
  if (sha256(encoded) !== expectedHash) throw Error("FIXTURE_HASH");
  return {
    body: decodeUuFixture(encoded),
    expectedText: Array.from({ length: 9 }, (_, i) => `file${i + 1}\n`).join(""),
    packed: version === 4 ? 50 : 67,
  };
}

// Preserve both genuine compressed chains, rename only the second chain's
// fixed-width metadata and recompute header CRCs. Each first member already
// resets its dictionary; no fabricated compression or solid-bit mutation.
export async function rarSolidMultiBlockSample(version) {
  const sample = await rarSolidSample(version), original = sample.body;
  const records = [];
  let position = version === 4 ? 20 : 8, terminal;
  while (position < original.length) {
    const start = position;
    let end, type, data;
    if (version === 4) {
      type = original[start + 2];
      end = start + original.readUInt16LE(start + 5);
      data = type === 0x74 ? original.readUInt32LE(start + 7) : 0;
    } else {
      position += 4;
      const vint = () => { let n=0, shift=1; for (;;) { const b=original[position++]; n+=(b&127)*shift; if(!(b&128))return n; shift*=128; } };
      const length = vint(); end = position + length;
      type = vint(); const flags = vint(); if (flags & 1) vint();
      data = flags & 2 ? vint() : 0;
    }
    if (type === (version === 4 ? 0x7b : 5)) { terminal = start; break; }
    if (type === (version === 4 ? 0x74 : 2)) {
      const record = Buffer.from(original.subarray(start, end + data));
      const name = record.subarray(0, end - start).indexOf(Buffer.from("file"));
      if (name < 0) throw Error("FIXTURE_STRUCTURE");
      record.write("copy", name, "ascii");
      if (version === 4) record.writeUInt16LE(crc32(record.subarray(2, end-start)) & 65535);
      else record.writeUInt32LE(crc32(record.subarray(4, end-start)));
      records.push(record);
    }
    position = end + data;
  }
  if (records.length !== 9 || terminal === undefined) throw Error("FIXTURE_STRUCTURE");
  return {...sample, body:Buffer.concat([original.subarray(0,terminal), ...records, original.subarray(terminal)]), packed:sample.packed*2, expectedText:sample.expectedText.repeat(2)};
}
