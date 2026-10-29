import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { sha256, MAX_FILE_BYTES } from "./material.mjs";
import { PACKAGE_LIMITS } from "./ooxml-zip.mjs";

const generated = fileURLToPath(
  new URL("./generated-native/", import.meta.url),
);
const sourceHash =
  "0b6080b8c3e7a579161d2d495224c0e51c467576cb4c7048b0ab485ef44cc22e";
const fail = (code) => {
  throw Error(code);
};

// RAR4's generic handler can omit service/volume-label records. Walk opaque
// headers first so a skipped record cannot make a package look fully read.
// Names and compressed data are still handled by the verified native tool.
function preflightRar4(bytes) {
  if (bytes.length < 27 || bytes[9] !== 0x73 ||
    bytes.readUInt16LE(12) !== 13 || (bytes.readUInt16LE(10) & ~0x104))
    fail("PACKAGE_UNSUPPORTED");
  if ((crc32(bytes.subarray(9,20)) & 65535) !== bytes.readUInt16LE(7))
    fail("PACKAGE_INVALID");
  let position=20,entries=0;
  while(position<bytes.length){
    if(position+7>bytes.length)fail("PACKAGE_INVALID");
    const type=bytes[position+2],flags=bytes.readUInt16LE(position+3),size=bytes.readUInt16LE(position+5);
    const end=position+size;
    if(size<7||end>bytes.length||(crc32(bytes.subarray(position+2,end))&65535)!==bytes.readUInt16LE(position))
      fail("PACKAGE_INVALID");
    if(type===0x7b){
      if(flags||size!==7||end!==bytes.length)fail("PACKAGE_UNSUPPORTED");
      return;
    }
    if(type!==0x74||(flags&~0x93e0))fail("PACKAGE_UNSUPPORTED");
    if(size<32)fail("PACKAGE_INVALID");
    if(++entries>PACKAGE_LIMITS.entries)fail("PACKAGE_LIMIT");
    const packed=bytes.readUInt32LE(position+7),host=bytes[position+15],attr=bytes.readUInt32LE(position+28);
    if(host>3||(host<3&&(attr&8)))fail("PACKAGE_UNSUPPORTED");
    if(host===3 && ![0o100000,0o040000].includes(attr&0o170000))fail("PACKAGE_PATH");
    const extra=(flags&0x100)?8:0;
    if(size<32+extra)fail("PACKAGE_INVALID");
    if(extra && (bytes.readUInt32LE(position+32)||bytes.readUInt32LE(position+36)))fail("PACKAGE_LIMIT");
    const nameSize=bytes.readUInt16LE(position+26);
    if(!nameSize||32+extra+nameSize>size||end+packed>bytes.length)fail("PACKAGE_INVALID");
    position=end+packed;
  }
  fail("PACKAGE_INVALID"); // An explicit validated end record is required.
}

// No system 7z, environment override, caller-supplied executable or shell.
async function verifiedTool() {
  try {
    const binary = join(
      generated,
      "reading-7zz" + (process.platform === "win32" ? ".exe" : ""),
    );
    const manifest = JSON.parse(
      await readFile(join(generated, "manifest.json"), "utf8"),
    );
    if (
      manifest.protocol !== "shixu-raw-path/2" ||
      manifest.sha256 !== sourceHash ||
      manifest.platform !== process.platform + "-" + process.arch ||
      sha256(await readFile(binary)) !== manifest.toolSha256
    )
      fail("NATIVE_READER_UNSUPPORTED");
    return binary;
  } catch {
    fail("NATIVE_READER_UNSUPPORTED");
  }
}

export function decodeRawPath(raw) {
  if (!/^SHIXU_U32:(?:[0-9A-F]{8}){1,512}$/.test(raw)) fail("PACKAGE_PATH");
  let path = "";
  for (let i = 10; i < raw.length; i += 8) {
    const n = parseInt(raw.slice(i, i + 8), 16);
    if (n > 0x10ffff) fail("PACKAGE_PATH");
    path += String.fromCodePoint(n);
  }
  if (
    !path.isWellFormed() ||
    Buffer.byteLength(path) > 512 ||
    /[\x00-\x1f\x7f\\:]/.test(path) ||
    path.startsWith("/") ||
    path.split("/").length > 16 ||
    path
      .split("/")
      .some(
        (p, i, a) =>
          p === "." ||
          p === ".." ||
          (!p && i < a.length - 1) ||
          ["__proto__", "constructor", "prototype"].includes(p),
      )
  )
    fail("PACKAGE_PATH");
  return path;
}

