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
import { pdfBytes, pdfLimitSample, pdfWindowSample } from "../server/reading/pdf-fixtures.mjs";
import { archiveSample, archiveWindowSample } from "../server/reading/archive-fixtures.mjs";
import { nativeArchiveSample } from "../server/reading/native-archive-fixtures.mjs";
import { DatabaseSync } from "node:sqlite";
const archiveWindows = process.argv.includes("--archive-windows");
const safetyRollback = process.argv.includes("--safety-rollback");
const auditTime = process.argv.includes("--audit-time");
const revisionReuse = process.argv.includes("--reuse");
const zip = process.argv.includes("--zip") || revisionReuse;
const nativeFormat=process.argv.includes("--rar")?"rar":process.argv.includes("--7z")?"7z":null;
const pdfLimit = process.argv.includes("--pdf-limit");
const pdfWindows = process.argv.includes("--pdf-windows");
const pdf = process.argv.includes("--pdf") || pdfLimit || pdfWindows;
const docx = process.argv.includes("--docx");
const xlsx = process.argv.includes("--xlsx");
const temporary = process.argv.includes("--temporary");
const lifecycle = process.argv.includes("--originals") || temporary;
const readFailure = process.argv.includes("--reader-limit") || auditTime
  ? "EXECUTION_LIMIT"
  : process.argv.includes("--reader-time-unknown")
    ? "ACTIVE_TIME_RECONCILIATION"
    : null;
