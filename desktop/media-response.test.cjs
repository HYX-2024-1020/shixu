const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { mediaResponse } = require("./media-response.cjs");
test("media byte ranges preserve requested bytes, suffixes, HEAD and invalid seeks", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "shixu-media-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "sound.mp3"), bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  writeFileSync(file, bytes);
  const request = (range, method = "GET") => new Request("https://synthetic/sound.mp3", { method, headers: range ? { Range: range } : {} });
  for (const [range, start, end] of [["bytes=100-199", 100, 199], ["bytes=900-", 900, 999], ["bytes=-50", 950, 999], ["bytes=950-2000", 950, 999]]) {
    const response = mediaResponse(file, request(range));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/1000`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
  }
  for (const range of ["bytes=1000-", "bytes=90-20", "bytes=-0", "bytes=1-2,4-5"]) assert.equal(mediaResponse(file, request(range)).status, 416);
  const head = mediaResponse(file, request(null, "HEAD"));
  assert.equal(head.headers.get("content-length"), "1000");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.deepEqual(Buffer.from(await mediaResponse(file, request()).arrayBuffer()), bytes);
});
