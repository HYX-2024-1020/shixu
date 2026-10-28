import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";
import { docxBytes, paragraph } from "./docx-fixtures.mjs";
import { xlsxBytes, inline } from "./xlsx-fixtures.mjs";
import assert from "node:assert/strict";

for (const quota of [1, 500 * 1024 * 1024])
  test(
    `mini-originated manifest crosses both clients with ${quota === 1 ? "temporary cleanup/reupload" : "retention/renew/download"} and deletion preserving publication`,
    { timeout: 20000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "shixu-original-client-loop-"),
      );
      try {
        await runClientLoop({
          directory,
          reader: async (f) => readMaterial(f),
          originalQuota: quota,
          sourceByMini: true,
          verifyLifecycle: true,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
test(
  "Windows original save failure retains only session bytes, explicitly confirms temporary mode and can reupload/continue without losing paid progress",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "shixu-original-volatile-loop-"),
    );
    try {
      await runClientLoop({
        directory,
        reader: async (f) => readMaterial(f),
        originalQuota: 1,
        failLocalWrite: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "XLSX original crosses signed Windows and actual mini Page stop/continue, retaining worksheet coordinates and formula-cache omissions",
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-xlsx-client-loop-"));
    try {
      await runClientLoop({
        directory,
        reader: async (file) => readMaterial(file),
        original: {
          name: "合成.xlsx",
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: xlsxBytes([
            {
              name: "资料表",
              xml: `<row r="1">${inline("A1", "合成单元格😀。\n".repeat(18000))}</row><row r="7"><c r="C7"><f>1+1</f><v>999</v></c>${inline("D7", "尾部唯一标记")}</row>`,
            },
          ]),
          verify({ win, page }) {
            const coverage = win.readingCoverage[0];
            assert.equal(coverage.state, "partial");
            assert.ok(
              coverage.covered.some(
                (r) =>
                  r.sheet === "资料表" &&
                  r.row === 7 &&
                  r.column === 3 &&
                  r.columnEnd === 4,
              ),
            );
            assert.ok(
              coverage.uncovered.some(
                (r) => r.code === "XLSX_FORMULA_CACHED" && r.cell === "C7",
              ),
            );
            assert.ok(
              coverage.covered.every((r) => typeof r.part === "string"),
            );
            const detail = page._detail(win.itemIds[0]);
            assert.match(detail.reading[0].missing, /公式未执行/);
            assert.match(detail.evidence[0].name, /工作表 “资料表”.*第 1 行/);
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
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
