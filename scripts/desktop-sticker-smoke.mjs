import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DesktopStore } from "../desktop/storage.cjs";

const profile = await mkdtemp(path.join(tmpdir(), "shixu-stickers-"));
const kinds = ["task", "event", "idea", "habit", "notice", "note"];
const titles = [
  "完成品牌提案",
  "团队创意碰头",
  "把灵感变成作品",
  "每天读二十页书",
  "设计展报名通知",
  "值得收藏的设计笔记",
];
const packet = {
  id: "stickers",
  text: "合成外观验收",
  sources: [
    { id: "input", name: "合成通知", text: "2026年10月28日18:30提交品牌提案" },
  ],
  attachments: [
    {
      id: "brief",
      name: "项目要求.md",
      type: "text/markdown",
      size: 18,
      bytes: Uint8Array.from(Buffer.from("合成项目要求")).buffer,
    },
    {
      id: "reference",
      name: "参考资料-很长的文件名用于验证换行不丢失.txt",
      type: "text/plain",
      size: 9,
      bytes: Uint8Array.from(Buffer.from("合成参考")).buffer,
    },
    {
      id: "removed",
      name: "已删除文件.txt",
      bytes: Uint8Array.from(Buffer.from("old")).buffer,
      type: "text/plain",
      size: 3,
      deletedAt: "2026-10-26T12:00:00Z",
    },
  ],
  capturedAt: "2026-10-26T12:00:00Z",
  captureDate: "2026-10-26",
  updatedAt: "2026-10-26T12:00:00Z",
  status: "ready",
  error: "",
  doneIds: [],
  itemIds: kinds,
  itemState: {},
  result: {
    summary: "合成卡片",
    warnings: [],
    items: kinds.map((kind, i) => ({
      kind,
      group: "品牌设计",
      title: titles[i],
      summary: "整理核心概念与三张主视觉，准备下一轮评审。",
      facts: ["原文完整保留"],
      nextSteps: [],
      uncertainties: [],
      evidence: [],
      sourceIds: [],
      due:
        kind === "task"
          ? {
              date: "2026-10-28",
              time: "18:30",
              anchor: "2026-10-28 18:30",
              sourceId: "manual",
            }
          : null,
    })),
  },
};
await new DesktopStore(path.join(profile, "workspace")).call("savePackets", [
  packet,
]);
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
  await page.clock.setFixedTime(new Date("2026-10-26T12:00:00"));
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const task = page.locator(".result-card.kind-task");
  await expect(task.locator(".card-open h2")).toHaveCSS(
    "background-color",
    "rgb(255, 218, 50)",
  );
  await expect(task).toHaveCSS("background-color", "rgb(255, 254, 248)");
  await expect(task.locator(".card-bottom")).toHaveCSS(
    "background-color",
    "rgb(255, 218, 50)",
  );
  await expect(page.locator(".kind-event.result-card .card-open h2")).toHaveCSS(
    "background-color",
    "rgb(195, 176, 255)",
  );
  await task.getByRole("button", { name: "星标", exact: true }).click();
  await expect(
    task.getByRole("button", { name: "取消星标", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(task.locator(".collection-tag")).toHaveText("品牌设计");
  await expect(task.locator(".deadline")).toContainText("18:30");
  await expect(task.locator(".card-file")).toHaveCount(2);
  await expect(task.locator(".card-files")).not.toContainText("已删除文件");
  await task.locator(".card-file").first().click();
  await expect(page.getByRole("dialog", { name: "同行材料" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "项目要求.md", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭同行材料" }).click();
  const gradients = await task.evaluate((el) =>
    [el, ...el.querySelectorAll("*")].some((n) =>
      [null, "::before", "::after"].some((p) =>
        /gradient/.test(getComputedStyle(n, p).backgroundImage),
      ),
    ),
  );
  expect(gradients).toBe(false);
  for (const width of [720, 1360, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await task
      .locator(".card-file")
      .evaluateAll((nodes) =>
        nodes.some((el) => el.getBoundingClientRect().right > innerWidth),
      );
    expect(overflow).toBe(false);
  }
  await page.setViewportSize({ width: 1360, height: 1000 });
  await mkdir("release/cel-evidence", { recursive: true });
  const label = process.env.SHIXU_VISUAL_LABEL || "source";
  await page.screenshot({
    path: `release/cel-evidence/sticker-${label}-world.png`,
    animations: "disabled",
  });
  await task.getByRole("button", { name: "查看详情" }).click();
  await expect(page.getByRole("dialog", { name: "事项详情" })).toBeVisible();
  await page.screenshot({
    path: `release/cel-evidence/sticker-${label}-detail.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭事项详情" }).click();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const ddl = page.locator(".ddl-item").filter({ hasText: "完成品牌提案" });
  await expect(ddl.locator(".ddl-countdown")).toHaveText("还剩 2 天");
  await expect(ddl.locator(".card-file")).toHaveCount(2);
  await expect(ddl.locator(".ddl-footer")).toHaveCSS(
    "background-color",
    "rgb(195, 176, 255)",
  );
  await page.screenshot({
    path: `release/cel-evidence/sticker-${label}-ddl.png`,
    animations: "disabled",
  });
  await ddl.getByRole("button", { name: /标记完成：/ }).click();
  await page.getByText(/已完成 · 1 项/).click();
  await expect(ddl.locator(".ddl-countdown")).toHaveText("已完成");
  await ddl.getByRole("button", { name: /撤销完成：/ }).click();
  await expect(ddl.locator(".ddl-countdown")).toHaveText("还剩 2 天");
  console.log(
    "PASS: sticker world/details, stable semantic colors, star, DDL countdown/footer, completion and undo (isolated synthetic profile).",
  );
} finally {
  await app.close();
}
