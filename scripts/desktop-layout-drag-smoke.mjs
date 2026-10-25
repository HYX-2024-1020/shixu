import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const env = {
  ...process.env,
  SHIXU_DATA_DIR: await mkdtemp(path.join(tmpdir(), "shixu-layout-")),
};
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
  await page.getByLabel("往桶里放入内容", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const now = new Date(),
      tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const local = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await window.desktop.store("savePackets", [
      {
        id: "layout",
        text: "合成布局资料",
        sources: [],
        attachments: [],
        status: "ready",
        capturedAt: now.toISOString(),
        captureDate: local(now),
        updatedAt: now.toISOString(),
        itemIds: Array.from({ length: 18 }, (_, i) => `layout-${i}`),
        doneIds: [],
        error: "",
        result: {
          summary: "布局验收",
          warnings: [],
          items: Array.from({ length: 18 }, (_, i) => ({
            kind: "task",
            title: `合成事项 ${i}`,
            summary: "核对资料并提交报告",
            facts: [],
            nextSteps: [],
            uncertainties: [],
            evidence: [],
            sourceIds: [],
            due: { date: local(tomorrow), time: "23:59", anchor: "明天" },
          })),
        },
      },
    ]);
  });
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  const widths = [];
  for (const width of [720, 1360, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.evaluate(() => {
      const main = document.querySelector(".bucket-main"),
        grid = document.querySelector(".result-grid"),
        button = [
          ...document.querySelectorAll(".result-controls > button"),
        ].find((el) => el.textContent === "整理记录"),
        rect = main.getBoundingClientRect(),
        style = getComputedStyle(button);
      return {
        app: document
          .querySelector(".bucket-app")
          .getBoundingClientRect()
          .toJSON(),
        doc: document.documentElement.clientWidth,
        body: document.body.getBoundingClientRect().toJSON(),
        sh: document.documentElement.scrollHeight,
        right: rect.right,
        left: rect.left,
        width: innerWidth,
        grid: grid.getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        background: style.backgroundColor,
        border: style.borderTopWidth,
      };
    });
    assert.ok(
      Math.abs(geometry.right - width) < 1 && Math.abs(geometry.left) < 1,
      JSON.stringify(geometry),
    );
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.background, "rgb(255, 255, 255)");
    assert.ok(parseFloat(geometry.border) >= 1.5);
    widths.push(geometry.grid);
  }
  assert.ok(widths[3] > widths[1] + 300, "wide window expands actual content");
  await mkdir("release", { recursive: true });
  await page.screenshot({ path: "release/layout-wide.png" });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const cards = page.locator(".ddl-section .ddl-item");
  await cards.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(450);
  const original = await cards.evaluateAll((nodes) =>
    nodes.map((el) => el.dataset.motionId),
  );
  const source = cards.first().locator(".ddl-copy"),
    target = cards.nth(1).locator(".ddl-copy");
  let a = await source.boundingBox(),
    b = await target.boundingBox();
  await page.mouse.move(a.x + 80, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + 100, a.y + 30);
  await expect(page.locator(".card-drag-preview")).toHaveCount(1);
  await page.mouse.move(b.x + 100, b.y + 30, { steps: 10 });
  await expect(cards.nth(1)).toHaveAttribute("data-motion-id", original[0]);
  await page.mouse.up();
  await expect(page.locator(".card-drag-preview")).toHaveCount(0);
  await expect(page.locator(".ddl-workspace [role=status]")).toContainText(
    "已移动",
  );
  const reordered = await cards.evaluateAll((nodes) =>
    nodes.map((el) => el.dataset.motionId),
  );
  assert.equal(reordered[0], original[1]);
  assert.equal(reordered[1], original[0]);
  await page.screenshot({ path: "release/ddl-drag.png" });
  // Escape and window resize both abandon a drag without persisting it.
  for (const cancel of ["Escape", "resize"]) {
    a = await cards.first().locator(".ddl-copy").boundingBox();
    await page.mouse.move(a.x + 70, a.y + 20);
    await page.mouse.down();
    await page.mouse.move(a.x + 90, a.y + 30);
    await expect(page.locator(".card-drag-preview")).toHaveCount(1);
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else await page.setViewportSize({ width: 1400, height: 1000 });
    await page.mouse.up();
    await expect(page.locator(".card-drag-preview")).toHaveCount(0);
    assert.deepEqual(
      await cards.evaluateAll((nodes) =>
        nodes.map((el) => el.dataset.motionId),
      ),
      reordered,
    );
  }
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await expect(page.locator(".ddl-section .ddl-item").first()).toHaveAttribute(
    "data-motion-id",
    reordered[0],
  );
  await page.locator(".ddl-section .ddl-copy").first().click();
  await expect(page.locator(".ddl-panel")).toBeVisible();
  console.log(
    "Windows layout: 720/1360/1920/2560 edge scrollbar, responsive content, records button; DDL pickup/reorder/drop, Escape/resize cancellation, restart persistence and short click passed.",
  );
} finally {
  await app?.close();
}
