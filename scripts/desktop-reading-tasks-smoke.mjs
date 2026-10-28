import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountUIFixture } from "./account-ui-fixture.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { docxBytes, paragraph } from "../server/reading/docx-fixtures.mjs";
import { xlsxBytes, inline } from "../server/reading/xlsx-fixtures.mjs";
import { pdfBytes } from "../server/reading/pdf-fixtures.mjs";
import { archiveSample } from "../server/reading/archive-fixtures.mjs";
const zip = process.argv.includes("--zip");
const pdf = process.argv.includes("--pdf");
const docx = process.argv.includes("--docx");
const xlsx = process.argv.includes("--xlsx");
const temporary = process.argv.includes("--temporary");
const lifecycle = process.argv.includes("--originals") || temporary;
const readFailure = process.argv.includes("--reader-limit")
  ? "EXECUTION_LIMIT"
  : process.argv.includes("--reader-time-unknown")
    ? "ACTIVE_TIME_RECONCILIATION"
    : null;
const original = zip ? (() => {
  const f = archiveSample({ long: true });
  return { name: f.name, type: f.type, body: [...f.body] };
})() : pdf
  ? {
      name: "合成.pdf",
      type: "application/pdf",
      body: [
        ...pdfBytes(
          [
            ...Array.from({ length: 180 }, (_, i) => ({
              text: `第${i + 1}页合成完整材料😀。\n`.repeat(100),
            })),
            { text: "" },
            { text: "尾部标记", rotation: 90 },
          ],
          { compress: true },
        ),
      ],
    }
  : xlsx
    ? {
        name: "合成.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: [
          ...xlsxBytes([
            {
              name: "资料表",
              xml: `<row r="1">${inline("A1", "合成完整材料😀。\n".repeat(16000))}</row><row r="7"><c r="C7"><f>1+1</f><v>999</v></c>${inline("D7", "尾部标记")}</row>`,
            },
          ]),
        ],
      }
    : docx
      ? {
          name: "合成.docx",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          body: [
            ...docxBytes(
              paragraph("合成完整材料😀。\n".repeat(16000)) +
                "<w:tbl><w:tr><w:tc>" +
                paragraph("尾部标记") +
                "</w:tc></w:tr></w:tbl>",
              { "word/media/image1.png": Buffer.from("not OCRed") },
            ),
          ],
        }
      : null;