const original = archiveWindows ? (()=>{const f=archiveWindowSample();return {name:f.name,type:f.type,body:[...f.body]};})() : nativeFormat ? await (async()=> {
  const f=await nativeArchiveSample(nativeFormat,{long:true});
  return {name:f.name,type:f.type,body:[...f.body]};
})() : zip ? (() => {
  const f = archiveSample({ long: true });
  return { name: f.name, type: f.type, body: [...f.body] };
})() : pdfWindows ? (() => {
  const f=pdfWindowSample();
  return {name:f.name,type:f.type,body:[...f.body]};
})() : pdfLimit ? (() => {
  const f = pdfLimitSample();
  return { name:f.name, type:f.type, body:[...f.body] };
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
let auditedReads = 0;
const reading = {
  ...(auditTime ? {maintenanceAuthorize:({actor,account})=>actor==="synthetic-maintainer" && account===fixture.invitation.userId} : {}),
  ...(temporary ? { originals: { quota: 1 } } : {}),
  enabled: true,
  ledger,
  ...(readFailure === "EXECUTION_LIMIT" ? { activeLimitMs: 80 } : {}),
  reader: Object.assign(async (f, { signal, pdfWindow, archiveWindow }) => {
    if (readFailure === "ACTIVE_TIME_RECONCILIATION")
      throw Object.assign(Error("READING_CANCEL_UNCONFIRMED"), {
        timingUncertain: true,
      });
    if (readFailure === "EXECUTION_LIMIT" && (!auditTime || ++auditedReads === 1))
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
    return readMaterial(f, {pdfWindow,archiveWindow,...(pdfLimit ? {pdfTextUnits:pdfLimitSample().textUnitLimit} : {})});
  }, {pdfWindows:pdfWindows || archiveWindows,archiveWindows}),
  priceId: "fixture",
  modelVersion: "synthetic/1",
  provider: async (sources, signal) => {
    if (++calls === 1 && !auditTime)
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
scenario: try {
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
    if (auditTime) {
      const id=status.jobs[0].id,account=fixture.invitation.userId;
      const review=fixture.service.readingRoutes.maintenanceReview(account,id,"synthetic-maintainer");
      fixture.service.readingRoutes.extendExecutionLimit(account,id,{
        operationId:crypto.randomUUID(),expectedGeneration:review.generation,expectedWatermark:review.watermark,
        newLimitMs:3600000,evidenceHash:"a".repeat(64),
      },"synthetic-maintainer");
      await page.getByRole("button",{name:"立即同步",exact:true}).click();
      await expect(page.getByText(/维护核对已延长本投递时限/)).toBeVisible();
      await page.getByRole("button",{name:"继续",exact:true}).click();
      await waitForPageState(page,async()=>{
        await window.desktop.cloud("sync");
        return (await window.desktop.cloud("status")).jobs[0].state==="done";
      });
      await page.getByRole("button",{name:"立即同步",exact:true}).click();
      await expect(page.getByText(/已发布 · 本任务已调用/)).toBeVisible();
      const after=await page.evaluate(()=>window.desktop.cloud("status"));
      assert.ok(after.jobs[0].rootActiveMs >= review.activeMs);
      assert.equal(after.account.wallet.spent,calls*20);
      if (pdfWindows) {
        await expect(page.getByText(/已检查 19 \/ 19 页/)).toBeVisible();
        const packets=await page.evaluate(()=>window.desktop.store("packets"));
        const coverage=packets.find(p=>p.id==="task-ui").readingCoverage[0];
        assert.equal(coverage.pagination.nextPage,null);assert.equal(coverage.pagination.totalPages,19);
      }
      console.log(JSON.stringify({synthetic:true,realProviderCalls:0,electronSourceUI:true,auditedKnownTime:true,
        explicitContinue:true,rootTimeRetained:true,simulatedCalls:calls,spentMicros:after.account.wallet.spent,
        pdfPageWindows:pdfWindows,temporaryReupload:temporary}));
      break scenario;
    }
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
    if (safetyRollback) {
      await expect.poll(()=>fixture.service.readingRoutes.snapshot().accounts).toBe(0);
      await page.getByRole("button",{name:"立即同步",exact:true}).click();
      const before=await page.evaluate(()=>window.desktop.cloud("status"));
      const task=before.jobs.find(j=>j.packetId==="task-ui");
      assert.ok(task.rootActiveMs > 0);
      const db=new DatabaseSync(join(fixture.root,"server","users",fixture.invitation.userId,"workspace.sqlite"));
      try {db.prepare("UPDATE reading_tasks SET active_ms=0 WHERE id=?").run(task.id);} finally {db.close();}
      await page.getByRole("button",{name:"立即同步",exact:true}).click();
      await expect(page.getByText(/资料进度与安全记录不一致/)).toBeVisible();
      await expect(page.getByRole("button",{name:"继续",exact:true})).toHaveCount(0);
      const after=await page.evaluate(()=>window.desktop.cloud("status"));
      assert.ok(after.jobs[0].rootActiveMs >= task.rootActiveMs);
      assert.equal(calls,1);assert.equal(after.account.wallet.spent,before.account.wallet.spent);
      await page.reload();
      await page.locator(".bucket-settings").click();
      await expect(page.getByText(/资料进度与安全记录不一致/)).toBeVisible();
      await expect(page.getByRole("button",{name:"继续",exact:true})).toHaveCount(0);
      console.log(JSON.stringify({synthetic:true,realProviderCalls:0,electronSourceUI:true,safetyRollback:true,
        sameTimeFloor:true,noContinue:true,reloadGatePreserved:true,simulatedCalls:calls,spentMicros:after.account.wallet.spent}));
      break scenario;
    }
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
    if (revisionReuse) {
      const previousCalls = calls;
      await page.evaluate(async () => {
        const packet = (await window.desktop.store("packets"))[0];
        await window.desktop.store("savePackets", [{ ...packet, text: "补充新的材料要求" }]);
        await window.desktop.cloud("sync");
        await window.desktop.cloud("ai", { kind: "organize", packetId: "task-ui" });
      });
      await waitForPageState(page, async () => {
        await window.desktop.cloud("sync");
        const jobs = (await window.desktop.cloud("status")).jobs;
        return jobs.some(j => j.state === "done" && j.reusedBlocks > 0);
      });
      await page.getByRole("button", { name: "立即同步", exact: true }).click();
      await expect(page.getByText(/复用 [1-9]\d* 个已付费块（已核验当前材料）/)).toBeVisible();
      assert.equal(calls, previousCalls + 1);
    }
    if (pdfWindows || archiveWindows)
      await expect(page.getByText(/已检查 19 \/ 19 页/).last()).toBeVisible();
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
      if (archiveWindows) {
        await expect(materials.getByText(/包内 “02分页.pdf”.*第 9 页.*未提取到文字/)).toBeVisible();
        await expect(materials.getByText(/包内 “04未读.png”.*此格式暂不支持/)).toBeVisible();
      } else if (nativeFormat) {
        await expect(materials.getByText(/包内 “05页面.pdf”.*第 2 页/)).toBeVisible();
        await expect(materials.getByText(/包内 “06未读.png”.*此格式暂不支持/)).toBeVisible();
      } else if (zip) {
        await expect(materials.getByText(/包内 “未读\/嵌套.zip”.*嵌套归档/)).toBeVisible();
        await expect(materials.getByText(/包内 “页面\/正文.pdf”.*第 2 页/)).toBeVisible();
      } else if (pdfWindows) {
        await expect(materials.getByText(/PDF 第 9 页.*未提取到文字/)).toBeVisible();
      } else if (pdfLimit) {
        await expect(materials.getByText(/PDF 第 5–6 页.*安全资源限制/)).toBeVisible();
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
        format: archiveWindows ? "zip" : nativeFormat || (zip ? "zip" : pdf ? "pdf" : xlsx ? "xlsx" : docx ? "docx" : "txt"),
        crossRevisionReuse: revisionReuse,
        pdfResourceSuffix: pdfLimit,
        archivePdfWindows: archiveWindows,
        pdfPageWindows: pdfWindows,
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
