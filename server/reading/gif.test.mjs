import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeGif, decodeGifIndices, inspectGif } from "./gif.mjs";
import { gifBytes } from "./gif-fixtures.mjs";
import {
  readMaterial,
  sha256,
  coverageOnly,
  modelMaterial,
} from "./material.mjs";
import { decodePng } from "./image.mjs";
import { ReadingWindows } from "./windows.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { sourceLocation } from "../../shared/reading-view.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";

test("GIF tiny comment sub-blocks remain bounded and cannot enter model input",async()=>{
  const original=gifBytes({width:2,height:1});
  const data=Buffer.alloc(2*1024*1024);for(let i=0;i<data.length;i+=2){data[i]=1;data[i+1]=65;}
  const body=Buffer.concat([original.subarray(0,25),Buffer.from([0x21,0xfe]),data,Buffer.from([0]),original.subarray(25)]);
  const material=await readMaterial({id:"gif",name:"tiny.gif",body,size:body.length,hash:sha256(body)},{imageWindow:{tile:1}});
  assert.equal(material.state,"read");assert.equal(material.segments.length,1);assert.ok(!material.segments[0].text.includes("AAAA"));
  assert.deepEqual(decodePng(Buffer.from(material.segments[0].image.data,"base64")).pixels,decodeGif(original).pixels);
});

test("GIF dictionary widths, interlace, local palettes, animation disposal and all pixels match independent Pillow goldens", () => {
  const golden = JSON.parse(
    readFileSync(new URL("./fixtures/gif-goldens.json", import.meta.url)),
  );
  for (const [name, expected] of Object.entries(golden.files)) {
    const bytes = readFileSync(new URL("./fixtures/" + name, import.meta.url));
    assert.equal(sha256(bytes), expected.sha256);
    const parsed = inspectGif(bytes);
    assert.equal(parsed.frames.length, expected.frames.length);
    for (const frame of expected.frames) {
      const actual = decodeGif(bytes, frame.frame, parsed);
      assert.equal(sha256(actual.pixels), frame.pixelsHash);
      assert.equal(actual.frameStartMs, frame.startMs);
      assert.equal(actual.frameDurationMs, frame.durationMs);
    }
  }
  assert.deepEqual(
    [...decodeGifIndices(Buffer.from([0x8c, 0x0b]), 2, 3)],
    [1, 1, 1],
    "KwKwK forward dictionary reference",
  );
});

test("GIF exact termination, palette/frame bounds, unsupported controls and resource limits fail before model pixels", async () => {
  const bytes = gifBytes({ width: 2, height: 1 });
  const change = (offset, value) => {
    const b = Buffer.from(bytes);
    b[offset] = value;
    return b;
  };
  const descriptor = bytes.indexOf(Buffer.from([0x2c]), 25),
    dataStart = descriptor + 10;
  const bad = [
    bytes.subarray(0, -1),
    Buffer.concat([bytes, Buffer.from([0])]),
    change(12, 1),
    change(28, 0xfc),
    change(28, 8 | 2),
    change(dataStart, 1),
    change(descriptor + 5, 3),
    change(descriptor + 9, 8),
    Buffer.concat([
      bytes.subarray(0, 25),
      Buffer.from([0x21, 0x01, 0]),
      bytes.subarray(25),
    ]),
  ];
  for (const body of bad) {
    const material = await readMaterial(
      {
        id: "gif",
        name: "synthetic.gif",
        body,
        size: body.length,
        hash: sha256(body),
      },
      { imageWindow: { tile: 1 } },
    );
    assert.equal(material.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(material.state));
  }
  for (const data of [
    Buffer.from([0x4c]),
    Buffer.from([0x4c, 1, 0]),
    Buffer.from([0x4c, 0]),
  ])
    assert.throws(() => decodeGifIndices(data, 2, 1), /GIF_MALFORMED/);
  assert.throws(
    () => decodeGifIndices(Buffer.from([0x4c, 1]), 2, 2),
    /GIF_MALFORMED/,
  );
  const many = gifBytes({
    width: 1,
    height: 1,
    frames: Array.from({ length: 65 }, () => ({})),
  });
  assert.throws(() => inspectGif(many), /GIF_RESOURCE_LIMIT|IMAGE_TILE_LIMIT/);
  const large = Buffer.from(bytes);
  large.writeUInt16LE(10000, 6);
  large.writeUInt16LE(10000, 8);
  assert.throws(() => inspectGif(large), /IMAGE_PIXEL_LIMIT/);
});

