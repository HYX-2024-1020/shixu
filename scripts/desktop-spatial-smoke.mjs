import { accountUIFixture } from "./account-ui-fixture.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const fixture = await accountUIFixture();
const env = {
  ...fixture.env,
  SHIXU_DATA_DIR: await mkdtemp(path.join(tmpdir(), "shixu-spatial-")),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
const report = { checks: [], frameSamples: [] };
try {
  const page = await app.firstWindow();
  // CI desktops can have a smaller work area than the developer's monitor.
  // Keep the precision reorder test away from the auto-scroll edge; the final
  // scenario below exercises edge scrolling separately at this same viewport.
  await page.setViewportSize({ width: 1180, height: 820 });
  page.setDefaultTimeout(15000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    window.makePacket = (id, titles) => ({
      id,
      text: "验证资料",
      sources: [],
      attachments: [],
      status: "ready",
      result: {
        summary: "今天的事",
        warnings: [],
        items: titles.map((title) => ({
          kind: "task",
          title,
          summary: "做好这一件小事就好。",
          facts: ["记得给自己一点休息时间。"],
          sourceIds: [],
          evidence: [],
          due: null,
          nextSteps: [],
          uncertainties: [],
        })),
      },
      itemIds: titles.map((_, i) => id + "-" + i),
      doneIds: [],
      capturedAt: now,
      captureDate: now.slice(0, 10),
      updatedAt: now,
      error: "",
    });
    await window.desktop.store("savePackets", [
      window.makePacket("history", ["以前的任务不要出现在桶里"]),
    ]);
  });
  await page.reload();
  await fixture.activate(page, true);
  const input = page.getByRole("textbox", {
    name: "往桶里放入内容",
    exact: true,
  });
  await expect(page.getByLabel("这次投喂", { exact: true })).toHaveCount(0);
  await input.fill("明天下午交英语报告");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  const current = page.getByLabel("这次投喂", { exact: true });
  await expect(current).toBeVisible();
  await expect(current.getByRole("status")).toBeVisible();
  await expect(
    current.getByRole("button", { name: "查看 提交英语报告", exact: true }),
  ).toBeVisible();
  await expect(
    current.getByText("以前的任务不要出现在桶里", { exact: true }),
  ).toHaveCount(0);
  await current
    .getByRole("button", { name: "查看 提交英语报告", exact: true })
    .click();
  await page.getByLabel("关闭事项详情", { exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await input.fill("周末整理相册");
  await page.getByRole("button", { name: "丢进去", exact: true }).click();
  await expect(
    current.getByRole("button", { name: "查看 整理相册", exact: true }),
  ).toBeVisible();
  await expect(
    current.getByRole("button", { name: "查看 提交英语报告", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "release/desktop-current-feed.png",
    fullPage: true,
  });
  await page.reload();
  await expect(current).toHaveCount(0);
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看 提交英语报告", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看 整理相册", exact: true }),
  ).toBeVisible();
  report.checks.push(
    "capture shows only latest manual delivery, live progress and actionable results; restart clears receipt view and retains every task",
  );
  // Seed an isolated board for precise spatial tests, without model calls.
  await page.evaluate(async () => {
    const now = new Date().toISOString();
    await window.desktop.store("savePackets", [
      {
        id: "drag",
        text: "卡片拖动验证",
        sources: [],
        attachments: [],
        status: "ready",
        result: {
          summary: "小事",
          warnings: [],
          items: Array.from({ length: 8 }, (_, i) => ({
            kind: "task",
            title: "小事 " + i,
            summary: "每件事都有自己的位置。",
            facts: ["整理好后休息一下。"],
            sourceIds: [],
            evidence: [],
            due: null,
            nextSteps: [],
            uncertainties: [],
          })),
        },
        itemIds: Array.from({ length: 8 }, (_, i) => "drag-" + i),
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
  // Limit board to this delivery through its searchable original text.
  await page.getByLabel("搜索整理结果").fill("卡片拖动验证");
  await expect(
    page.locator(".results-workspace .result-card:visible"),
  ).toHaveCount(8);
  await page.waitForTimeout(350);
  await page.evaluate(() =>
    document.querySelector(".bucket-main").scrollTo(0, 420),
  );
  const first = page.locator('[data-motion-id="drag-0"]');
  const source = await first.boundingBox();
  await page.evaluate(() => {
    window.zoomSamples = [];
    const tick = () => {
      const dialog = document.querySelector("dialog[open]");
      if (dialog) {
        const r = dialog.getBoundingClientRect();
        window.zoomSamples.push({
          state: dialog.dataset.motionState,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          filter: getComputedStyle(dialog).filter,
        });
      }
      window.zoomFrame = requestAnimationFrame(tick);
    };
    tick();
  });
  await first.locator(".card-open").evaluate((el) => el.click());
  const dialog = page.getByRole("dialog", { name: "事项详情", exact: true });
  for (let i = 0; i < 4; i++) {
    report.frameSamples.push(
      await app.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].capturePage();
        const b = image.toBitmap();
        let sum = 0,
          dark = 0,
          n = 0;
        for (let p = 0; p < b.length; p += 64) {
          const l = (b[p] + b[p + 1] + b[p + 2]) / 3;
          sum += l;
          dark += l < 18 ? 1 : 0;
          n++;
        }
        return { mean: sum / n, darkFraction: dark / n };
      }),
    );
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(100);
  const target = await dialog.boundingBox();
  await page.screenshot({ path: "release/desktop-spatial-detail.png" });
  await dialog
    .getByLabel("关闭事项详情", { exact: true })
    .evaluate((el) => el.click());
  await expect(dialog).toHaveCount(0);
  const samples = await page.evaluate(() => {
    cancelAnimationFrame(window.zoomFrame);
    return window.zoomSamples;
  });
  const opening = samples.filter((s) => s.state === "opening"),
    closing = samples.filter((s) => s.state === "closing");
  assert(
    opening.length > 2 && closing.length > 2,
    "zoom must run across multiple frames",
  );
  assert(
    Math.abs(opening[0].width - source.width) <
      Math.abs(opening[0].width - target.width),
    "opening begins at original card size",
  );
  assert(
    Math.abs(opening[0].y - source.y) < Math.abs(target.y - source.y),
    "opening begins near the original card position",
  );
  assert(
    Math.abs(closing.at(-1).width - source.width) < 25,
    "closing returns to source card width",
  );
  assert(
    Math.abs(closing.at(-1).y - source.y) < 25,
    "closing returns to source card position",
  );
  assert(
    samples.every((s) => s.filter === "none"),
    "no animated blur filter",
  );
  assert(
    report.frameSamples.every((s) => s.mean > 80 && s.darkFraction < 0.8),
    "sampled compositor frames must not be black",
  );
  assert.equal(await first.evaluate((el) => getComputedStyle(el).opacity), "1");
  report.checks.push(
    "actual source-to-dialog rectangle zoom and return; no blur layer; compositor samples remain visible",
  );
  // A stationary mouse press remains a click, even when held longer than the
  // former 280ms timer. Only movement starts an Explorer-style mouse drag.
  const box = await first.locator(".card-open").boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(320);
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  await page.mouse.up();
  assert.equal(await page.locator(".card-drag-preview").count(), 0);
  // Close any click generated by the test movement.
  if (await dialog.count()) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  const ids = () =>
    page
      .locator(".results-workspace .result-card:visible")
      .evaluateAll((cards) => cards.map((c) => c.dataset.motionId));
  const initial = await ids();
  const start = await first.locator(".card-open").boundingBox();
  const destination = await page
    .locator('[data-motion-id="drag-4"]')
    .boundingBox();
  const dropY = destination.y + destination.height / 2;
  assert(
    dropY > 72 && dropY < 820 - 72,
    "precision drop stays outside the auto-scroll edges",
  );
  await page.mouse.move(start.x + 80, start.y + 25);
  await page.mouse.down();
  await page.mouse.move(start.x + 91, start.y + 25);
  await expect(page.locator(".card-drag-preview")).toHaveCount(1);
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 12 },
  );
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  const expected = [...initial];
  expected.splice(expected.indexOf("drag-0"), 1);
  expected.splice(4, 0, "drag-0");
  await expect.poll(ids).toEqual(expected);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".bucket-drop-hint")).toHaveCount(0);
  const order = await page.evaluate(async () => {
    const p = (await window.desktop.store("packets")).find(
      (p) => p.id === "drag",
    );
    return p.itemIds
      .slice()
      .sort((a, b) => p.itemState[a].order - p.itemState[b].order);
  });
  assert.deepEqual(order, expected);
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByLabel("搜索整理结果").fill("卡片拖动验证");
  await expect.poll(ids).toEqual(expected);
  report.checks.push(
    "mouse movement starts drag without hold; slot reflow, landing and persistence; no accidental detail/drop overlay",
  );
  // Escape restores both layout and persisted order.
  await page.evaluate(() =>
    document.querySelector(".bucket-main").scrollTo(0, 420),
  );
  const cancelCard = page.locator('[data-motion-id="drag-1"] .card-open'),
    cancelBox = await cancelCard.boundingBox();
  await page.mouse.move(cancelBox.x + 50, cancelBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x + 300, cancelBox.y + 90, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  await expect.poll(ids).toEqual(expected);
  assert.equal(
    await page.evaluate(() =>
      document.body.classList.contains("is-card-dragging"),
    ),
    false,
  );
  report.checks.push(
    "stationary press remains a click; Escape rolls back mouse drag without saving or opening a detail",
  );
  await page.waitForTimeout(400);
  const edgeBox = await cancelCard.boundingBox();
  await page.mouse.move(edgeBox.x + 50, edgeBox.y + 25);
  await page.mouse.down();
  const scrollBefore = await page.evaluate(
    () => document.querySelector(".bucket-main").scrollTop,
  );
  const viewportHeight = await page.evaluate(() => innerHeight);
  await page.mouse.move(edgeBox.x + 100, viewportHeight - 22, { steps: 6 });
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector(".bucket-main").scrollTop),
    )
    .toBeGreaterThan(scrollBefore + 25);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(ids).toEqual(expected);
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  report.checks.push(
    "holding near a viewport edge scrolls the board; cancellation retains saved order",
  );
  await page.screenshot({ path: "release/desktop-spatial-board.png" });
  await writeFile(
    "release/spatial-validation.json",
    JSON.stringify(report, null, 2),
  );
  console.log("PASS:", report.checks.join("; "));
} finally {
  await app.close();
  await fixture.close();
}
