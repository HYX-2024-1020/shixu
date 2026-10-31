import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { runClientLoop } from "./reading-client-loop.mjs";
import { pdfBytes } from "../server/reading/pdf-fixtures.mjs";
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
export async function runWindowSafetyClients({
  directory,
  reader,
  deleted = false,
}) {
  let recovered = false,
    schemaEvidence;
  const report = await runClientLoop({
    directory,
    reader,
    sourceByMini: true,
    startByMini: true,
    expireBeforeStart: !deleted,
    deleteBeforeStart: deleted,
    windowAudit: true,
    original: {
      name: "窗口核对.pdf",
      type: "application/pdf",
      body: pdfBytes(
        Array.from({ length: 19 }, (_, n) => ({
          text: "第" + (n + 1) + "页独有内容，尾部唯一标记",
        })),
      ),
      expectedPdfPages: 19,
      async verify({ cloud, page, service, ledger }) {
        const account = cloud.config.devices[cloud.config.active].userId,
          oldJob = cloud.readJobs()[0],
          spent = oldJob.rootSpent,
          calls = oldJob.rootCalls;
        const db = new DatabaseSync(
          join(directory, "server", "users", account, "workspace.sqlite"),
        );
        let trusted;
        try {
          trusted = {
            ...db
              .prepare("SELECT * FROM reading_windows WHERE task=?")
              .get(oldJob.id),
          };
          const metadata = JSON.parse(trusted.coverage);
          metadata.pagination.nextPage = 9;
          db.prepare(
            "UPDATE reading_windows SET next_page=9,coverage=? WHERE task=?",
          ).run(JSON.stringify(metadata), oldJob.id);
        } finally {
          db.close();
        }
        await page._startJob("organize", "packet");
        assert.equal(page.data.error, "");
        const id = page._jobs.at(-1).id;
        while (service.readingRoutes.snapshot().accounts) await tick();
        await cloud.action("sync");
        await page.sync();
        const win = cloud.readJobs().find((j) => j.id === id),
          mini = page._jobs.find((j) => j.id === id),
          view = page.data.jobs.find((j) => j.id === id);
        assert.equal(win.reason, "WINDOW_STATE_RECONCILIATION");
        assert.equal(win.reason, mini.reason);
        assert.equal(win.rootCalls, calls);
        assert.equal(win.rootSpent, spent);
        assert.equal(view.canContinue, false);
        assert.equal(view.canAcceptPartial, false);
        assert.match(win.error, /读取进度与独立记录不一致/);
        const oldIntent = {
          contractVersion: 1,
          operationId: crypto.randomUUID(),
          expectedGeneration: win.generation,
          expectedRevision: win.inputRevision,
          expectedMaintenanceOperation: win.maintenanceOperation,
        };
        await assert.rejects(
          cloud.request(
            cloud.config.active,
            "POST",
            `/api/v4/tasks/${id}/continue`,
            oldIntent,
          ),
          /读取进度与独立记录不一致/,
        );
        service.readingRoutes.windowMaintenanceRestore(
          account,
          id,
          [trusted],
          "synthetic-maintainer",
        );
        const review = service.readingRoutes.windowMaintenanceReview(
          account,
          id,
          "synthetic-maintainer",
        );
        const request = {
          operationId: crypto.randomUUID(),
          evidenceHash: "b".repeat(64),
          expectedGeneration: review.generation,
          expectedWatermark: review.watermark,
          expectedLedgerSequence: review.ledgerSequence,
        };
        service.readingRoutes.reconcileWindowState(
          account,
          id,
          request,
          "synthetic-maintainer",
        );
        await cloud.action("sync");
        await page.sync();
        const ready = cloud.readJobs().find((j) => j.id === id);
        assert.equal(ready.state, "paused");
        assert.equal(ready.rootSpent, spent);
        assert.equal(ready.rootCalls, calls);
        assert.equal(
          page._jobs.find((j) => j.id === id).reason,
          "WINDOW_STATE_AUDITED",
        );
        await assert.rejects(
          cloud.request(
            cloud.config.active,
            "POST",
            `/api/v4/tasks/${id}/continue`,
            oldIntent,
          ),
          /任务状态已变化/,
        );
        await page.taskAction({
          currentTarget: { dataset: { id, action: "continue" } },
        });
        while (service.readingRoutes.snapshot().accounts) await tick();
        await cloud.action("sync");
        await page.sync();
        const done = cloud.readJobs().find((j) => j.id === id);
        assert.equal(done.state, "done", JSON.stringify(done));
        assert.equal(done.calls, 0);
        assert.equal(done.rootSpent, spent);
        assert.equal(done.rootCalls, calls);
        assert.equal(done.reusedBlocks, oldJob.completedBlocks);
        const version = ledger.db
          .prepare(
            "SELECT version,checksum FROM reading_schema_versions WHERE component='window-safety'",
          )
          .get();
        schemaEvidence = {
          version: version.version,
          checksum: version.checksum,
          cursorReceipts: ledger.db
            .prepare(
              "SELECT COUNT(*) n FROM reading_window_receipts WHERE account=?",
            )
            .get(account).n,
          observations: ledger.db
            .prepare(
              "SELECT COUNT(*) n FROM reading_window_views WHERE account=?",
            )
            .get(account).n,
          finalAudits: ledger.db
            .prepare(
              "SELECT COUNT(*) n FROM reading_window_finalizations WHERE account=?",
            )
            .get(account).n,
        };
        recovered = true;
      },
    },
  });
  assert.equal(recovered, true);
  return {
    ...report,
    schemaEvidence,
    windowRollbackBlockedBoth: true,
    windowAuditExplicitResume: true,
    oldContinueRejected: true,
    reusedWithoutAdditionalFees: true,
  };
}
