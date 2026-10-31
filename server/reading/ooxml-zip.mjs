import { crc32, inflateRawSync } from "node:zlib";

export const PACKAGE_LIMITS = Object.freeze({
  entries: 1000,
  expanded: 64 * 1024 * 1024,
  ratio: 100,
});
const fail = (code) => {
  throw Error(code);
};

// No filesystem extraction and no path supplied to another program. Validate
// both ZIP headers before allocating output; zlib enforces the actual bound.
export function openPackage(bytes, { budget, archive = false } = {}) {
  const b = Buffer.from(bytes);
  let end = b.length - 22;
  for (; end >= Math.max(0, b.length - 65557); end--)
    if (
      b.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + b.readUInt16LE(end + 20) === b.length
    )
      break;
  if (end < Math.max(0, b.length - 65557)) fail("PACKAGE_INVALID");
  if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6))
    fail("PACKAGE_UNSUPPORTED");
  const count = b.readUInt16LE(end + 10),
    centralSize = b.readUInt32LE(end + 12),
    central = b.readUInt32LE(end + 16);
  if (count === 0xffff || central === 0xffffffff || centralSize === 0xffffffff)
    fail("PACKAGE_UNSUPPORTED");
  if (count !== b.readUInt16LE(end + 8) || central + centralSize !== end)
    fail("PACKAGE_INVALID");
  if ((!count && !archive) || count > PACKAGE_LIMITS.entries) fail("PACKAGE_LIMIT");
  const entries = new Map(),
    spans = [];
  let cursor = central,
    total = 0,
    compressed = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || b.readUInt32LE(cursor) !== 0x02014b50)
      fail("PACKAGE_INVALID");
    const flags = b.readUInt16LE(cursor + 8),
      method = b.readUInt16LE(cursor + 10),
      checksum = b.readUInt32LE(cursor + 16),
      size = b.readUInt32LE(cursor + 20),
      expanded = b.readUInt32LE(cursor + 24),
      names = b.readUInt16LE(cursor + 28),
      extra = b.readUInt16LE(cursor + 30),
      comment = b.readUInt16LE(cursor + 32),
      local = b.readUInt32LE(cursor + 42);
    if (
      cursor + 46 + names + extra + comment > end ||
      b.readUInt16LE(cursor + 34)
    )
      fail("PACKAGE_INVALID");
    if (
      flags & ~0x080e ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      [size, expanded, local].includes(0xffffffff)
    )
      fail("PACKAGE_UNSUPPORTED");
    const rawName = b.subarray(cursor + 46, cursor + 46 + names);
    let name;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(rawName);
    } catch {
      fail("PACKAGE_PATH");
    }
    // ZIP's unflagged non-ASCII encoding is ambiguous (often CP437). Never
    // silently treat it as UTF-8 and attach evidence to a different path.
    if (archive && !(flags & 0x800) && rawName.some((c) => c > 127))
      fail("ARCHIVE_ENCODING_UNSUPPORTED");
    if (
      !name ||
      Buffer.byteLength(name) > 512 ||
      /[\x00-\x1f\x7f\\:]/.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((p) => p === "." || p === "..") ||
      name.split("/").length > 16 ||
      entries.has(name) ||
      name
        .split("/")
        .some((p) => ["__proto__", "constructor", "prototype"].includes(p))
    )
      fail("PACKAGE_PATH");
    const mode = b.readUInt32LE(cursor + 38) >>> 16,
      kind = mode & 0o170000;
    if (kind && ![0o100000, 0o040000].includes(kind)) fail("PACKAGE_PATH");
    if (archive && (
      !!(b.readUInt32LE(cursor + 38) & 0x400) ||
      (kind === 0o040000 && !name.endsWith("/")) ||
      name.split("/").slice(0, -1).some((p) => !p)
    )) fail("PACKAGE_PATH");
    if (name.endsWith("/") && expanded) fail("PACKAGE_INVALID");
    total += expanded;
    compressed += size;
    if (
      expanded > PACKAGE_LIMITS.expanded ||
      total > PACKAGE_LIMITS.expanded ||
      expanded > Math.max(size, 1) * PACKAGE_LIMITS.ratio
    )
      fail("PACKAGE_LIMIT");
    if (
      local + 30 > central ||
      b.readUInt32LE(local) !== 0x04034b50 ||
      b.readUInt16LE(local + 6) !== flags ||
      b.readUInt16LE(local + 8) !== method
    )
      fail("PACKAGE_INVALID");
    const localNames = b.readUInt16LE(local + 26),
      start = local + 30 + localNames + b.readUInt16LE(local + 28);
    if (
      start + size > central ||
      !b.subarray(local + 30, local + 30 + localNames).equals(rawName)
    )
      fail("PACKAGE_INVALID");
    if (
      !(flags & 8) &&
      (b.readUInt32LE(local + 14) !== checksum ||
        b.readUInt32LE(local + 18) !== size ||
        b.readUInt32LE(local + 22) !== expanded)
    )
      fail("PACKAGE_INVALID");
    spans.push([local, start + size]);
    entries.set(name, { start, size, expanded, method, checksum });
    cursor += 46 + names + extra + comment;
  }
  if (cursor !== end || total > Math.max(compressed, 1) * PACKAGE_LIMITS.ratio)
    fail("PACKAGE_INVALID");
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, i) => i && span[0] < spans[i - 1][1]))
    fail("PACKAGE_INVALID");
  if (budget) {
    if (budget.expanded + total > PACKAGE_LIMITS.expanded)
      fail("PACKAGE_LIMIT");
    budget.expanded += total;
  }
  return {
    names: [...entries.keys()],
    size: (name) => entries.get(name)?.expanded,
    read(name) {
      const e = entries.get(name);
      if (!e) fail("PACKAGE_PART_MISSING");
      const raw = b.subarray(e.start, e.start + e.size);
      let data;
      try {
        data =
          e.method === 0
            ? Buffer.from(raw)
            : inflateRawSync(raw, { maxOutputLength: Math.max(1, e.expanded) });
      } catch {
        fail("PACKAGE_INVALID");
      }
      if (data.length !== e.expanded || crc32(data) !== e.checksum)
        fail("PACKAGE_INVALID");
      return data;
    },
  };
}
