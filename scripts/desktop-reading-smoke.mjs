import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(join(tmpdir(), "shixu-reading-ui-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    await window.desktop.store("savePackets", [
      {
        id: "reading-fixture",
        text: "",
        sources: [],
        attachments: [],
        capturedAt: "2026-10-28T00:00:00Z",
        captureDate: "2026-10-28",
        updatedAt: "2026-10-28T00:00:00Z",
        status: "ready",
        error: "",
        doneIds: [],
        itemIds: ["reading-item"],
        readingCoverage: [
          {
            attachmentId: "a",
            name: "合成表.csv",
            state: "partial",
            covered: [{ sourceId: "row", kind: "csv", row: 1, rowEnd: 2 }],
            uncovered: [{ kind: "csv", row: 3, code: "CSV_MALFORMED" }],
            reasons: ["CSV_MALFORMED"],
          },
        ],
        result: {
          summary: "合成",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "合成读取结果",
              summary: "合成安全部分",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [{ sourceId: "row", quote: "合成依据" }],
              sourceIds: ["row"],
            },
          ],
        },
      },
    ]);
  });
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByRole("button", { name: "输入原文", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "同行材料", exact: true });
  await expect(dialog.getByText("合成表.csv · 部分读取")).toBeVisible();
  await expect(dialog.getByText("CSV 第 3 行：CSV 行或引号损坏")).toBeVisible();
  const packets = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(
    packets.find((p) => p.id === "reading-fixture").readingCoverage[0].state,
    "partial",
  );
  console.log(
    "PASS: isolated Windows source UI preserves server coverage through IPC/storage/reload and displays partial ranges. No live model or installed-client update.",
  );
} finally {
  await app.close();
  assert.ok(
    resolve(profile).startsWith(resolve(tmpdir()) + sep) &&
      profile.includes("shixu-reading-ui-"),
  );
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
