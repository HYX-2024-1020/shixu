import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeWebp, inspectWebp } from "./webp.mjs";
import { decodePng } from "./image.mjs";
import { readMaterial, sha256, coverageOnly } from "./material.mjs";
import { ReadingWindows } from "./windows.mjs";
import { zipBytes } from "./archive-fixtures.mjs";
import { FIRST_ARCHIVE_WINDOW } from "./archive-window.mjs";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";

const fixture = (name) =>
  readFileSync(new URL("./fixtures/" + name, import.meta.url));
const goldens = JSON.parse(fixture("webp-goldens.json")).files;

test("animated WebP shares signed dual-client stop/reupload, timeline, paid semantic merge and publication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-webp-clients-"));
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
        name: "合成通知.webp",
        type: "image/webp",
        body: fixture("webp-animation.webp"),
        expectedImageTiles: 4,
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
              [1, 0, 10],
              [2, 10, 20],
              [3, 30, 30],
              [4, 60, 40],
            ],
          );
          assert.equal(win.result.items.length, 1);
          assert.equal(win.result.items[0].evidence.length, 4);
          assert.match(
            page.data.jobs.find((j) => j.id === cloud.readJobs()[0].id)
              .pdfProgressLabel,
            /4 \/ 4 个图像区域/,
          );
        },
      },
      semanticMerge: {
        provider: async (sources) => {
          const rows = JSON.parse(sources[0].text).items;
          return {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: {
              same: rows.slice(1).map((row) => [rows[0].id, row.id]),
              related: [],
            },
          };
        },
        verify: () => {},
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
function rewriteChunks(bytes, change, start = 12) {
  const parts = [];
  for (let p = start; p < bytes.length; ) {
    const size = bytes.readUInt32LE(p + 4),
      name = bytes.toString("ascii", p, p + 4),
      original = bytes.subarray(p + 8, p + 8 + size);
    const body = change(name, Buffer.from(original)),
      h = Buffer.alloc(8);
    h.write(name);
    h.writeUInt32LE(body.length, 4);
    parts.push(h, body, ...(body.length & 1 ? [Buffer.from([0])] : []));
    p += 8 + size + (size & 1);
  }
  const payload = Buffer.concat(parts);
  if (!start) return payload;
  const h = Buffer.from(bytes.subarray(0, 12));
  h.writeUInt32LE(payload.length + 4, 4);
  return Buffer.concat([h, payload]);
}

test("source-built WebP lossless/lossy/alpha and every animation tile match fixed saved pixel goldens", async () => {
  const verifier = Object.create(ReadingWindows.prototype);
  for (const [name, golden] of Object.entries(goldens)) {
    const body = fixture(name),
      parsed = inspectWebp(body);
    assert.equal(sha256(body), golden.sha256);
    const images = golden.frames.map(() =>
      Buffer.alloc(golden.width * golden.height * 4),
    );
    const total =
      Math.ceil(golden.width / 1024) *
      Math.ceil(golden.height / 1024) *
      golden.frames.length;
    for (let tile = 1; tile <= total; tile++) {
      const material = await readMaterial(
        { id: "webp", name, body, size: body.length, hash: sha256(body) },
        { imageWindow: { tile } },
      );
      verifier.verify(material, undefined, undefined, { tile });
      assert.equal("decoderMetrics" in coverageOnly(material),false);
      const s = material.segments[0],
        r = s.range,
        p = decodePng(Buffer.from(s.image.data, "base64")).pixels;
      for (let y = 0; y < r.height; y++)
        p.copy(
          images[r.frame - 1],
          ((r.y + y) * golden.width + r.x) * 4,
          y * r.width * 4,
          (y + 1) * r.width * 4,
        );
      assert.equal(r.frameStartMs, golden.frames[r.frame - 1].startMs);
      assert.equal(r.frameDurationMs, golden.frames[r.frame - 1].durationMs);
      assert.equal(material.imagePagination.totalTiles, total);
    }
    assert.equal(parsed.frames.length, golden.frames.length);
    for (let frame = 0; frame < images.length; frame++)
      assert.equal(sha256(images[frame]), golden.frames[frame].pixelsHash);
  }
});

test("WebP rejects extra entropy bytes inside valid RIFF lengths, including lossless/lossy/alpha and the last animation frame", async () => {
  for (const name of [
    "webp-lossless.webp",
    "webp-lossy.webp",
    "webp-animation.webp",
  ]) {
    for (const suffix of [Buffer.from([0]), Buffer.from([0, 7, 12, 22])]) {
      const corrupt = rewriteChunks(fixture(name), (type, body) => {
        if (["VP8 ", "VP8L", "ALPH"].includes(type))
          return Buffer.concat([body, suffix]);
        if (type === "ANMF")
          return Buffer.concat([
            body.subarray(0, 16),
            rewriteChunks(
              body.subarray(16),
              (t, b) =>
                ["VP8 ", "VP8L"].includes(t) ? Buffer.concat([b, suffix]) : b,
              0,
            ),
          ]);
        return body;
      });
      await assert.rejects(decodeWebp(corrupt, 1), /WEBP_/);
    }
  }
  const body = fixture("webp-lossy.webp");
  const alphaOnly = rewriteChunks(body, (type, b) =>
    type === "ALPH" ? Buffer.concat([b, Buffer.from([1, 2])]) : b,
  );
  await assert.rejects(decodeWebp(alphaOnly, 1), /WEBP_/);
});

test("WebP RIFF/tile/canvas/unsupported color and metadata failures cannot become model sources", async () => {
  const original = fixture("webp-lossy.webp"),
    bad = [];
  bad.push(
    Buffer.concat([original, Buffer.from([0])]),
    original.subarray(0, -1),
  );
  bad.push(
    rewriteChunks(original, (type, b) => {
      if (type === "VP8X") b[1] = 1;
      return b;
    }),
  );
  bad.push(
    rewriteChunks(original, (type, b) => {
      if (type === "VP8X") {
        b[4] = 255;
        b[5] = 255;
        b[6] = 255;
      }
      return b;
    }),
  );
  bad.push(
    rewriteChunks(original, (type, b) => {
      if (type === "VP8X") b[0] |= 32;
      return b;
    }),
  );
  for (const body of bad) {
    const m = await readMaterial(
      {
        id: "webp",
        name: "bad.webp",
        body,
        size: body.length,
        hash: sha256(body),
      },
      { imageWindow: { tile: 1 } },
    );
    assert.equal(m.segments.length, 0);
    assert.ok(["failed", "unsupported"].includes(m.state));
  }
  await assert.rejects(decodeWebp(original, 0), /IMAGE_CURSOR_OUT_OF_RANGE/);
});

test("WebP tool missing or protocol/hash mismatch fails closed in an isolated module tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-webp-no-tool-"));
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}');
    for (const name of [
      "webp.mjs",
      "material.mjs",
      "image.mjs",
      "archive-window.mjs",
      "pdf-window.mjs",
    ])
      await copyFile(
        new URL("./" + name, import.meta.url),
        join(directory, name),
      );
    const reader = await import(pathToFileURL(join(directory, "webp.mjs")));
    await assert.rejects(
      reader.decodeWebp(fixture("webp-lossless.webp"), 1),
      /NATIVE_WEBP_UNSUPPORTED/,
    );
    await mkdir(join(directory, "generated-webp"));
    await writeFile(
      join(directory, "generated-webp/manifest.json"),
      JSON.stringify({
        protocol: "shixu-webp/3",
        platform: process.platform + "-" + process.arch,
        sourceSha256: "wrong",
        toolSha256: "wrong",
      }),
    );
    await assert.rejects(
      reader.decodeWebp(fixture("webp-lossless.webp"), 1),
      /NATIVE_WEBP_UNSUPPORTED/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archived WebP preserves four complete frame pixel hashes, original path, cumulative cursor and the trailing member", async () => {
  const child = fixture("webp-animation.webp"),
    body = zipBytes({
      "animation.webp": child,
      "tail.txt": Buffer.from("尾部唯一标记"),
    });
  const verifier = Object.create(ReadingWindows.prototype);
  let cursor = FIRST_ARCHIVE_WINDOW,
    frames = [],
    tail = false;
  while (cursor) {
    const m = await readMaterial(
      {
        id: "archive",
        name: "animation.zip",
        body,
        size: body.length,
        hash: sha256(body),
      },
      { archiveWindow: cursor },
    );
    verifier.verify(m, undefined, cursor);
    for (const s of m.segments) {
      if (s.image) {
        assert.equal(s.range.archivePath, "animation.webp");
        frames.push(
          sha256(decodePng(Buffer.from(s.image.data, "base64")).pixels),
        );
      } else {
        assert.equal(s.text, "尾部唯一标记");
        tail = true;
      }
    }
    cursor = m.archivePagination.next;
  }
  assert.deepEqual(
    frames,
    goldens["webp-animation.webp"].frames.map((f) => f.pixelsHash),
  );
  assert.equal(tail, true);
});
