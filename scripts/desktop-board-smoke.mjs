// Isolated CI only. Never point at the user's installed profile.
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-board-ui-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env });
  const main = await app.firstWindow();
  await main.getByRole("button", { name: "看板", exact: true }).click();
  const board = main.locator(".sx-host");
  await board.getByLabel("新增短期计划").fill("CI共享事项");
  await main.evaluate(() => window.flushBoardDraft());
  const created = app.waitForEvent("window");
  await main.evaluate(() => window.desktop.board.invoke("show"));
  const win = await created;
  assert.ok(win);
  await win.getByLabel("新增短期计划").waitFor();
  assert.equal(await win.evaluate(() => typeof window.desktop), "undefined");
  assert.equal(await win.evaluate(() => typeof window.require), "undefined");
  await win.getByLabel("新增短期计划").fill("CI窗口草稿");
  await win.evaluate(() => window.flushBoardDraft());
  await win.evaluate(() =>
    window.boardHost.invoke("configureWindow", {
      mode: "strip",
      top: true,
      locked: true,
    }),
  );
  await win.getByLabel("展开小条").waitFor();
  await win.getByLabel("展开小条").click();
  const expanded = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() === "拾序看板")
      .getBounds(),
  );
  assert.equal(expanded.width, 270);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "拾序看板")
        .isAlwaysOnTop(),
    ),
    true,
  );
  await win.getByLabel("收起小条").click();
  await win.evaluate(() => window.flushBoardDraft());
  await win.evaluate(() => window.boardHost.invoke("hide"));
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "拾序看板")
        .isVisible(),
    ),
    false,
  );
  await main.evaluate(() => window.desktop.board.invoke("show"));
  await win.evaluate(() =>
    window.boardHost.invoke("configureWindow", { mode: "rail", locked: false }),
  );
  await win.reload();
  await win.getByLabel("新增短期计划").waitFor();
  assert.equal(await win.getByLabel("新增短期计划").inputValue(), "CI窗口草稿");
  await assert.rejects(
    win.evaluate(() =>
      window.boardHost.invoke("removePacket", { id: "anything" }),
    ),
    /不支持/,
  );
  console.log(
    "Isolated board window IPC, shared persistence, hide/restore, strip and topmost passed",
  );
} finally {
  await app?.close();
}
