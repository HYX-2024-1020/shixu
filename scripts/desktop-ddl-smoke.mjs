import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(path.join(tmpdir(), "shixu-ddl-test-"));
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
  page.setDefaultTimeout(15000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const ddl = page.getByRole("region", { name: "DDL 截止事项" });
  await ddl.getByText("＋ 自己补充一项 DDL", { exact: true }).click();
  await ddl.getByLabel("事项标题", { exact: true }).fill("明天交合成报告");
  await ddl.getByLabel("截止日期", { exact: true }).last().fill("明天下午三点");
  await ddl.getByRole("button", { name: "添加 DDL", exact: true }).click();
  await ddl.locator(".ddl-item").waitFor();
  await expect(ddl.locator(".ddl-countdown")).toHaveText("还剩 1 天");
  assert.match(await ddl.locator(".time-rail").innerText(), /15:00/);
  assert.doesNotMatch(await ddl.locator(".ddl-copy h3").innerText(), /明天/);
  await ddl.getByRole("button", { name: /标记完成/ }).click();
  await ddl.getByText(/已完成 · 1 项/).waitFor();
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  await page.getByText(/已完成 · 1 项/).click();
  const completed = page.getByRole("button", { name: /撤销完成/ });
  await expect(page.locator(".ddl-countdown")).toHaveText("已完成");
  assert.equal(await completed.getAttribute("class"), "completion-orbit");
  assert.equal(await completed.getAttribute("aria-pressed"), "true");
  await completed.locator("svg").waitFor();
  assert.equal(
    await completed.evaluate((node) => getComputedStyle(node).borderRadius),
    "50%",
  );
  await page.getByRole("button", { name: /撤销完成/ }).click();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page
    .locator(".results-workspace")
    .first()
    .getByRole("heading", { name: /合成报告/ })
    .waitFor();
  await page.getByRole("button", { name: "DDL", exact: true }).click();
  const rangeView = page.getByRole("region", { name: "DDL 截止事项" });
  await rangeView.getByText("＋ 自己补充一项 DDL", { exact: true }).click();
  await rangeView.getByLabel("事项标题", { exact: true }).fill("合成时间段");
  await rangeView
    .getByLabel("截止日期", { exact: true })
    .last()
    .fill("明天14:00到后天16:00");
  await rangeView
    .getByRole("button", { name: "添加 DDL", exact: true })
    .click();
  const span = rangeView.locator(".ddl-item").filter({ hasText: "合成时间段" });
  await expect(span.locator(".time-rail")).toContainText("14:00");
  await expect(span.locator(".time-rail")).toContainText("16:00");
  await span.getByRole("button", { name: /核对截止时间/ }).click();
  await expect(span.locator(".ddl-absolute-time")).toHaveText(
    /\d{4}-\d{2}-\d{2} 14:00 → \d{4}-\d{2}-\d{2} 16:00/,
  );
  const content = await page.locator(".bucket-main").boundingBox();
  const dock = await page
    .getByRole("navigation", { name: "主工作区" })
    .boundingBox();
  assert.ok(
    content.y + content.height <= dock.y,
    "content viewport must end above the dock",
  );
  console.log(
    "Electron DDL: relative input, ranges, navigation clearance, completion, restart persistence, undo and world state passed (isolated synthetic profile).",
  );
} finally {
  await app?.close();
}
