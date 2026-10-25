import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-25T12:00:00"));
  await page.goto("/");
  await page.evaluate(async () => {
    const { putPacket } = await import("/src/bucket/store.ts");
    await putPacket({
      id: "completion-fixture",
      text: "合成资料",
      sources: [],
      attachments: [],
      capturedAt: "2026-10-25T04:00:00Z",
      captureDate: "2026-10-25",
      status: "ready",
      error: "",
      updatedAt: "2026-10-25T04:00:00Z",
      itemIds: ["motion-task", "sibling-task", "daily-habit"],
      doneIds: [2],
      itemState: {
        "daily-habit": { status: "done", checkins: ["2026-10-24"] },
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
              date: "2026-10-25",
              time: "23:59",
              anchor: "2026-10-25",
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
    });
  });
  await page.reload();
});

test("DDL draws the check before exit and animates the remaining card into place", async ({
  page,
}) => {
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const region = page.getByRole("region", { name: "DDL 截止事项" });
  const card = region.locator('[data-motion-id="motion-task"]');
  await expect(card).toBeVisible();
  // Let entrance finish, then sample computed output throughout the real click.
  await page.waitForTimeout(400);
  const samples = await card
    .locator(".completion-orbit")
    .evaluate(async (button: HTMLButtonElement) => {
      const root = button.closest(".ddl-workspace")!;
      const card = button.closest("article")!;
      const sibling = root.querySelector('[data-motion-id="sibling-task"]')!;
      const frames: {
        stroke: number;
        opacity: number;
        shift: number;
        pop: boolean;
      }[] = [];
      button.click();
      const start = performance.now();
      while (performance.now() - start < 1000) {
        const path = button.querySelector("svg path");
        frames.push({
          stroke: path
            ? parseFloat(getComputedStyle(path).strokeDashoffset)
            : -1,
          opacity: parseFloat(getComputedStyle(card).opacity),
          shift: new DOMMatrixReadOnly(getComputedStyle(sibling).transform).m42,
          pop: button.getAnimations().some((a) => a.playState === "running"),
        });
        await new Promise(requestAnimationFrame);
      }
      return frames;
    });
  expect(samples.some((s) => s.pop && s.stroke > 0 && s.stroke < 26)).toBe(
    true,
  );
  expect(samples.some((s) => s.opacity > 0 && s.opacity < 1)).toBe(true);
  expect(samples.some((s) => Math.abs(s.shift) > 1)).toBe(true);
  await expect(region.getByText(/已完成 · 1 项/)).toBeVisible();
  await region.getByText(/已完成 · 1 项/).click();
  await region.getByRole("button", { name: /撤销完成/ }).click();
  await expect(region.locator(".ddl-section .ddl-item")).toHaveCount(2);
});

test("habit stays visible, survives restart, supports detail undo and the next local day", async ({
  page,
}) => {
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const card = page.locator(
    '.results-workspace:not(.current-results) [data-motion-id="daily-habit"]',
  );
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "今日打卡", exact: true }).click();
  await expect(card.locator(".habit-check")).toContainText("今日已打卡");
  await expect(card.locator(".habit-check")).toContainText("累计 2 天");
  await expect(card.locator(".completion-orbit")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(card.locator(".habit-check")).toContainText("累计 2 天");
  await card.getByRole("heading", { name: "每天阅读" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("卡片操作", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "撤销今日打卡", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("今日待打卡 · 累计 1 天");
  await dialog.getByLabel("卡片操作", { exact: true }).click();
  await dialog.getByRole("button", { name: "今日打卡", exact: true }).click();
  await expect(dialog).toContainText("今日已打卡 · 累计 2 天");
  await page.reload();
  await page.clock.setFixedTime(new Date("2026-10-26T12:00:00"));
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.locator(".completion-orbit")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await card.getByRole("button", { name: "今日打卡", exact: true }).click();
  await expect(card.locator(".habit-check")).toContainText("累计 3 天");
});
