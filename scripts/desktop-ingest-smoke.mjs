import { waitForPageState } from "./desktop-test-wait.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-ingest-test-")),
  env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  const imageRequests = [];
  let blankMode = false;
  await page.route("https://api.deepseek.com/**", async (route) => {
    const body = route.request().postDataJSON();
    let output;
    if (Array.isArray(body.messages?.[1]?.content)) {
      imageRequests.push(body);
      output = {
        text: blankMode ? "" : "明天交报告，提交电子版。",
        uncertainties: ["右下角字迹模糊"],
      };
    } else {
      const data = JSON.parse(body.messages?.[1]?.content || "{}");
      output = {
        summary: "模拟整理：收下混合材料",
        items: (data.sources || []).map((s, i) => ({
          kind: i === 0 ? "notice" : "task",
          title: "事项 " + i,
          summary: "模拟接口用于验证来源映射",
          facts: [],
          nextSteps: [],
          uncertainties: [],
          evidence: [{ sourceId: s.id, quote: s.text.slice(0, 100) }],
          sourceIds: [s.id],
          due: null,
          importance: 1,
          group: "测试课程",
        })),
        warnings: [],
        links: [],
      };
    }
    await route.fulfill({
      json: {
        model: "deepseek-flash",
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(output) },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      },
    });
  });
  await page.evaluate(async () => {
    await window.desktop.key("save", "dummy-key-for-mocked-api");
  });
  await page.reload();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  const word = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>明天交报告，文件名为学号。</w:t></w:r></w:p></w:document>',
    ),
  });
  const sheet = zipSync({
    "xl/sharedStrings.xml": strToU8("<sst><si><t>姓名</t></si></sst>"),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    ),
  });
  const slides = zipSync({
    "ppt/slides/slide1.xml": strToU8(
      '<p:sp xmlns:p="urn:p" xmlns:a="urn:a"><a:t>课堂报告要求</a:t></p:sp>',
    ),
  });
  // Minimal blank PDF forces the scanned-page rendering path.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    "xref\n0 5\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const { readFile } = await import("node:fs/promises");
  const zip = zipSync({
    "要求.docx": word,
    "成绩.xlsx": sheet,
    "讲义.pptx": slides,
    "扫描页.pdf": strToU8(pdf),
    "截图.png": await readFile("public/icon-192.png"),
    "不能读取.exe": strToU8("not executed"),
    "源代码.py": strToU8('print("只读资料，不执行")'),
    "旧版.doc": await readFile("desktop/fixtures/testWORD.doc"),
    "旧表.xls": await readFile("desktop/fixtures/testEXCEL.xls"),
    "旧幻灯片.ppt": await readFile("desktop/fixtures/testPPT.ppt"),
  });
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("按附件要求完成作业");
  await page.locator("input[type=file]").setInputFiles({
    name: "课程材料.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  await page
    .getByRole("heading", { name: "部分完成 · 有未读内容", exact: true })
    .waitFor();
  const [packet] = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(packet.status, "ready");
  assert.ok(
    packet.coverage.some(
      (c) => c.name.includes("不能读取.exe") && c.state === "failed",
    ),
  );
  for (const name of [
    "要求.docx",
    "成绩.xlsx",
    "讲义.pptx",
    "扫描页.pdf",
    "截图.png",
    "源代码.py",
    "旧版.doc",
    "旧表.xls",
    "旧幻灯片.ppt",
  ])
    assert.ok(
      packet.coverage.some((c) => c.name.includes(name) && c.state === "read"),
      name,
    );
  assert.equal(
    imageRequests.length,
    2,
    "standalone image and scanned PDF must use image content blocks",
  );
  assert.ok(
    packet.sources.some(
      (s) => s.name.includes("扫描页.pdf") && s.name.includes("第 1 页"),
    ),
  );
  assert.ok(packet.itemIds.length === packet.result.items.length);
  await page
    .getByRole("button", { name: "重试未读内容（保留已有修正）", exact: true })
    .click();
  await waitForPageState(page, async () => {
    const [p] = await window.desktop.store("packets");
    return (
      p.status === "ready" && !p.retryUnread && p.error?.includes("仍未能读取")
    );
  });
  const [retried] = await page.evaluate(() => window.desktop.store("packets"));
  assert.deepEqual(
    retried.itemIds,
    packet.itemIds,
    "retry must preserve item identity",
  );
  assert.equal(
    imageRequests.length,
    2,
    "successful OCR pages must be reused on retry",
  );
  await page.getByText("核对 / 修正提取与识别文字", { exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /^课程材料\.zip \/ 截图\.png$/ })
    .click();
  await page
    .getByLabel("修正 课程材料.zip / 截图.png", { exact: true })
    .fill("人工确认：明天提交报告，不需纸质版。");
  await page.getByRole("button", { name: "保存转写修正", exact: true }).click();
  await waitForPageState(page, async () => {
    const [p] = await window.desktop.store("packets");
    return p.sources.some(
      (s) =>
        s.name.includes("截图.png") &&
        s.text.includes("不需纸质版") &&
        s.originalText,
    );
  });
  await page.getByRole("button", { name: "关闭整理记录", exact: true }).click();
  await page.getByRole("button", { name: "投递桶", exact: true }).click();
  blankMode = true;
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("");
  await page.locator("input[type=file]").setInputFiles({
    name: "空白截图.png",
    mimeType: "image/png",
    buffer: await readFile("public/desktop-icon.png"),
  });
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await waitForPageState(page, async () =>
    (await window.desktop.store("packets")).some(
      (p) =>
        p.attachments.some((a) => a.name === "空白截图.png") &&
        p.status === "error" &&
        p.coverage.some(
          (c) => c.state === "failed" && c.detail.includes("未识别出可靠文字"),
        ),
    ),
  );
  const usage = await page.evaluate(() => window.desktop.store("usage"));
  assert.ok(usage.length >= 3);
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  await page
    .getByRole("button", { name: "查看这次整理出的内容", exact: true })
    .click();
  await page.locator(".result-card").first().waitFor();
  await page.screenshot({ path: "release/desktop-ingest.png" });
  console.log(
    "PASS (mocked model): text + ZIP/DOCX/XLSX/PPTX/code/image/scanned PDF, image blocks, per-file partial coverage, source/page mapping and usage",
  );
} finally {
  await app.close();
}