const root = await mkdtemp(join(tmpdir(), "shixu-v4-ui-ledger-"));
const ledger = new ReadingLedger(join(root, "ledger.sqlite"));
ledger.freezePrice({
  id: "fixture",
  model: "fixture",
  currency: "CNY",
  source: "synthetic UI fixture",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 100000,
  outputMicrosPerMillion: 1000000,
});
let calls = 0;
const reading = {
  ...(temporary ? { originals: { quota: 1 } } : {}),
  enabled: true,
  ledger,
  ...(readFailure === "EXECUTION_LIMIT" ? { activeLimitMs: 80 } : {}),
  reader: async (f, { signal }) => {
    if (readFailure === "ACTIVE_TIME_RECONCILIATION")
      throw Object.assign(Error("READING_CANCEL_UNCONFIRMED"), {
        timingUncertain: true,
      });
    if (readFailure === "EXECUTION_LIMIT")
      return new Promise((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () =>
            reject(
              Object.assign(Error("READING_ABORTED"), {
                timing: { waitingMs: 0 },
              }),
            ),
          { once: true },
        ),
      );
    return readMaterial(f);
  },
  priceId: "fixture",
  modelVersion: "synthetic/1",
  provider: async (sources, signal) => {
    if (++calls === 1)
      await new Promise((done) => {
        signal.addEventListener("abort", () => setTimeout(done, 30), {
          once: true,
        });
      });
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        summary: "合成摘要",
        warnings: [],
        items: [
          {
            kind: "note",
            title: "原件整理事项",
            summary: "保留来源",
            facts: [],
            nextSteps: [],
            uncertainties: [],
            due: null,
            evidence: [
              { sourceId: sources[0].id, quote: sources[0].text.slice(0, 10) },
            ],
          },
        ],
      },
    };
  },
};
const fixture = await accountUIFixture({}, { reading });
ledger.grantInitial(fixture.invitation.userId);
const remote = process.env.SHIXU_SYNTHETIC_REMOTE_ORIGIN;
if (remote) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(remote) ||
    !process.env.SHIXU_SYNTHETIC_REMOTE_INVITE
  )
    throw Error("SYNTHETIC_TUNNEL_REQUIRED");
  fixture.env.SHIXU_TEST_SERVICE_ORIGIN = remote;
}
delete fixture.env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env: fixture.env });
  const page = await app.firstWindow();
  if (remote) {
    await page
      .getByRole("textbox", { name: "往桶里放入内容", exact: true })
      .waitFor();
    await page.locator(".bucket-settings").click();
    await page
      .getByLabel("邀请码", { exact: true })
      .fill(process.env.SHIXU_SYNTHETIC_REMOTE_INVITE);
    await page.getByRole("button", { name: "激活此设备", exact: true }).click();
    await waitForPageState(
      page,
      async () => !!(await window.desktop.cloud("status")).base,
    );
    await page.getByRole("dialog").waitFor({ state: "detached" });
  } else await fixture.activate(page);
  await page.evaluate(async (original) => {
    const bytes = original
      ? Uint8Array.from(original.body).buffer
      : new TextEncoder().encode(
          "合成完整材料😀。\n".repeat(16000) + "尾部标记",
        ).buffer;
    await window.desktop.store("savePackets", [
      {
        id: "task-ui",
        text: "",
        sources: [],
        attachments: [
          {
            id: "original",
            name: original?.name || "合成.txt",
            type: original?.type || "text/plain",
            bytes,
          },
        ],
        doneIds: [],
        capturedAt: "2026-10-28T00:00:00.000Z",
        captureDate: "2026-10-28",
        updatedAt: "2026-10-28T00:00:00.000Z",
        result: null,
        status: "pending",
      },
    ]);
    await window.desktop.cloud("sync");
    await window.desktop.cloud("ai", {
      kind: "organize",
      packetId: "task-ui",
    });
  }, original);
  await page.locator(".bucket-settings").click();
  if (readFailure) {
    await waitForPageState(
      page,
      async (reason) => {
        await window.desktop.cloud("sync");
        return (
          (await window.desktop.cloud("status")).jobs[0]?.reason === reason
        );
      },
      readFailure,
    );
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await expect(
      page.getByText(
        readFailure === "EXECUTION_LIMIT"
          ? /累计活跃时间已用尽/
          : /任务活跃时间待核对/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toHaveCount(0);
    const status = await page.evaluate(() => window.desktop.cloud("status"));
    assert.equal(status.jobs[0].calls, 0);
    assert.equal(calls, 0);
    assert.ok(status.jobs[0].actions.includes("purge"));
    assert.equal(status.account.wallet.spent, 0);
    console.log(
      JSON.stringify({
        synthetic: true,
        realProviderCalls: 0,
        electronSourceUI: true,
        readFailure,
        noContinue: true,
        noChargeOrPublication: true,
      }),
    );
  } else {
    await expect(page.getByText(/累计已消费/)).toBeVisible();
    if (!remote)
      await expect.poll(() => calls, { timeout: 20000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.getByText(/已停止 · 本任务已调用/)).toBeVisible();
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await waitForPageState(page, async () => {
      await window.desktop.cloud("sync");
      return (
        (await window.desktop.store("packets")).find((p) => p.id === "task-ui")
          ?.result?.items?.length > 0
      );
    });
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await expect(page.getByText(/已发布 · 本任务已调用/)).toBeVisible();
    await expect(
      page.getByText(/该投递累计 \d+ 次 · 活跃 \d+ 秒/),
    ).toBeVisible();
    const status = await page.evaluate(() => window.desktop.cloud("status"));
    assert.ok(status.account.wallet.spent > 0);
    assert.ok(status.jobs.find((j) => j.packetId === "task-ui")?.calls > 1);
    if (lifecycle) {
      await page.getByRole("button", { name: "立即同步", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "云端原件", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(
        page.getByRole("button", { name: "删除云端原件", exact: true }),
      ).toBeDisabled();
      if (!temporary) {
        await expect(
          page.getByRole("button", { name: "续期30天", exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "下载到本机", exact: true }),
        ).toBeDisabled();
      }
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(
        page.getByRole("button", { name: "删除云端原件", exact: true }),
      ).toBeEnabled();
      if (temporary)
        await expect(
          page.getByText((original?.name || "合成.txt") + " · 临时整理，退出后需重传", { exact: true }),
        ).toBeVisible();
      else {
        const before = (
          await page.evaluate(() => window.desktop.cloud("status"))
        ).originalStorage.originals[0].version;
        await page
          .getByRole("button", { name: "续期30天", exact: true })
          .click();
        await waitForPageState(
          page,
          async (version) =>
            (await window.desktop.cloud("status")).originalStorage.originals[0]
              .version ===
            version + 1,
          before,
        );
        await page
          .getByRole("button", { name: "下载到本机", exact: true })
          .click();
        await expect(
          page.getByText("原件已校验并保存到本机，可从材料面板打开", {
            exact: true,
          }),
        ).toBeVisible();
      }
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "删除云端原件", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "删除云端原件", exact: true }),
      ).toHaveCount(0);
      const storage = (
        await page.evaluate(() => window.desktop.cloud("status"))
      ).originalStorage;
      assert.equal(storage.usedBytes, 0);
      assert.equal(storage.originals[0].state, "deleted");
    }
    if (original) {
      await page.getByRole("button", { name: "关闭设置", exact: true }).click();
      // IPC submission updates the main-process projection; verify persisted
      // cards after the renderer reloads its account workspace.
      await page.reload();
      await expect(
        page.getByRole("textbox", { name: "往桶里放入内容", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "整理结果", exact: true }).click();
      await page
        .getByRole("button", { name: /份同行材料/ })
        .first()
        .click();
      const materials = page.getByRole("dialog", {
        name: "同行材料",
        exact: true,
      });
      await expect(
        materials.getByText(original.name + " · 部分读取"),
      ).toBeVisible();
      if (zip) {
        await expect(materials.getByText(/包内 “未读\/嵌套.zip”.*嵌套归档/)).toBeVisible();
        await expect(materials.getByText(/包内 “页面\/正文.pdf”.*第 2 页/)).toBeVisible();
      } else if (pdf) {
        await expect(
          materials.getByText(/PDF 第 181 页.*未提取到文字/),
        ).toBeVisible();
        await expect(
          materials.getByText(/PDF 第 182 页.*仅提取文字层/),
        ).toBeVisible();
      } else if (xlsx)
        await expect(
          materials.getByText(
            /工作表 “资料表”.*第 7 行.*单元格 C7.*公式未执行/,
          ),
        ).toBeVisible();
      else
        await expect(
          materials.getByText(
            "word/media/image1.png：图片、公式或嵌入对象尚未读取",
            { exact: true },
          ),
        ).toBeVisible();
    }
    console.log(
      JSON.stringify({
        synthetic: true,
        realProviderCalls: 0,
        electronSourceUI: true,
        sshTunnelToIsolatedLinux: !!remote,
        originalUpload: true,
        originalLifecycle: lifecycle,
        originalOfflineLock: lifecycle,
        temporaryCleanupAndReupload: temporary,
        stopContinueButtons: true,
        cumulativeWallet: true,
        published: true,
        format: zip ? "zip" : pdf ? "pdf" : xlsx ? "xlsx" : docx ? "docx" : "txt",
        simulatedCalls: status.jobs.find((j) => j.packetId === "task-ui")
          ?.calls,
      }),
    );
  }
} finally {
  await app?.close();
  await fixture.close();
  ledger.close();
  await rm(root, { recursive: true, force: true });
}
