import test from "node:test";
import assert from "node:assert/strict";
import { openPackage } from "./ooxml-zip.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const scanOfficeImages = (pkg, format, parts) =>
  require("./" + format + "-reader.cjs").scanOfficeImages(pkg, format, parts);
import { officeImageBytes } from "./office-fixtures.mjs";
const parts = (format) =>
  format === "docx"
    ? ["word/document.xml"]
    : [{ part: "xl/worksheets/sheet1.xml", name: "图像工作表", id: "1" }];
for (const format of ["docx", "xlsx"])
  test(`${format} image references preserve exact media names and document/cell anchors`, () => {
    const { body } = officeImageBytes(format);
    const pkg = openPackage(body),
      plan = scanOfficeImages(pkg, format, parts(format));
    assert.deepEqual(plan.missing, []);
    assert.equal(plan.images.length, 1);
    const ref = plan.images[0];
    assert.equal(
      ref.mediaPart,
      `${format === "docx" ? "word" : "xl"}/media/图像.png`,
    );
    assert.equal(ref.relationship, "image1");
    if (format === "docx") assert.equal(ref.paragraph, 2);
    else {
      assert.equal(ref.sheet, "图像工作表");
      assert.equal(ref.cell, "B3");
      assert.equal(ref.cellEnd, "E7");
    }
  });
for (const format of ["docx", "xlsx"])
  test(`${format} ambiguous, external, escaping and damaged references cannot supply image payloads`, () => {
    for (const options of [
      { duplicate: true },
      { external: true, imageTarget: "https://example.invalid/private.png" },
      { imageTarget: "../../../outside.png" },
      { drawingSuffix: "<broken>" },
    ]) {
      const { body } = officeImageBytes(format, options);
      const plan = scanOfficeImages(openPackage(body), format, parts(format));
      assert.equal(plan.images.length, 0, JSON.stringify(options));
      assert.ok(plan.missing.length);
    }
  });
