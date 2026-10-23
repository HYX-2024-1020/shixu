import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  SHIXU_DATA_DIR: await mkdtemp(path.join(tmpdir(), "shixu-motion-")),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
const report = { checks: [], samples: {} };
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const input = page.getByRole("textbox", {
    name: "往桶里放入内容",
    exact: true,
  });
  await input.waitFor();
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    await window.desktop.store("savePackets", [
      {
        id: "motion",
        text: "六件事情，慢慢做好。",
        sources: [],
        attachments: [],
        status: "ready",
        result: {
          summary: "今天的小事",
          warnings: [],
          items: Array.from({ length: 6 }, (_, i) => ({
            kind: "task",
            title: [
              "整理本周学习笔记",
              "把旅行照片发给家人",
              "准备下周的分享",
              "给植物浇一次水",
              "挑选周末要看的电影",
              "收好项目参考资料",
            ][i],
            summary: "留一点时间，认真做好这一件事。",
            facts: ["整理好后就可以休息一会儿。"],
            sourceIds: [],
            evidence: [],
            nextSteps: [],
            uncertainties: [],
            due: null,
          })),
        },
        itemIds: Array.from({ length: 6 }, (_, i) => "motion-" + i),
        doneIds: [],
        capturedAt: now,
        captureDate: now.slice(0, 10),
        updatedAt: now,
        error: "",
      },
    ]);
  });
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(page.locator(".result-card")).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.screenshot({ path: "release/desktop-motion-world.png" });
  const record = async () =>
    page.evaluate(() => {
      window.motionFrames = [];
      clearInterval(window.motionTimer);
      window.motionTimer = setInterval(() => {
        window.motionFrames.push({
          time: performance.now(),
          dialog: !!document.querySelector("dialog[open]"),
          cards: [...document.querySelectorAll("[data-motion-id]")].map(
            (el) => ({
              id: el.dataset.motionId,
              transform: getComputedStyle(el).transform,
              opacity: +getComputedStyle(el).opacity,
              active: el.getAnimations().some((a) => a.playState === "running"),
              departing: !!el.dataset.departing,
            }),
          ),
          dialogActive: document
            .querySelector("dialog")
            ?.getAnimations()
            .some((a) => a.playState === "running"),
        });
      }, 16);
    });
  const collect = async () =>
    page.evaluate(() => {
      clearInterval(window.motionTimer);
      return window.motionFrames;
    });
  const first = page.locator('[data-motion-id="motion-0"]');
  await record();
  await first.locator(".card-open").evaluate((el) => el.click());
  const detail = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(detail).toBeVisible();
  await page.waitForTimeout(380);
  const opening = await collect();
  assert(
    opening.some((f) => f.dialogActive),
    "dialog must genuinely animate",
  );
  report.samples.dialogOpening = opening.filter((f) => f.dialogActive).length;
  await page.screenshot({ path: "release/desktop-motion-detail.png" });
  await detail.getByLabel("卡片操作", { exact: true }).click();
  await expect(detail.locator(".detail-action-menu")).toHaveAttribute(
    "open",
    "",
  );
  await detail
    .getByRole("heading", { name: "整理本周学习笔记", exact: true })
    .click();
  await expect(detail.locator(".detail-action-menu")).not.toHaveAttribute(
    "open",
  );
  await record();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  const closing = await collect();
  assert(
    closing.some((f) => f.dialogActive),
    "dialog must animate out",
  );
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  report.checks.push(
    "dialog entrance/exit, double Escape, body scroll restored",
  );
  // Interrupt a menu dismissal with an immediate reopen.
  await first.getByLabel("更多事项操作").click();
  await page.locator(".world-heading").click();
  await first.getByLabel("更多事项操作").click();
  await expect(first.locator(".card-menu")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(first.locator(".card-menu")).not.toHaveAttribute("open");
  report.checks.push("menu click-away, Escape and reopen during dismissal");
  await record();
  await first
    .getByRole("button", { name: "完成", exact: true })
    .evaluate((el) => {
      el.click();
      el.click();
      el.click();
    });
  await expect(first.locator(".completion-orbit")).toHaveClass(/is-checking/);
  await expect(first).toHaveCount(0);
  await page.waitForTimeout(420);
  const completion = await collect();
  assert(
    completion.some((f) =>
      f.cards.some(
        (c) => c.id === "motion-0" && c.departing && c.opacity < 0.99,
      ),
    ),
    "completed card must visibly leave",
  );
  assert(
    completion.some((f) =>
      f.cards.some(
        (c) => c.id !== "motion-0" && c.active && c.transform !== "none",
      ),
    ),
    "remaining cards must move into place",
  );
  const completed = await page.evaluate(() => window.desktop.store("packets"));
  assert.deepEqual(completed[0].doneIds, [0]);
  report.samples.completion = completion.length;
  report.checks.push(
    "check stroke, one completion for triple click, fading exit, animated grid reflow",
  );
  // Different cards from one delivery must retain both changes when exits overlap.
  await page.evaluate(() => {
    document.querySelector('[data-motion-id="motion-1"] .card-delete').click();
    document.querySelector('[data-motion-id="motion-2"] .card-delete').click();
  });
  await expect(page.locator(".result-card")).toHaveCount(3);
  const stored = await page.evaluate(() => window.desktop.store("packets"));
  assert(stored[0].itemState["motion-1"].deletedAt);
  assert(stored[0].itemState["motion-2"].deletedAt);
  assert.equal(stored[0].itemState["motion-0"].status, "done");
  report.checks.push(
    "overlapping deletes preserve both changes and prior completion",
  );
  await page
    .locator('[data-motion-id="motion-3"] .completion-orbit')
    .evaluate((el) => el.click());
  await page.getByLabel("结果范围").selectOption("done");
  const moved = page.locator('[data-motion-id="motion-3"]');
  await expect(moved).toBeVisible();
  await expect(moved).not.toHaveAttribute("data-departing");
  await expect(moved).toHaveCSS("opacity", "1");
  report.checks.push(
    "scope switch during completion leaves the resulting card visible and usable",
  );
  await page.evaluate(() => {
    document.querySelector('[aria-label="投递桶"]').click();
    document.querySelector('[aria-label="整理结果"]').click();
  });
  await page.waitForTimeout(350);
  await expect(
    page.getByRole("button", { name: "整理结果", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(async () => {
    const a = document.querySelector('[aria-label="投递桶"]');
    const b = document.querySelector('[aria-label="整理结果"]');
    a.click();
    await new Promise((r) => setTimeout(r, 35));
    b.click();
    await new Promise((r) => setTimeout(r, 35));
    a.click();
  });
  await expect(input).toBeVisible();
  await input.fill("切换之后也能立即输入");
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.effect?.pseudoElement?.startsWith("::view-transition") &&
              a.playState === "running",
          ).length,
    ),
    0,
  );
  report.checks.push(
    "interrupted workspace transitions finish and input remains usable",
  );
  await page.locator(".bucket-app").dispatchEvent("dragover", {
    dataTransfer: await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.setData("text/plain", "test");
      return d;
    }),
  });
  await expect(page.locator(".bucket-drop-hint")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new DragEvent("dragleave", { relatedTarget: null })),
  );
  await expect(page.locator(".bucket-drop-hint")).toHaveClass(/is-leaving/);
  assert.equal(
    await page
      .locator(".bucket-drop-hint")
      .evaluate((el) => getComputedStyle(el).pointerEvents),
    "none",
  );
  await expect(page.locator(".bucket-drop-hint")).toHaveCount(0);
  await input.fill("拖走以后仍能输入");
  report.checks.push("drag dismissal fades out without blocking input");
  await writeFile(
    "release/motion-validation.json",
    JSON.stringify(report, null, 2),
  );
  console.log("PASS:", report.checks.join("; "));
} finally {
  await app.close();
}
