import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("console taskbar icon contains actual independently sized PNG frames for common DPI scales", () => {
  const bytes = readFileSync(
    new URL("../../public/console-xu-v2.ico", import.meta.url),
  );
  assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4),
    sizes = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16,
      size = bytes[at] || 256,
      length = bytes.readUInt32LE(at + 8),
      offset = bytes.readUInt32LE(at + 12),
      png = bytes.subarray(offset, offset + length);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    sizes.push(size);
  }
  for (const size of [16, 20, 24, 32, 40, 48, 64, 96, 128, 256])
    assert.ok(sizes.includes(size));
});
