import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runArchiveWindowsClients } from "../../scripts/reading-archive-windows-clients.mjs";
import { openNativeArchive } from "./native-archive.mjs";
import {
  rar4FirstCompressedFixture,
  rar4Bytes,
} from "./native-archive-fixtures.mjs";
import { readMaterial, sha256 } from "./material.mjs";
const read = (body) =>
  readMaterial({
    id: "rar4",
    name: "合成RAR4.rar",
    body,
    size: body.length,
    hash: sha256(body),
  });
test("RAR4 ASCII, explicit UTF8 and encoded UTF16 names preserve original paths, all text/order/source and tail", async () => {
  for (const unicode of [false, true, "encoded"]) {
    const entries = unicode
      ? { "目录/中文😀.txt": "首件😀\r\n", "@尾件.txt": "尾部唯一标记" }
      : { "dir/a.txt": "first\r\n", "tail.txt": "tail" };
    const m = await read(rar4Bytes(entries, { unicode }));
    assert.equal(m.state, "read", JSON.stringify(m.reasons));
    assert.equal(
      m.segments.map((s) => s.text).join(""),
      Object.values(entries).join("").replace(/\r\n?/g, "\n"),
    );
    assert.deepEqual(
      m.covered.map((r) => r.archivePath),
      Object.keys(entries),
    );
  }
});

test("RAR4 compressed payload matches an independent official-tool golden for every byte", async () => {
  const encoded = await readFile(
    new URL("./fixtures/rar4-compressed.uu", import.meta.url),
    "utf8",
  );
  assert.equal(
    sha256(encoded),
    "1c36a76e84bf08d1fdf7597b43737fa174a0813bf2715bf181fd3afb6f6f1f11",
  );
  const f = rar4FirstCompressedFixture(encoded);
  assert.equal(
    sha256(f.body),
    "53e52fd5312e1da1194240bbfd15d6eab5493697ef1e03b50cfb218195487ee2",
  );
  const pkg = await openNativeArchive(f.body, {
    budget: { expanded: 0 },
    extension: "rar",
  });
  try {
    assert.deepEqual(pkg.names, ["LibarchiveAddingTest.html"]);
    const content = await pkg.read(f.name);
    assert.equal(content.length, 20111);
    assert.equal(
      sha256(content),
      "ee16390e87152d7dec632ae2b37566da6135966e46b5166e6f40a1c827fa61ad",
    );
  } finally {
    await pkg.close();
  }
});
test("RAR4 compact Unicode modes preserve code units and refuse incomplete/run-overflow/NUL aliases", async () => {
  const encoded = (prefix, data) =>
    Buffer.concat([Buffer.from(prefix), Buffer.from([0, ...data])]);
  const cases = [
    [encoded("abc.txt", [0, 0, 97, 98, 99, 46, 0, 116, 120, 116]), "abc.txt"],
    [
      encoded("abc.txt", [0, 0x55, 97, 98, 99, 46, 0x54, 116, 120, 116]),
      "abc.txt",
    ],
    [encoded("unused", [0x4e, 0x40, 0x2d, 46, 116, 120, 0, 116]), "中.txt"],
    [encoded("abc.txt", [0, 0xc0, 5]), "abc.txt"],
    [encoded("ABC", [0, 0xc0, 0x81, 32, 46, 116, 120, 0, 116]), "abc.txt"],
  ];
  for (const [name, expected] of cases) {
    const m = await read(rar4Bytes([[name, "ok"]], { unicode: true }));
    assert.equal(m.state, "read", expected + JSON.stringify(m.reasons));
    assert.equal(m.covered[0].archivePath, expected);
  }
  const bad = [
    encoded("x", [0, 0xc0, 1]),
    encoded("x", [0, 0x80, 97]),
    encoded("x", [0, 0]),
    encoded("x", [0, 0, 0]),
  ];
  for (const name of bad) {
    const m = await read(
      rar4Bytes(
        [
          ["safe.txt", "never"],
          [name, "unsafe"],
        ],
        { unicode: true },
      ),
    );
    assert.equal(m.segments.length, 0);
    assert.ok(["unsupported", "failed"].includes(m.state));
  }
});
test("RAR4 ambiguous legacy names, unsafe paths, duplicates and unverified header features reject before any prefix", async () => {
  const bodies = [];
  for (const unicode of [false, true, "encoded"])
    for (const name of [
      "a\nb.txt",
      "../a.txt",
      "a\\b.txt",
      "C:/a.txt",
      "a//b.txt",
    ])
      bodies.push(
        rar4Bytes(
          [
            ["safe.txt", "never"],
            [name, "unsafe"],
          ],
          { unicode },
        ),
      );
  bodies.push(
    rar4Bytes({ "中文.txt": "ambiguous locale" }),
    rar4Bytes([
      ["same.txt", "one"],
      ["same.txt", "two"],
    ]),
  );
  for (const flags of [1, 2, 4, 8, 16, 0x400, 0x800, 0x2000, 0x4000])
    bodies.push(rar4Bytes({ "a.txt": "never" }, { fileFlags: flags }));
  for (const archiveFlags of [1, 2, 8, 0x20, 0x40, 0x80])
    bodies.push(rar4Bytes({ "a.txt": "never" }, { archiveFlags }));
  for (const body of bodies) {
    const m = await read(body);
    assert.equal(m.segments.length, 0);
    assert.ok(["unsupported", "failed"].includes(m.state));
  }
});

