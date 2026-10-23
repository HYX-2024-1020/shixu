import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { Resvg } from "@resvg/resvg-js";

function samplePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["First page: meeting at 15:00", "Second page: bring the report"].map(
      (t) => {
        const stream = `BT /F1 20 Tf 24 240 Td (${t}) Tj ET`;
        return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
      },
    ),
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  result += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
const png = new Resvg(await readFile("desktop/fixtures/teacher-notice.svg"))
  .render()
  .asPng();
const docx = zipSync({
  "word/document.xml": strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>报告正文：提交 PDF，并附实验数据。</w:t></w:r></w:p></w:body></w:document>',
  ),
});
const files = [
  ["通知.png", "image/png", png],
  ["会议.pdf", "application/pdf", samplePdf()],
  [
    "报告.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docx,
  ],
  [
    "预算.csv",
    "text/csv",
    strToU8("项目,金额\n材料,120\n<script>alert('x')</script>,0"),
  ],
  [
    "材料.zip",
    "application/zip",
    zipSync({ "提纲.txt": strToU8("压缩包里的实验提纲") }),
  ],
].map(([name, type, bytes], i) => ({
  id: `file-${i}`,
  name,
  type,
  size: bytes.length,
  bytes: [...bytes],
}));
const profile = await mkdtemp(path.join(tmpdir(), "shixu-preview-test-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  const downloads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.evaluate(async (files) => {
    const now = new Date().toISOString();
    await window.desktop.store("savePackets", [
      {
        id: "preview-packet",
        text: "按通知准备报告。",
        sources: [
          {
            id: "zip-source",
            name: "材料.zip / 提纲.txt",
            text: "压缩包里的实验提纲",
          },
        ],
        attachments: files.map((f) => ({
          ...f,
          bytes: Uint8Array.from(f.bytes).buffer,
        })),
        capturedAt: now,
        updatedAt: now,
        captureDate: now.slice(0, 10),
        status: "ready",
        error: "",
        doneIds: [],
        itemIds: ["preview-item"],
        result: {
          summary: "准备报告",
          warnings: [],
          items: [
            {
              kind: "task",
              title: "准备实验报告",
              summary: "提交 PDF，并附实验数据。",
              facts: ["提交 PDF", "附实验数据"],
              sourceIds: ["zip-source"],
              evidence: [],
              nextSteps: [],
              uncertainties: ["没有提供具体时刻"],
              due: null,
            },
          ],
        },
      },
    ]);
  }, files);
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.locator(".card-source-link").click();
  const dialog = page.getByRole("dialog", { name: "同行材料" });
  await expect
    .poll(() =>
      dialog
        .locator(".preview-image")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBeTruthy();
  await dialog.getByRole("button", { name: "会议.pdf", exact: true }).click();
  await expect(dialog.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "下一页", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(dialog.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "上一页", exact: true }),
  ).toBeEnabled();
  assert.ok(
    await dialog.locator("canvas").evaluate(
      (c) =>
        c.width > 0 &&
        c
          .getContext("2d")
          .getImageData(0, 0, c.width, c.height)
          .data.some((value, i) => i % 4 !== 3 && value < 200),
    ),
  );
  await page.screenshot({ path: "release/desktop-preview-pdf.png" });
  await dialog.getByRole("button", { name: "报告.docx", exact: true }).click();
  await expect(dialog.locator(".attachment-preview pre")).toContainText(
    "报告正文：提交 PDF，并附实验数据。",
  );
  await dialog.getByRole("button", { name: "预算.csv", exact: true }).click();
  await expect(dialog.locator(".attachment-preview pre")).toContainText(
    "<script>alert('x')</script>",
  );
  await dialog.getByRole("button", { name: "材料.zip", exact: true }).click();
  await expect(dialog.locator(".attachment-preview pre")).toContainText(
    "压缩包里的实验提纲",
  );
  // Change files repeatedly, including while PDF is loading, to exercise cancellation.
  await dialog.getByRole("button", { name: "会议.pdf", exact: true }).click();
  await dialog.getByRole("button", { name: "通知.png", exact: true }).click();
  await expect(dialog.locator(".preview-image")).toBeVisible();
  await page.screenshot({ path: "release/desktop-preview-image.png" });
  assert.deepEqual(downloads, []);
  assert.deepEqual(errors, []);
  assert.equal(await page.getByText(/处待确认|待确认：/).count(), 0);
  console.log(
    "PASS: automatic image preview, two PDF pages rendered, DOCX text, CSV as inert text, archive contents, cancellation; no downloads or runtime errors",
  );
} finally {
  await app.close();
}