test("all GIF frame tiles preserve timeline, full composite pixels, archive source paths and tail", async () => {
  const body = gifBytes({
      width: 2051,
      height: 4,
      frames: [{}, { transparent: 0, disposal: 3 }, { disposal: 2 }],
    }),
    parsed = inspectGif(body);
  const verifier = Object.create(ReadingWindows.prototype);
  for (const archived of [false, true]) {
    const bytes = archived
      ? zipBytes({
          "notice.gif": body,
          "tail.txt": Buffer.from("尾部唯一标记"),
        })
      : body;
    const input = {
      id: "gif",
      name: archived ? "notice.zip" : "notice.gif",
      body: bytes,
      size: bytes.length,
      hash: sha256(bytes),
    };
    const reconstructed = Array.from({ length: 3 }, () =>
      Buffer.alloc(2051 * 4 * 4),
    );
    let cursor = archived ? FIRST_ARCHIVE_WINDOW : { tile: 1 },
      count = 0,
      tail = false;
    while (cursor) {
      const material = await readMaterial(
        input,
        archived ? { archiveWindow: cursor } : { imageWindow: cursor },
      );
      verifier.verify(
        material,
        undefined,
        archived ? cursor : undefined,
        archived ? undefined : cursor,
      );
      for (const source of material.segments) {
        if (!source.image) {
          assert.equal(source.text, "尾部唯一标记");
          tail = true;
          continue;
        }
        const r = source.range,
          pixels = decodePng(Buffer.from(source.image.data, "base64")).pixels;
        for (let y = 0; y < r.height; y++)
          pixels.copy(
            reconstructed[r.frame - 1],
            ((r.y + y) * 2051 + r.x) * 4,
            y * r.width * 4,
            (y + 1) * r.width * 4,
          );
        assert.match(
          sourceLocation([coverageOnly(material)], source.sourceId),
          /第 [123]\/3 帧.*像素/,
        );
        assert.equal(r.tile, ++count);
        if (archived) assert.equal(r.archivePath, "notice.gif");
        assert.ok(
          !JSON.stringify(coverageOnly(modelMaterial(material))).includes(
            source.image.data,
          ),
        );
      }
      cursor = archived
        ? material.archivePagination.next
        : material.imagePagination.nextTile
          ? { tile: material.imagePagination.nextTile }
          : null;
    }
    assert.equal(count, 9);
    assert.equal(tail, archived);
    for (let i = 0; i < 3; i++)
      assert.deepEqual(reconstructed[i], decodeGif(body, i + 1, parsed).pixels);
  }
});

test("animated GIF preserves both frame timelines through signed Windows and Page adapters, stop/reupload and semantic merge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-gif-clients-"));
  try {
    await runClientLoop({
      directory,
      reader: Object.assign((f, o) => readMaterial(f, o), {
        pdfWindows: true,
        imageWindows: true,
        archiveWindows: true,
      }),
      originalQuota: 1,
      expireBeforeStart: true,
      startByMini: true,
      sourceByMini: true,
      original: {
        name: "合成通知.gif",
        type: "image/gif",
        body: gifBytes({
          width: 9,
          height: 11,
          frames: [{ delay: 3 }, { delay: 7, disposal: 2 }],
        }),
        expectedImageTiles: 2,
        verify: ({ win, mini, page, cloud }) => {
          assert.deepEqual(
            win.readingCoverage,
            JSON.parse(JSON.stringify(mini.readingCoverage)),
          );
          assert.deepEqual(
            win.readingCoverage[0].covered.map((r) => [
              r.frame,
              r.frameStartMs,
              r.frameDurationMs,
            ]),
            [
              [1, 0, 30],
              [2, 30, 70],
            ],
          );
          assert.equal(win.result.items.length, 1);
          assert.equal(win.result.items[0].evidence.length, 2);
          assert.match(
            page.data.jobs.find((j) => j.id === cloud.readJobs()[0].id)
              .pdfProgressLabel,
            /2 \/ 2 个图像区域/,
          );
        },
      },
      semanticMerge: {
        provider: async (sources) => {
          const rows = JSON.parse(sources[0].text).items;
          return {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: { same: [[rows[0].id, rows[1].id]], related: [] },
          };
        },
        verify: () => {},
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
