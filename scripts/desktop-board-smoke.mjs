// Isolated CI only. Never point at the user's installed profile.
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-board-ui-"));
const env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    ...(env.SHIXU_PACKAGED_EXE
      ? { executablePath: env.SHIXU_PACKAGED_EXE, args: [] }
      : { args: ["."] }),
    env,
  });
  const main = await app.firstWindow();
  await main.getByRole("button", { name: "看板", exact: true }).click();
  const board = main.locator(".sx-host");
  await board.getByLabel("新增短期计划").fill("CI共享事项");
  await main.evaluate(() => window.flushBoardDraft());
  const created = app.waitForEvent("window");
  await board.getByRole("button", { name: "打开悬浮看板" }).click();
  const win = await created;
  assert.ok(win);
  await win.getByLabel("新增短期计划").waitFor();
  assert.equal(await win.evaluate(() => typeof window.desktop), "undefined");
  assert.equal(await win.evaluate(() => typeof window.require), "undefined");
  await win.getByLabel("新增短期计划").fill("CI窗口草稿");
  await win.evaluate(() => window.flushBoardDraft());
  await board.getByLabel("看板视图").selectOption("strip");
  assert.equal(await win.getByTestId("rail-board").isVisible(), true);
  await board.getByRole("button", { name: "打开悬浮看板" }).click();
  await win.getByLabel("展开小条").waitFor();
  await win.getByLabel("展开小条").click();
  await win.waitForFunction(() => innerHeight > 100);
  assert.equal(await win.getByLabel("看板视图").count(), 0);
  assert.equal(await win.getByText("窗口与规划").count(), 0);
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
  await win.waitForFunction(() => innerHeight < 100);
  await win.getByLabel("关闭悬浮看板").click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "拾序看板")
          .isVisible(),
      ),
    )
    .toBe(false);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "拾序看板")
        .isVisible(),
    ),
    false,
  );
  await board.getByLabel("看板视图").selectOption("rail");
  await board.getByRole("button", { name: "打开悬浮看板" }).click();
  await win.reload();
  await win.getByLabel("新增短期计划").waitFor();
  assert.equal(await win.getByLabel("新增短期计划").inputValue(), "CI窗口草稿");
  await assert.rejects(
    win.evaluate(() =>
      window.boardHost.invoke("configureWindow", { mode: "ddl" }),
    ),
    /主程序/,
  );
  await assert.rejects(
    win.evaluate(() =>
      window.boardHost.invoke("removePacket", { id: "anything" }),
    ),
    /不支持/,
  );
  // Seed long lists using the same isolated storage and IPC as the editor.
  await win.evaluate(async () => {
    const v = await window.boardHost.invoke("load");
    v.snapshot.tasks = Array.from({ length: 18 }, (_, i) => ({
      id: "ci-task-" + i,
      planningId: v.snapshot.activePlanId,
      origin: "manual",
      title: "CI 滚轮事项 " + i,
      completedAt: null,
      archived: false,
      dueAt: i === 0 ? new Date().toISOString() : "2000-01-01T12:00:00.000Z",
      timePrecision: i === 0 ? "explicit" : "inferred",
    }));
    const saved = await window.boardHost.invoke("save", {
      snapshot: v.snapshot,
      stamp: v.stamp,
      sourceTokens: v.sourceTokens,
    });
    await window.boardHost.invoke("addFiles", {
      stamp: saved.stamp,
      planningId: saved.snapshot.activePlanId,
      files: Array.from({ length: 18 }, (_, i) => ({
        name: "CI 资料 " + i + ".txt",
        type: "text/plain",
        bytes: new Uint8Array([i]).buffer,
      })),
    });
  });
  await win.evaluate(() =>
    window.boardHost.invoke("configureWindow", { top: false }),
  );
  const windowId = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const board = all.find((w) => w.getTitle() === "拾序看板");
    all.find((w) => w !== board).focus();
    return board.id;
  });
  await board.getByRole("button", { name: "打开悬浮看板" }).click();
  await win.waitForFunction(() => document.hasFocus());
  assert.equal(
    await app.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.getFocusedWindow();
      return win?.id === id && !win.isAlwaysOnTop();
    }, windowId),
    true,
  );
  await win.reload();
  await board.getByLabel("卡面配色").selectOption("electric");
  await win.waitForFunction(
    () =>
      document.querySelector(".sx-floating")?.dataset.palette === "electric",
  );
  await board.locator(".sx-host-options summary").click();
  await board.getByLabel("浮窗透明度").fill("0.65");
  await win.waitForFunction(() =>
    getComputedStyle(
      document.querySelector(".sx-float-bar"),
    ).backgroundColor.endsWith("0.65)"),
  );
  await board.getByLabel("浮窗透明度").fill("1");
  await board.getByLabel("界面缩放").selectOption("1.25");
  await board.getByLabel("内容字号").selectOption("20");
  await win.locator(".sx-short .sx-task-title").first().waitFor();
  await win.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".sx-floating")).zoom ===
        "1.25" &&
      getComputedStyle(document.querySelector(".sx-short .sx-task-title"))
        .fontSize === "20px",
  );
  assert.equal(await board.evaluate((el) => getComputedStyle(el).zoom), "1");

  const checkFrame = async () => {
    const frame = win.locator(".sx-float-frame");
    await frame.evaluate((el) =>
      Promise.allSettled(
        el.getAnimations().map((animation) => animation.finished),
      ),
    );
    assert.equal(
      await frame.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const css = getComputedStyle(el);
        return (
          Math.abs(rect.left) < 1 &&
          Math.abs(rect.top) < 1 &&
          Math.abs(rect.right - innerWidth) < 1 &&
          Math.abs(rect.bottom - innerHeight) < 1 &&
          [
            css.borderTopWidth,
            css.borderRightWidth,
            css.borderBottomWidth,
            css.borderLeftWidth,
          ].every((width) => Math.abs(parseFloat(width) - 3) < 1) &&
          [
            css.borderTopLeftRadius,
            css.borderTopRightRadius,
            css.borderBottomLeftRadius,
            css.borderBottomRightRadius,
          ].every((radius) => radius === "9px")
        );
      }),
      true,
      "the frame fits the viewport independently of content zoom",
    );
    const edges = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "拾序看板")
        .capturePage();
      const { width, height } = image.getSize();
      const pixels = image.toBitmap({ scaleFactor: 1 });
      const isInk = (x, y) => {
        const i = (y * width + x) * 4;
        return (
          pixels[i] < 45 &&
          pixels[i + 1] < 45 &&
          pixels[i + 2] < 45 &&
          pixels[i + 3] > 240
        );
      };
      return [
        isInk(width >> 1, 1),
        isInk(width - 2, height >> 1),
        isInk(width >> 1, height - 2),
        isInk(1, height >> 1),
        !isInk(0, 0),
        !isInk(width - 1, 0),
        !isInk(width - 1, height - 1),
        !isInk(0, height - 1),
      ];
    });
    assert.deepEqual(
      edges,
      Array(8).fill(true),
      "each edge and rounded corner appears in the Windows compositor",
    );
  };
  for (const [mode, target] of [
    ["rail", "rail-board"],
    ["strip", "strip-board"],
    ["panel", "library-panel"],
    ["ddl", "ddl-panel"],
  ]) {
    await board.getByLabel("看板视图").selectOption(mode);
    await board.getByRole("button", { name: "打开悬浮看板" }).click();
    if (mode === "strip") {
      await win.getByLabel("展开小条").waitFor();
      await win.waitForFunction(() => innerHeight < 100);
      await checkFrame();
      await win.getByLabel("展开小条").click();
    }
    await win.getByTestId(target).waitFor();
    if (mode === "strip") await win.waitForFunction(() => innerHeight > 100);
    await app.evaluate(({ BrowserWindow }) => {
      const float = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "拾序看板",
      );
      float.setBounds({ ...float.getBounds(), width: 355, height: 215 });
    });
    await win.waitForFunction(
      () => Math.abs(innerWidth - 355) <= 2 && Math.abs(innerHeight - 215) <= 2,
    );
    await checkFrame();
    for (const zoom of ["0.65", "2", "1.25"]) {
      await board.getByLabel("界面缩放").selectOption(zoom);
      await win.waitForFunction(
        (value) =>
          getComputedStyle(document.querySelector(".sx-floating")).zoom ===
          value,
        zoom,
      );
      await checkFrame();
    }
    const scroller = win.locator(".sx-board-content");
    await scroller.evaluate((el) =>
      Promise.allSettled(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    assert.equal(
      await scroller.evaluate((el) => getComputedStyle(el).scrollbarWidth),
      "none",
    );
    await scroller.hover({ position: { x: 60, y: 55 } });
    await win.mouse.wheel(0, 12000);
    await win
      .waitForFunction(
        () => {
          const el = document.querySelector(".sx-board-content");
          return (
            el.scrollTop > 0 &&
            el.scrollHeight - el.clientHeight - el.scrollTop <= 2
          );
        },
        null,
        { timeout: 4000 },
      )
      .catch(async (error) => {
        const dimensions = await scroller.evaluate((el) => [
          el.scrollTop,
          el.clientHeight,
          el.scrollHeight,
        ]);
        throw Error(`${mode} wheel: ${dimensions.join(", ")}`, {
          cause: error,
        });
      });
    if (env.SHIXU_BOARD_SCREENSHOTS) {
      await scroller.evaluate((el) => {
        el.scrollTop = 0;
      });
      await win.screenshot({
        path: path.join(env.SHIXU_BOARD_SCREENSHOTS, mode + ".png"),
      });
    }
    if (mode === "strip") {
      const mark = win.getByRole("checkbox", {
        name: "完成：CI 滚轮事项 0",
        exact: true,
      });
      await mark.check();
      await win
        .getByRole("checkbox", { name: "撤销完成：CI 滚轮事项 0", exact: true })
        .waitFor();
      assert.equal(
        await win.locator(".sx-strip-list [data-task-id=ci-task-0]").count(),
        1,
      );
      await win
        .getByRole("checkbox", { name: "撤销完成：CI 滚轮事项 0", exact: true })
        .uncheck();
      await win.evaluate(() => window.flushBoardDraft());
    }
    if (mode === "ddl") {
      const geometry = await win
        .locator(".sx-ddl-item:visible")
        .evaluateAll((cards) =>
          cards.map((c) => {
            const { x, width, height } = c.getBoundingClientRect();
            return [x, width, height].map(Math.round).join(",");
          }),
        );
      assert.equal(new Set(geometry).size, 1);
      await scroller.evaluate((el) => {
        el.scrollTop = 0;
      });
      await win.getByRole("button", { name: "今天", exact: true }).click();
      assert.equal(await win.locator(".sx-ddl-item:visible").count(), 1);
      assert.ok(
        await win
          .locator(".sx-ddl-window")
          .evaluate(
            (el) => el.getBoundingClientRect().width > innerWidth * 0.85,
          ),
      );
    }
  }
  console.log(
    "Isolated board window IPC, drafts, hide/restore, strip, topmost, four wheel scrollers, zoom, compositor borders/corners, foreground reuse, palette, transparency, retained ticks and DDL alignment/filter passed",
  );
} finally {
  await app?.close();
}
