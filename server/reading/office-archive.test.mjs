import test from "node:test";
import assert from "node:assert/strict";
import { officeImageBytes } from "./office-fixtures.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import {
  rarBytes,
  rar4Bytes,
  sevenZipBytes,
} from "./native-archive-fixtures.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { decodePng } from "./image.mjs";
import {
  FIRST_ARCHIVE_WINDOW,
  validateArchiveWindow,
} from "./archive-window.mjs";
import { ReadingWindows } from "./windows.mjs";
for (const format of ["zip", "rar4", "rar", "7z"])
  test(`${format} Office text, image tiles, shared expansion and trailing member retain source order`, async () => {
    const sample = officeImageBytes("xlsx"),
      entries = {
        "01.txt": Buffer.from("前言"),
        "02.xlsx": sample.body,
        "03.txt": Buffer.from("归档尾部唯一标记"),
      };
    const body =
      format === "zip"
        ? zipBytes(entries)
        : format === "rar4"
          ? rar4Bytes(entries)
          : format === "rar"
            ? rarBytes(entries)
            : await sevenZipBytes(entries);
    const file = {
      id: "archive",
      name: "合成." + (format === "rar4" ? "rar" : format),
      body,
      size: body.length,
      hash: sha256(body),
    };
    let cursor = validateArchiveWindow({
        ...FIRST_ARCHIVE_WINDOW,
        office: 1,
        image: 0,
        text: 1,
        tile: 1,
      }),
      count = 0,
      tail = false,
      expanded = [];
    const pixels = Buffer.alloc(sample.width * 4),
      v = Object.create(ReadingWindows.prototype);
    for (let n = 0; cursor && n < 15; n++) {
      const material = await readMaterial(file, { archiveWindow: cursor });
      v.verifyArchive(material, cursor);
      expanded.push(cursor.expanded);
      for (const s of material.segments) {
        if (s.image) {
          count++;
          assert.equal(s.range.archivePath, "02.xlsx");
          assert.equal(s.range.mediaPart, "xl/media/图像.png");
          decodePng(Buffer.from(s.image.data, "base64")).pixels.copy(
            pixels,
            s.range.x * 4,
          );
        } else tail ||= s.text.includes("归档尾部唯一标记");
      }
      cursor = material.archivePagination.next;
    }
    assert.equal(cursor, null);
    assert.equal(count, 3);
    assert.equal(tail, true);
    assert.deepEqual(pixels, sample.pixels);
    const pkg = (await import("./ooxml-zip.mjs")).openPackage(sample.body);
    assert.equal(
      expanded.at(-1),
      pkg.names.reduce((n, name) => n + pkg.size(name), 0),
    );
  });
test('archive cursors cannot smuggle unused Office fields into other formats or legacy Office page aliases',async()=>{
 const body=zipBytes({'01.txt':Buffer.from('前言'),'02.xlsx':officeImageBytes('xlsx').body});const file={id:'archive',name:'合成.zip',body,size:body.length,hash:sha256(body)};
 for(const cursor of [
  {...FIRST_ARCHIVE_WINDOW,entry:1,page:2,base:2,offset:2},
  {...FIRST_ARCHIVE_WINDOW,entry:1,page:2,base:2,offset:2,office:1,image:0,text:1,tile:1},
  {...FIRST_ARCHIVE_WINDOW,office:1,image:1,text:0,tile:1},
  {...FIRST_ARCHIVE_WINDOW,office:1,image:0,text:1,tile:2},
 ])await assert.rejects(readMaterial(file,{archiveWindow:cursor}),/INVALID_ARCHIVE_WINDOW/);
});
