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

// Project-authored RAR 2.x/3.x/4.x stored blocks. No external compressor needed.
export function rar4Bytes(entries,{unicode=false,archiveFlags=0,fileFlags=0}={}){
  const header=(type,flags,body)=>{
    const b=Buffer.alloc(7+body.length);b[2]=type;b.writeUInt16LE(flags,3);b.writeUInt16LE(b.length,5);body.copy(b,7);
    b.writeUInt16LE(crc32(b.subarray(2))&65535);return b;
  };
  const pathBytes=name=>{
    if(unicode!=='encoded')return Buffer.from(name);
    const words=Buffer.from(name,'utf16le'),encoded=[0];
    for(let offset=0;offset<words.length;offset+=8){encoded.push(0xaa,...words.subarray(offset,offset+8));}
    return Buffer.concat([Buffer.from('legacy'),Buffer.from([0]),Buffer.from(encoded)]);
  };
  return Buffer.concat([Buffer.from('526172211a0700','hex'),header(0x73,archiveFlags,Buffer.alloc(6)),
    ...(Array.isArray(entries)?entries:Object.entries(entries)).flatMap(([name,value])=>{
      const body=Buffer.from(value),filename=pathBytes(name),meta=Buffer.alloc(25);
      meta.writeUInt32LE(body.length);meta.writeUInt32LE(body.length,4);meta[8]=3;meta.writeUInt32LE(crc32(body),9);
      meta.writeUInt32LE(0x00210000,13);meta[17]=20;meta[18]=0x30;meta.writeUInt16LE(filename.length,19);meta.writeUInt32LE(0o100644,21);
      return [header(0x74,0x8000|(unicode?0x200:0)|fileFlags,Buffer.concat([meta,filename])),body];
    }),header(0x7b,0,Buffer.alloc(0))]);
}

export function decodeUuFixture(encoded){
  const chunks=[];
  for(const line of encoded.split(/\r?\n/).slice(1)){
    if(line==='end')break;if(!line)continue;
    const length=(line.charCodeAt(0)-32)&63,bytes=[];
    for(let i=1;i<line.length;i+=4){const a=(line.charCodeAt(i)-32)&63,b=(line.charCodeAt(i+1)-32)&63,
      c=(line.charCodeAt(i+2)-32)&63,d=(line.charCodeAt(i+3)-32)&63;
      bytes.push((a<<2)|(b>>4),((b&15)<<4)|(c>>2),((c&3)<<6)|d);}
    chunks.push(Buffer.from(bytes.slice(0,length)));
  }
  return Buffer.concat(chunks);
}
// The upstream normal-compression archive also has links and backslash aliases.
// Keep its original first file header and compressed payload byte-for-byte,
// omit the other members, and append our authored empty RAR4 end header.
export function rar4FirstCompressedFixture(encoded){
  const original=decodeUuFixture(encoded),start=7+original.readUInt16LE(12);
  if(original[start+2]!==0x74||(original.readUInt16LE(10)&8)||
    (original.readUInt16LE(start+3)&0x117))throw Error('FIXTURE_STRUCTURE');
  const size=original.readUInt16LE(start+5),packed=original.readUInt32LE(start+7),unpacked=original.readUInt32LE(start+11),
    name=original.subarray(start+32,start+32+original.readUInt16LE(start+26)).toString('ascii');
  return {original,name,unpacked,body:Buffer.concat([original.subarray(0,start+size+packed),rar4Bytes({}).subarray(-7)])};
}