test("RAR4 literal includes distinguish case aliases and wildcard-looking names without concatenating other members", async () => {
  const entries = {
    "A.txt": "alpha",
    "a.txt": "lower",
    "a?.txt": "question",
    "a*.txt": "star",
    "-switch.txt": "tail",
  };
  const m = await read(rar4Bytes(entries, { unicode: "encoded" }));
  assert.equal(m.state, "read");
  assert.equal(
    m.segments.map((s) => s.text).join(""),
    "alphalowerquestionstartail",
  );
  assert.deepEqual(
    m.covered.map((r) => r.archivePath),
    Object.keys(entries),
  );
});

test(
  "RAR4 mixed PDF windows cross client adapters, revalidate originals and reuse paid blocks",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-rar4-clients-"));
    try {
      await runArchiveWindowsClients({
        directory,
        format: "rar4",
        reader: Object.assign((f, o) => readMaterial(f, o), {
          pdfWindows: true,
          archiveWindows: true,
        }),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("RAR4 volume-label records cannot silently disappear from full preflight", async () => {
  const body = rar4Bytes({ "label.txt": "must not disappear" }),
    start = 20,
    end = start + body.readUInt16LE(start + 5);
  body[start + 15] = 0;
  body.writeUInt32LE(8, start + 28);
  const { crc32 } = await import("node:zlib");
  body.writeUInt16LE(crc32(body.subarray(start + 2, end)) & 65535, start);
  const m = await read(body);
  assert.equal(m.segments.length, 0);
  assert.equal(m.state, "unsupported");
});

test("RAR4 raw header walk rejects ignored services, bad CRC/terminal data and entry/expansion limits", async () => {
  const { crc32 } = await import("node:zlib"),
    base = rar4Bytes({ "safe.txt": "never" }),
    unknown = Buffer.alloc(7);
  unknown[2] = 0x7a;
  unknown.writeUInt16LE(7, 5);
  unknown.writeUInt16LE(crc32(unknown.subarray(2)) & 65535);
  const bad = [
    base.subarray(0, -7),
    Buffer.concat([base, Buffer.from("tail")]),
    Buffer.concat([base.subarray(0, -7), unknown, base.subarray(-7)]),
  ];
  const badCrc = Buffer.from(base);
  badCrc[22] ^= 1;
  bad.push(badCrc);
  const huge = Buffer.from(base);
  huge.writeUInt32LE(65 * 1024 * 1024, 31);
  huge.writeUInt16LE(
    crc32(huge.subarray(22, 20 + huge.readUInt16LE(25))) & 65535,
    20,
  );
  bad.push(huge);
  bad.push(
    rar4Bytes(
      Object.fromEntries(
        Array.from({ length: 1001 }, (_, i) => [i + ".txt", "x"]),
      ),
    ),
  );
  for (const body of bad) {
    const m = await read(body);
    assert.equal(m.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(m.state));
  }
});
