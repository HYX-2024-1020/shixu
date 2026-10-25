import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(path.join(tmpdir(), "shixu-completion-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath: process.env.SHIXU_PACKAGED_EXE,
    args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
    env,
  });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const now = new Date(),
      pad = (n) => String(n).padStart(2, "0");
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    await window.desktop.store("savePackets", [
      {
        id: "completion-fixture",
        text: "合成动画验收资料",
        sources: [],
        attachments: [],
        capturedAt: now.toISOString(),
        captureDate: day,
        updatedAt: now.toISOString(),
        status: "ready",
        error: "",
        itemIds: ["motion-task", "sibling-task", "daily-habit"],
        doneIds: [2],
        itemState: {
          "daily-habit": { status: "done", checkins: ["2020-01-01"] },
        },
        result: {
          summary: "合成资料",
          warnings: [],
          items: [
            ...["动画任务", "补位任务"].map((title) => ({
              kind: "task",
              title,
              summary: "合成任务",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              sourceIds: [],
              evidence: [],
              due: {
                date: day,
                time: "23:59",
                anchor: day,
                sourceId: "manual",
              },
            })),
            {
              kind: "habit",
              title: "每天阅读",
              summary: "每天读一页",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              sourceIds: [],
              evidence: [],
              due: null,
            },
          ],
        },
      },
    ]);
  });
  await page.reload();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const region = page.getByRole("region", { name: "DDL 截止事项" });
  const card = region.locator('[data-motion-id="motion-task"]');
  await expect(card).toBeVisible();
  await page.waitForTimeout(400);
  const frames = await card
    .locator(".completion-orbit")
    .evaluate(async (button) => {
      const card = button.closest("article");
      const sibling = button
        .closest(".ddl-workspace")
        .querySelector('[data-motion-id="sibling-task"]');
      const frames = [];
      button.click();
      const start = performance.now();
      while (performance.now() - start < 1000) {
        const check = button.querySelector("svg path");
        frames.push({
          time: performance.now() - start,
          stroke: check
            ? parseFloat(getComputedStyle(check).strokeDashoffset)
            : -1,
          opacity: parseFloat(getComputedStyle(card).opacity),
          shift: new DOMMatrixReadOnly(getComputedStyle(sibling).transform).m42,
          pop: button.getAnimations().some((a) => a.playState === "running"),
        });
        await new Promise(requestAnimationFrame);
      }
      return frames;
    });
  assert.ok(
    frames.some((f) => f.pop && f.stroke > 0 && f.stroke < 26),
    "actual check stroke must advance before exit",
  );
  assert.ok(
    frames.some((f) => f.opacity > 0 && f.opacity < 1),
    "actual card must fade out",
  );
  assert.ok(
    frames.some((f) => Math.abs(f.shift) > 1),
    "remaining card must animate into place",
  );
  await region.getByText(/已完成 · 1 项/).click();
  await region.getByRole("button", { name: /撤销完成/ }).click();
  await expect(region.locator(".ddl-section .ddl-item")).toHaveCount(2);
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const habit = page.locator(
    '.results-workspace:not(.current-results) [data-motion-id="daily-habit"]',
  );
  await habit.getByRole("button", { name: "今日打卡", exact: true }).click();
  await expect(habit.locator(".habit-check")).toContainText("累计 2 天");
  await expect(habit.locator(".completion-orbit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await mkdir("release", { recursive: true });
  await page.waitForTimeout(500);
  await habit.screenshot({ path: "release/installed-habit-checkin.png" });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const reopened = page.locator(
    '.results-workspace:not(.current-results) [data-motion-id="daily-habit"]',
  );
  await expect(reopened.locator(".habit-check")).toContainText("累计 2 天");
  await reopened
    .getByRole("button", { name: "撤销今日打卡", exact: true })
    .click();
  await expect(reopened.locator(".habit-check")).toContainText("累计 1 天");
  await writeFile(
    "release/completion-motion-validation.json",
    JSON.stringify(
      {
        executable: process.env.SHIXU_PACKAGED_EXE || "source Electron",
        profile,
        passed: true,
        frames,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: real executable draws the check stroke, pops, fades and reflows; habits remain visible, persist after restart and undo only today (isolated synthetic profile).",
  );
} finally {
  await app?.close();
}