function properties(block) {
  const props = Object.create(null);
  for (const line of block.split("\n")) {
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z0-9 ()-]*) = (.*)$/.exec(line);
    if (!m || Object.hasOwn(props, m[1])) fail("PACKAGE_INVALID");
    props[m[1]] = m[2];
  }
  return props;
}
const integer = (value) => {
  if (!/^(0|[1-9][0-9]*)$/.test(value || "")) fail("PACKAGE_UNSUPPORTED");
  const n = Number(value);
  if (!Number.isSafeInteger(n)) fail("PACKAGE_LIMIT");
  return n;
};

// Full preflight before any member extraction. Solid/unknown per-member packed
// sizes cannot prove the mandatory individual expansion ratio, so fail closed.
export function parseNativeListing(text, format, inputBytes, budget) {
  text = text.replace(/\r\n/g, "\n");
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) fail("PACKAGE_INVALID");
  const halves = text.split("\n----------\n");
  if (halves.length !== 2) fail("PACKAGE_UNSUPPORTED");
  const start = halves[0].lastIndexOf("\n--\n");
  if (start < 0) fail("PACKAGE_INVALID");
  const archive = properties(halves[0].slice(start + 4));
  if (
    archive.Type !== format ||
    archive.Encrypted === "+" ||
    archive.Solid !== "-" ||
    (format === "Rar5" &&
      (archive.Encrypted !== "-" || archive.Multivolume !== "-")) ||
    (format === "Rar" && (archive.Multivolume !== "-" || archive.Volumes !== "1")) ||
    archive.Multivolume === "+" ||
    (archive.Volumes && archive.Volumes !== "1") ||
    archive["Offset"] ||
    archive["Tail Size"] ||
    archive["Errors"] ||
    integer(archive["Physical Size"]) !== inputBytes
  )
    fail("PACKAGE_UNSUPPORTED");
  const records = halves[1].replace(/\n+$/, "").split(/\n\n+/).filter(Boolean);
  if (records.length > PACKAGE_LIMITS.entries) fail("PACKAGE_LIMIT");
  const entries = new Map();
  let total = 0,
    packed = 0;
  for (const record of records) {
    const p = properties(record),
      name = decodeRawPath(p.Path || "");
    if (entries.has(name)) fail("PACKAGE_PATH");
    // 7z exposes the typed directory bit through Attributes rather than a
    // separate Folder field. Accept only the upstream's known flag/mode form.
    if (format === "7z" && p.Folder === undefined) {
      if (
        !/^[DRAHSCNTIOXVE_PU. ]*(?:[-dlcbps][r-][w-][xsStT-][r-][w-][xsStT-][r-][w-][xtTsS-])?$/.test(
          p.Attributes || "",
        ) ||
        !p.Attributes
      )
        fail("PACKAGE_UNSUPPORTED");
      p.Folder = /^D| d[r-][w-]/.test(p.Attributes) ? "+" : "-";
    }
    if (
      !["+", "-"].includes(p.Folder) ||
      p.Encrypted !== "-" ||
      (format === "Rar" && !["15","20","26","29","36"].includes(p.Version)) ||
      [
        "Encrypted",
        "Solid",
        "Split Before",
        "Split After",
        "Alternate Stream",
      ].some((k) => p[k] && p[k] !== "-") ||
      [
        "Symbolic Link",
        "Hard Link",
        "Copy Link",
        "NT Security",
        "Version",
      ].some((k) => p[k] && !(format === "Rar" && k === "Version" && ["15","20","26","29","36"].includes(p[k])))
    )
      fail("PACKAGE_UNSUPPORTED");
    // Unix special files and Windows reparse attributes must never be treated
    // as ordinary text, even though extraction itself uses stdout only.
    const attr = p.Attributes || "";
    if (
      /[lpcbs][r-][w-][xsStT-][r-][w-][xsStT-][r-][w-][xtTsS-]$/.test(attr) ||
      /(?:^|\s)[^\s]*[LJ][^\s]*(?:\s|$)/.test(attr)
    )
      fail("PACKAGE_PATH");
    if (p.Folder === "+" && !name.endsWith("/")) {
      // Native handlers can omit a directory's trailing slash. Canonicalize
      // ONLY this explicitly typed empty directory; files keep their raw name.
      if (entries.has(name + "/")) fail("PACKAGE_PATH");
    }
    const size = integer(p.Size),
      compressed =
        p["Packed Size"] === "" && !size ? 0 : integer(p["Packed Size"]);
    if ((p.Folder === "+" && size) || (p.Folder === "-" && name.endsWith("/")))
      fail("PACKAGE_INVALID");
    if (
      size > PACKAGE_LIMITS.expanded ||
      size > Math.max(compressed, 1) * PACKAGE_LIMITS.ratio
    )
      fail("PACKAGE_LIMIT");
    total += size;
    packed += compressed;
    if (total > PACKAGE_LIMITS.expanded || packed > inputBytes)
      fail("PACKAGE_LIMIT");
    if (size && !/^[A-F0-9]{8}$/.test(p.CRC || "")) fail("PACKAGE_UNSUPPORTED");
    entries.set(name, {
      size,
      compressed,
      crc: p.CRC,
      folder: p.Folder === "+",
    });
  }
  if (
    total > Math.max(packed, 1) * PACKAGE_LIMITS.ratio ||
    budget.expanded + total > PACKAGE_LIMITS.expanded
  )
    fail("PACKAGE_LIMIT");
  budget.expanded += total;
  return entries;
}

