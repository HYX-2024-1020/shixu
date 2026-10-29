// Project-authored RAR5 stored fixture; format: https://www.rarlab.com/technote.htm
import { crc32 } from "node:zlib";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import { xlsxBytes, inline } from "./xlsx-fixtures.mjs";
import { pdfBytes } from "./pdf-fixtures.mjs";
const require = createRequire(import.meta.url);
export async function sevenZipBytes(entries, options = []) {
  const directory = await mkdtemp(join(tmpdir(), "shixu-seven-fixture-"));
  try {
    for (const [name, body] of Object.entries(entries)) {
      if (!/^[^/\\\x00-\x1f]+$/.test(name)) throw Error("FIXTURE_PATH");
      await writeFile(join(directory, name), body);
    }
    const built = fileURLToPath(
      new URL(
        "./generated-native/reading-7zz" +
          (process.platform === "win32" ? ".exe" : ""),
        import.meta.url,
      ),
    );
    const binary = existsSync(built) ? built : require("7zip-bin-full").path7z;
    await promisify(execFile)(
      binary,
      [
        "a",
        "-t7z",
        "-mx=0",
        "-ms=off",
        "-mmt=1",
        "-mtm=off",
        "-mtc=off",
        "-mta=off",
        ...options,
        "sample.7z",
        ...Object.keys(entries),
      ],
      { cwd: directory, windowsHide: true },
    );
    return await readFile(join(directory, "sample.7z"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function nativeArchiveSample(format, { long = false } = {}) {
  const first = long ? "原生归档课程😀。\n".repeat(22000) : "中文😀\r\n空白  ";
  const entries = {
    "01说明.txt": Buffer.from(first),
    "02数据.csv": Buffer.from('名称,值\r\n"多\n行",😀\r\n'),
    "03文档.docx": docxBytes(paragraph("文档中文😀")),
    "04表格.xlsx": xlsxBytes([
      { name: "表一", xml: `<row r="1">${inline("A1", "表格😀")}</row>` },
    ]),
    "05页面.pdf": pdfBytes([{ text: "页内😀" }, { text: "" }]),
    "06未读.png": Buffer.from("synthetic image"),
    "07尾部.txt": Buffer.from("原生尾部唯一标记"),
  };
  return {
    name: "合成." + format,
    type: "application/octet-stream",
    body: format === "rar" ? rarBytes(entries) : await sevenZipBytes(entries),
    expectedText:
      first.replace(/\r\n?/g, "\n") +
      '名称,值\n"多\n行",😀\n' +
      "文档中文😀\nA1\t表格😀\n页内😀\n原生尾部唯一标记",
  };
}
export function rarBytes(entries) {
  const vint = (n) => {
    const b = [];
    do {
      const v = n % 128;
      n = Math.floor(n / 128);
      b.push(v | (n ? 128 : 0));
    } while (n);
    return Buffer.from(b);
  };
  const uint = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const header = (...parts) => {
    const b = Buffer.concat(
      parts.map((p) => (typeof p === "number" ? vint(p) : p)),
    );
    const h = Buffer.concat([vint(b.length), b]);
    return Buffer.concat([uint(crc32(h)), h]);
  };
  return Buffer.concat([
    Buffer.from("526172211a070100", "hex"),
    header(1, 0, 0),
    ...(Array.isArray(entries) ? entries : Object.entries(entries)).flatMap(
      ([name, value]) => {
        const body = Buffer.from(value),
          path = Buffer.from(name);
        return [
          header(
            2,
            2,
            body.length,
            4,
            body.length,
            0o100644,
            uint(crc32(body)),
            0,
            1,
            path.length,
            path,
          ),
          body,
        ];
      },
    ),
    header(5, 0, 0),
  ]);
}
