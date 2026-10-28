import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import assert from "node:assert/strict";
test(
  "signed Windows workspace and real mini Page stop/continue the same v4 task and synchronize original-backed output",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-v4-client-loop-"));
    try {
      await runClientLoop({
        directory,
        reader: async (file) => readMaterial(file),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "DOCX original survives cross-device stop/continue and publishes identical partial coverage and source coordinates to Windows and mini Page",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-docx-client-loop-"));
    try {
      await runClientLoop({
        directory,
        reader: async (file) => readMaterial(file),
        original: {
          name: "合成.docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          body: docxBytes(
            paragraph("合成报告要求与顺序😀。\n".repeat(20000)) +
              "<w:tbl><w:tr><w:tc>" +
              paragraph("尾部唯一标记") +
              "</w:tc></w:tr></w:tbl>",
            { "word/media/image1.png": Buffer.from("image not OCRed") },
          ),
          verify({ win, page }) {
            assert.equal(win.readingCoverage[0].state, "partial");
            assert.ok(
              win.readingCoverage[0].uncovered.some(
                (r) => r.code === "DOCX_OBJECT_UNREAD",
              ),
            );
            assert.ok(
              win.readingCoverage[0].covered.some(
                (r) => r.table === 1 && r.row === 1 && r.column === 1,
              ),
            );
            assert.ok(!JSON.stringify(win.sources).includes("合成报告"));
            const detail = page._detail(win.itemIds[0]);
            assert.equal(detail.reading[0].label, "部分读取");
            assert.match(
              detail.reading[0].missing,
              /图片、公式或嵌入对象尚未读取/,
            );
            assert.match(
              detail.evidence[0].name,
              /word\/document.xml.*第 1 段/,
            );
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