export async function openNativeArchive(bytes, { budget, extension }) {
  const format =
    extension === "7z" &&
    bytes.subarray(0, 6).toString("hex") === "377abcaf271c"
      ? "7z"
      : extension === "rar" &&
          bytes.subarray(0, 8).toString("hex") === "526172211a070100"
        ? "Rar5"
        : extension === "rar" && bytes.subarray(0,7).toString("hex") === "526172211a0700" ? "Rar" : null;
  if (!format) fail("FORMAT_MISMATCH");
  if(format === 'Rar')preflightRar4(bytes);
  const binary = await verifiedTool();
  // The Linux broker offers only /scratch as writable tmpfs. A directory is
  // owned by this invocation and contains only the original opaque archive.
  const parent =
    process.platform === "linux" && process.cwd() === "/scratch"
      ? "/scratch"
      : tmpdir();
  const directory = await mkdtemp(join(parent, "shixu-native-"));
  const input = join(directory, "input." + extension),
    deadline = performance.now() + 29000;
  const close = async () => {
    await rm(directory, { recursive: true, force: true });
  };
  const run = (args, limit) =>
    new Promise((done, reject) => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return reject(Error("ARCHIVE_ENTRY_FAILED"));
      const child = spawn(
        binary,
        [...args, "-mmt=1", "-bd", "-ssc", "-sccUTF-8", "-t" + format, "--", input],
        {
          cwd: directory,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env:
            process.platform === "win32"
              ? { SystemRoot: process.env.SystemRoot, PATH: "" }
              : { PATH: "/", LANG: "C.UTF-8" },
        },
      );
      let size = 0,
        errors = 0,
        failure;
      const chunks = [];
      const abort = () => {
        failure = Error("ARCHIVE_ENTRY_FAILED");
        child.kill("SIGKILL");
      };
      const timer = setTimeout(abort, remaining);
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) abort();
        else if (!failure) chunks.push(chunk);
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk.length;
        if (errors > 65536) abort();
      });
      child.on("error", () => {
        failure = Error("ARCHIVE_ENTRY_FAILED");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure || code !== 0)
          reject(failure || Error("PACKAGE_UNSUPPORTED"));
        else done(Buffer.concat(chunks));
      });
    });
  try {
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    const listing = await run(["l", "-slt"], 2 * 1024 * 1024);
    const entries = parseNativeListing(
      new TextDecoder("utf-8", { fatal: true }).decode(listing),
      format,
      bytes.length,
      budget,
    );
    return {
      names: [...entries].map(([name, e]) =>
        e.folder && !name.endsWith("/") ? name + "/" : name,
      ),
      size: (name) => entries.get(name)?.size,
      async read(name) {
        const e = entries.get(name);
        if (!e || e.folder || e.size > MAX_FILE_BYTES)
          fail("ARCHIVE_ENTRY_FAILED");
        // -i! is a literal include specification; @name is never a listfile.
        const body = await run(
          ["x", "-so", "-spd", "-r-", "-i!" + name],
          Math.max(1, e.size),
        );
        if (body.length !== e.size || crc32(body) !== parseInt(e.crc, 16))
          fail("ARCHIVE_ENTRY_FAILED");
        return body;
      },
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
