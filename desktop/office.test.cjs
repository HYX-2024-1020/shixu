const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { readOffice } = require("./office.cjs");
test("legacy Word, Excel and PowerPoint: genuine Apache Tika fixtures", async () => {
  for (const [file, extension, expected] of [
    ["testWORD.doc", "doc", "Sample Word Document Title"],
    ["testEXCEL.xls", "xls", "Numbers and their Squares"],
    ["testPPT.ppt", "ppt", "Sample Powerpoint Slide"],
  ]) {
    const text = await readOffice(
      await fs.readFile(path.join(__dirname, "fixtures", file)),
      extension,
    );
    assert.ok(text.includes(expected), file);
  }
});
test("damaged legacy Office fails transparently instead of running the file", async () => {
  for (const extension of ["doc", "xls", "ppt"])
    await assert.rejects(readOffice(Buffer.from("invalid data"), extension));
});
