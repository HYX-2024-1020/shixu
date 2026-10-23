const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { promisify } = require("node:util");
const run = promisify(require("node:child_process").execFile);
const { zipSync, strToU8 } = require("fflate");
const { readArchive, safeEntry } = require("./archive.cjs");
test("ZIP: reads text and reports nested archives and path traversal", async () => {
  const data = zipSync({
    "作业/要求.txt": strToU8("明天提交报告"),
    "nested.zip": strToU8("placeholder"),
    "../escape.txt": strToU8("blocked"),
  });
  const result = await readArchive(data, "zip");
  assert.equal(
    new TextDecoder().decode(
      result.find((e) => e.name === "作业/要求.txt").bytes,
    ),
    "明天提交报告",
  );
  assert.match(result.find((e) => e.name === "nested.zip").error, /嵌套/);
  assert.match(result.find((e) => e.name === "../escape.txt").error, /越界/);
  assert.equal(safeEntry("C:\\file.txt"), false);
});
test("7z: reads original bytes and rejects encrypted headers", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "shixu-archive-test-"),
  );
  await fs.writeFile(path.join(folder, "note.txt"), "source");
  const binary = require("7zip-bin-full").path7z;
  await run(binary, ["a", "-t7z", "plain.7z", "note.txt"], {
    cwd: folder,
    windowsHide: true,
  });
  const results = await readArchive(
    await fs.readFile(path.join(folder, "plain.7z")),
    "7z",
  );
  assert.equal(new TextDecoder().decode(results[0].bytes), "source");
  await run(
    binary,
    ["a", "-t7z", "-psecret", "-mhe=on", "encrypted.7z", "note.txt"],
    { cwd: folder, windowsHide: true },
  );
  await assert.rejects(
    readArchive(await fs.readFile(path.join(folder, "encrypted.7z")), "7z"),
    /加密|读取失败/,
  );
});
test("RAR: real libarchive fixture yields expected text", async () => {
  const encoded = await fs.readFile(
      path.join(__dirname, "fixtures/libarchive-rar.uu"),
      "utf8",
    ),
    output = [];
  for (const line of encoded.split(/\r?\n/).slice(1)) {
    if (line === "end") break;
    const length = (line.charCodeAt(0) - 32) & 63,
      chunk = [];
    for (let i = 1; i < line.length; i += 4) {
      const a = (line.charCodeAt(i) - 32) & 63,
        b = (line.charCodeAt(i + 1) - 32) & 63,
        c = (line.charCodeAt(i + 2) - 32) & 63,
        d = (line.charCodeAt(i + 3) - 32) & 63;
      chunk.push(
        (a << 2) | (b >> 4),
        ((b & 15) << 4) | (c >> 2),
        ((c & 3) << 6) | d,
      );
    }
    output.push(...chunk.slice(0, length));
  }
  const results = await readArchive(Uint8Array.from(output), "rar");
  const text = results.find((e) => e.name === "test.txt");
  assert.ok(text?.bytes);
  assert.match(new TextDecoder().decode(text.bytes), /test text document/);
});
