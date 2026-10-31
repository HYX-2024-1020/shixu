import test from "node:test";
import assert from "node:assert/strict";
import { officeImageBytes } from "./office-fixtures.mjs";
import { readMaterial, sha256 } from "./material.mjs";
import { decodePng } from "./image.mjs";
import { FIRST_OFFICE_WINDOW, validateOfficeWindow } from "./office-window.mjs";
import { ReadingWindows } from "./windows.mjs";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
const usage = { prompt_tokens: 10, completion_tokens: 10 };
for (const format of ["docx", "xlsx"])
  test(`${format} text windows and every original image pixel retain exact source anchors and tail`, async () => {
    const fixture = officeImageBytes(format),
      body = fixture.body,
      file = {
        id: "office",
        name: "合成." + format,
        body,
        size: body.length,
        hash: sha256(body),
      };
    const legacy = await readMaterial(file),
      expected = legacy.segments.map((s) => s.text).join("");
    let text = "",
      window = FIRST_OFFICE_WINDOW,
      images = 0;
    const pixels = Buffer.alloc(fixture.width * 4),
      verifier = Object.create(ReadingWindows.prototype);
    for (let n = 0; window && n < 20; n++) {
      const material = await readMaterial(file, {
        officeWindow: window,
        windowCodepoints: 7,
      });
      // The transport verifies the configured 120000-codepoint product window;
      // use product size below, small standalone windows only test text stitching.
      if (!window.text) {
        verifier.verifyOffice(material, window);
        const s = material.segments[0],
          r = s.range;
        images++;
        assert.equal(
          r.mediaPart,
          `${format === "docx" ? "word" : "xl"}/media/图像.png`,
        );
        assert.equal(r.officeKind, format);
        if (format === "docx") assert.equal(r.paragraph, 2);
        else assert.equal(r.cell, "B3");
        decodePng(Buffer.from(s.image.data, "base64")).pixels.copy(
          pixels,
          r.x * 4,
        );
      } else text += material.segments.map((s) => s.text).join("");
      window = material.officePagination.next;
    }
    assert.equal(text, expected);
    assert.ok(text.includes("尾部唯一标记"));
    assert.equal(images, 3);
    assert.deepEqual(pixels, fixture.pixels);
    assert.throws(
      () =>
        validateOfficeWindow({
          ...FIRST_OFFICE_WINDOW,
          path: "word/media/a.png",
        }),
      /INVALID_OFFICE_WINDOW/,
    );
  });
for (const format of ["docx", "xlsx"])
  test(`${format} kernel stops, revalidates and bills only unfinished text/image/review work`, async (t) => {
    const sample = officeImageBytes(format);
    let organize = 0,
      reviews = 0;
    const provider = Object.assign(
      async (sources) => {
        organize++;
        return {
          usage,
          result: {
            summary: "合成Office",
            warnings: [],
            items: [
              {
                kind: "note",
                title: "合成来源",
                summary: "",
                facts: [],
                nextSteps: [],
                uncertainties: [],
                due: null,
                evidence: [
                  {
                    sourceId: sources[0].id,
                    quote: sources[0].image
                      ? "合成图像文字"
                      : sources[0].text.slice(0, 8),
                  },
                ],
              },
            ],
          },
        };
      },
      {
        imageInput: true,
        reviewVisual: async (sources) => {
          reviews++;
          return {
            usage,
            result: {
              claims: JSON.parse(sources[0].text).claims.map((c) => ({
                id: c.id,
                status: "supported",
                reason: "",
              })),
            },
          };
        },
      },
    );
    const f = mergeFixture(t, {
      provider,
      sourceName: "合成." + format,
      sourceBytes: sample.body,
      reader: Object.assign((file, o) => readMaterial(file, o), {
        pdfWindows: true,
        imageWindows: true,
        officeWindows: true,
      }),
    });
    f.enqueue();
    await f.tasks.run("task");
    f.action("stop");
    const spent = f.ledger.wallet("synthetic").spent;
    assert.equal(spent, 20);
    f.action("continue");
    assert.equal(
      (await finishMerge(f.tasks)).state,
      "done",
      JSON.stringify(f.tasks.get("task")),
    );
    assert.equal(organize, 4);
    assert.equal(reviews, 3);
    assert.equal(f.ledger.wallet("synthetic").spent, 140);
    const coverage = f.store.record("packet").data.readingCoverage[0];
    assert.equal(coverage.officePagination.next, null);
    assert.equal(coverage.covered.filter((r) => r.kind === "image").length, 3);
    assert.ok(!coverage.uncovered.some((r) => /WINDOW_PENDING/.test(r.code)));
    assert.equal(coverage.officeImageParts[0].checked, 3);
  });
test("Office JPEG orientation and animated GIF/WebP retain every codec tile and timing without interpreting layout", async () => {
  const { jpegSample } = await import("./jpeg-fixtures.mjs"),
    { gifBytes } = await import("./gif-fixtures.mjs"),
    { readFile } = await import("node:fs/promises");
  for (const [extension, body] of [
    ["jpg", jpegSample({ width: 4, height: 2051, orientation: 6 }).body],
    [
      "gif",
      gifBytes({
        width: 2051,
        height: 1,
        frames: [
          { indices: Buffer.alloc(2051, 1), delay: 10 },
          { indices: Buffer.alloc(2051, 2), delay: 20 },
        ],
      }),
    ],
    [
      "webp",
      await readFile(
        new URL("./fixtures/webp-animation.webp", import.meta.url),
      ),
    ],
  ]) {
    const sample = officeImageBytes("docx", {
        body,
        imageExtension: extension,
      }),
      file = {
        id: "office",
        name: "合成.docx",
        body: sample.body,
        size: sample.body.length,
        hash: sha256(sample.body),
      };
    const first = await readMaterial(file, {
      officeWindow: FIRST_OFFICE_WINDOW,
    });
    let window = first.officePagination.next,
      count = 0;
    while (window) {
      const material = await readMaterial(file, { officeWindow: window });
      Object.create(ReadingWindows.prototype).verifyOffice(material, window);
      const top = await readMaterial(
        {
          id: "raw",
          name: "image." + extension,
          body,
          size: body.length,
          hash: sha256(body),
        },
        { imageWindow: { tile: window.tile } },
      );
      assert.equal(material.segments[0].image.hash, top.segments[0].image.hash);
      assert.equal(material.covered[0].frame, top.covered[0].frame);
      assert.equal(
        material.covered[0].frameDurationMs,
        top.covered[0].frameDurationMs,
      );
      assert.equal(material.covered[0].orientation, top.covered[0].orientation);
      assert.equal(
        material.covered[0].mediaPart,
        "word/media/图像." + extension,
      );
      window = material.officePagination.next;
      count++;
    }
    assert.ok(count >= 1);
  }
});
test("images in hidden sheets retain that visibility in both source and model context", async () => {
  const body = officeImageBytes("xlsx", { visibility: "hidden" }).body,
    file = {
      id: "hidden",
      name: "隐藏.xlsx",
      body,
      size: body.length,
      hash: sha256(body),
    };
  const text = await readMaterial(file, { officeWindow: FIRST_OFFICE_WINDOW });
  const image = await readMaterial(file, {
    officeWindow: text.officePagination.next,
  });
  assert.equal(image.covered[0].hiddenSheet, "hidden");
  assert.match(image.segments[0].text, /隐藏工作表/);
  const { sourceLocation } = await import("../../shared/reading-view.mjs");
  assert.match(
    sourceLocation([image], image.segments[0].sourceId),
    /隐藏工作表/,
  );
});
