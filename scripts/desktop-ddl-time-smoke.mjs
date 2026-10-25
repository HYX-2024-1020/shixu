import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const profile = await mkdtemp(path.join(tmpdir(), "shixu-ddl-clock-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.clock.setFixedTime(new Date("2026-10-28T12:00:00"));
  await page.evaluate(async () => {
    const sources = [
      { id: "report", name: "合成报告通知", text: "明天下午三点十分前交报告" },
      { id: "draft", name: "合成草稿通知", text: "明天交草稿" },
    ];
    await window.desktop.store("savePackets", [
      {
        id: "clock-packet",
        text: sources.map((s) => s.text).join("\n"),
        sources,
        attachments: [],
        capturedAt: "2026-10-28T12:00:00Z",
        captureDate: "2026-10-28",
        status: "ready",
        result: {
          summary: "合成时刻回归",
          warnings: [],
          items: sources.map((s) => ({
            kind: "task",
            title: s.name,
            summary: s.text,
            facts: [],
            nextSteps: [],
            uncertainties: [],
            sourceIds: [s.id],
            evidence: [{ sourceId: s.id, quote: s.text }],
            due: {
              date: "2026-10-29",
              time: "",
              anchor: "明天",
              sourceId: s.id,
            },
          })),
        },
        itemIds: ["clock-report", "clock-draft"],
        itemState: {},
        doneIds: [],
        error: "",
        updatedAt: "2026-10-28T12:00:00Z",
      },
    ]);
  });
  await page.evaluate(async () => {
    const [packet] = await window.desktop.store("packets");
    const text = "开学前下午三点十分提交说明";
    packet.sources.push({ id: "pending-date", name: "合成未定日期", text });
    packet.result.items.push({
      kind: "task",
      title: "合成未定日期",
      summary: text,
      facts: [],
      nextSteps: [],
      uncertainties: ["日期还不明确"],
      sourceIds: ["pending-date"],
      evidence: [{ sourceId: "pending-date", quote: text }],
      due: null,
    });
    packet.itemIds.push("clock-pending");
    packet.result.items.push({
      kind: "event",
      title: "合成讲座明天早上八点",
      summary: "参加讲座",
      facts: [],
      nextSteps: [],
      uncertainties: [],
      sourceIds: [],
      evidence: [],
      due: {
        date: "2026-10-29",
        time: "",
        anchor: "人工确认",
        sourceId: "manual",
      },
    });
    packet.itemIds.push("clock-card-copy");
    await window.desktop.store("savePackets", [packet]);
  });
  await page.reload();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const ddl = page.getByRole("region", { name: "DDL 截止事项" });
  await expect(
    ddl
      .locator(".ddl-item")
      .filter({
        has: page.getByRole("heading", {
          name: "合成讲座2026年10月29日早上八点",
          exact: true,
        }),
      })
      .locator(".time-rail"),
  ).toContainText("08:00");
  await expect(
    ddl
      .locator(".ddl-item")
      .filter({
        has: page.getByRole("heading", { name: "合成报告通知", exact: true }),
      })
      .locator(".time-rail"),
  ).toContainText("15:10");
  const fallback = ddl.locator(".ddl-item").filter({
    has: page.getByRole("heading", { name: "合成草稿通知", exact: true }),
  });
  await expect(fallback.locator(".time-rail")).toContainText("23:59");
  await fallback.getByRole("button", { name: /核对截止时间/ }).click();
  await expect(fallback.locator(".ddl-time-inference")).toContainText(
    "未指定时刻",
  );
  await fallback.getByLabel("截止时刻", { exact: true }).fill("18:30");
  await fallback.getByRole("button", { name: "保存时间" }).click();
  await expect(fallback.locator(".time-rail")).toContainText("18:30");
  await expect(fallback.locator(".ddl-time-inference")).toHaveCount(0);
  await ddl.getByText("日期待确认 · 1 项", { exact: true }).click();
  await expect(
    ddl
      .locator(".ddl-item")
      .filter({
        has: page.getByRole("heading", { name: "合成未定日期", exact: true }),
      })
      .locator(".time-rail"),
  ).toContainText("15:10");
  await expect(ddl).not.toContainText("具体时刻未知");
  console.log(
    "PASS: Electron legacy explicit time recovery, inferred default, provenance and manual override (isolated synthetic profile).",
  );
} finally {
  await app.close();
}
