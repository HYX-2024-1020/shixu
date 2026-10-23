import { waitForPageState } from "./desktop-test-wait.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(path.join(tmpdir(), "shixu-desktop-test-"));
const testEnv = { ...process.env, SHIXU_DATA_DIR: profile };
delete testEnv.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath: process.env.SHIXU_PACKAGED_EXE,
    args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
    env: testEnv,
  });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  assert.equal(page.url(), "shixu://app/");
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) => font.family === "Shixu Noto" && font.status === "loaded",
      ),
    ),
    true,
    "reference font must load from packaged assets",
  );
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.resolve();
    };
  });
  await page
    .getByRole("button", { name: "和小鲸鱼打个招呼", exact: true })
    .click();
  await page.getByRole("button", { name: "停止鲸鱼笑声", exact: true }).click();
  await page
    .getByRole("button", { name: "和小鲸鱼打个招呼", exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  await waitForPageState(
    page,
    () =>
      !document.querySelector('textarea[aria-label="往桶里放入内容"]').disabled,
  );
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["来源材料"], "拖入资料.txt", { type: "text/plain" }),
    );
    data.setData("text/plain", "拖入的相关文字");
    document.querySelector(".bucket-app").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }),
    );
  });
  await page.getByText("拖入资料.txt", { exact: true }).waitFor();
  assert.ok(
    (
      await page
        .getByRole("textbox", { name: "往桶里放入内容", exact: true })
        .inputValue()
    ).includes("拖入的相关文字"),
  );
  await page.evaluate(
    (data) => {
      const clipboard = new DataTransfer();
      clipboard.items.add(
        new File([new Uint8Array(data)], "粘贴截图.png", { type: "image/png" }),
      );
      clipboard.setData("text/plain", "截图附注");
      document
        .querySelector('textarea[aria-label="往桶里放入内容"]')
        .dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboard,
          }),
        );
    },
    Array.from(await readFile("public/desktop-icon.png")),
  );
  await page.getByAltText("已接收 粘贴截图.png", { exact: true }).waitFor();
  assert.ok(
    (
      await page
        .getByRole("textbox", { name: "往桶里放入内容", exact: true })
        .inputValue()
    ).includes("截图附注"),
  );
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("桌面重启验证：明天交报告");
  await page.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].show(),
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await waitForPageState(
    page,
    () =>
      document.querySelector('textarea[aria-label="往桶里放入内容"]')?.value ===
      "桌面重启验证：明天交报告",
  );
  await page.screenshot({ path: "release/desktop-smoke.png" });
  const original = await page.evaluate(async () =>
    new TextDecoder().decode(
      (await window.desktop.store("draft")).attachments[0].bytes,
    ),
  );
  assert.equal(original, "来源材料");
  assert.equal(
    await page.evaluate(
      async () => (await window.desktop.store("draft")).attachments.length,
    ),
    2,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(720, 600),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "连接与设置", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.route("https://api.deepseek.com/models", (route) =>
    route.fulfill({ json: { data: [{ id: "deepseek-flash" }] } }),
  );
  await page.getByRole("button", { name: "连接与设置", exact: true }).click();
  await page
    .getByLabel("DeepSeek API 密钥", { exact: true })
    .fill("dummy-key-for-settings-test");
  await page.getByLabel("在这台个人设备上记住密钥", { exact: true }).check();
  await page.getByRole("button", { name: "连接并开始", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.desktop.key("read")),
    "dummy-key-for-settings-test",
  );
  console.log(
    "PASS: bundled UI, renderer isolation, tray close/reopen, persisted draft after restart",
  );
  console.log("Isolated test profile:", profile);
} finally {
  await app?.close();
}
