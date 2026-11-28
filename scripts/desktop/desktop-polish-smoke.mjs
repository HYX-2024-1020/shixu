import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const env = {
  ...process.env,
  SHIXU_DATA_DIR: await mkdtemp(path.join(tmpdir(), "shixu-polish-")),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  assert.equal(await page.locator(".delivery-receipts").count(), 0);
  const begin = async () => {
    await page.locator(".bucket-app").dispatchEvent("dragover", {
      dataTransfer: await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.setData("text/plain", "test");
        return d;
      }),
    });
    await expect(
      page.getByText("松手，放进桶里。", { exact: true }),
    ).toBeVisible();
  };
  await begin();
  await page.evaluate(() =>
    window.dispatchEvent(new DragEvent("dragleave", { relatedTarget: null })),
  );
  await expect(page.locator(".bucket-drop-hint")).toHaveCount(0);
  await begin();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bucket-drop-hint")).toHaveCount(0);
  await begin();
  await page.evaluate(() => window.dispatchEvent(new Event("dragend")));
  await expect(page.locator(".bucket-drop-hint")).toHaveCount(0);
  await begin();
  await expect(page.locator(".bucket-drop-hint")).toHaveCount(0, {
    timeout: 3000,
  });
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("仍可继续输入");
  await page.evaluate(async () => {
    const now = new Date().toISOString(),
      text =
        "报名链接 https://example.com/form，参考资料 https://example.org/guide。",
      bytes = new TextEncoder().encode(text);
    await window.desktop.store("savePackets", [
      {
        id: "polish",
        text,
        sources: [{ id: "scan", name: "扫描通知 · 第1页", text }],
        attachments: [
          {
            id: "file",
            name: "通知.txt",
            type: "text/plain",
            size: bytes.length,
            bytes: bytes.buffer,
          },
        ],
        status: "ready",
        result: {
          summary: "测试",
          warnings: [],
          items: [
            {
              kind: "task",
              title: "查看报名通知",
              summary: "报名入口 https://example.com/form",
              facts: ["资料 https://example.org/guide"],
              evidence: [{ sourceId: "scan", quote: text }],
              sourceIds: ["scan"],
              due: null,
              nextSteps: [],
              uncertainties: [],
            },
          ],
        },
        itemIds: ["item"],
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
  const card = page.locator(".result-card").first();
  await card.getByLabel("更多事项操作").click();
  await expect(card.locator(".card-menu")).toHaveAttribute("open", "");
  await page.locator(".world-heading").click();
  await expect(card.locator(".card-menu")).not.toHaveAttribute("open");
  await app.evaluate(({ shell }) => {
    globalThis.openedLinks = [];
    shell.openExternal = async (url) => {
      globalThis.openedLinks.push(url);
    };
  });
  await card
    .getByRole("link", { name: "https://example.com/form", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(() => globalThis.openedLinks.length))
    .toBe(1);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await card
    .getByRole("button", { name: "查看 查看报名通知", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(
    detail.getByText("事项信息与修改记录", { exact: true }),
  ).not.toBeVisible();
  await expect(
    detail.getByRole("button", { name: "归档", exact: true }),
  ).toHaveCount(0);
  await expect(detail.getByText("更多操作", { exact: true })).toHaveCount(0);
  await detail.getByLabel("卡片操作", { exact: true }).click();
  await expect(
    detail.getByRole("button", { name: "分组", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".detail-action-menu")).not.toHaveAttribute(
    "open",
  );
  await detail
    .getByRole("heading", { name: "查看报名通知", exact: true })
    .click();
  const source = detail.getByLabel("预览 通知.txt", { exact: true });
  await expect(
    source.getByRole("link", {
      name: "https://example.org/guide",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://example.org/guide");
  await source
    .getByRole("link", { name: "https://example.org/guide", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(() => globalThis.openedLinks.length))
    .toBe(2);
  await page.screenshot({ path: "release/desktop-polish-detail.png" });
  await detail.getByLabel("关闭事项详情", { exact: true }).click();
  await card.getByRole("button", { name: "完成", exact: true }).click();
  await expect(card.locator(".completion-orbit")).toHaveClass(/is-checking/);
  await expect(card.locator(".completion-orbit svg")).toBeVisible();
  await expect(page.locator(".result-card")).toHaveCount(0);
  await page.getByLabel("结果范围").selectOption("done");
  await card
    .getByRole("button", { name: "撤销完成 / 归档", exact: true })
    .click();
  await page.getByLabel("结果范围").selectOption("active");
  await card
    .locator(".card-topline")
    .getByRole("button", { name: "删除事项", exact: true })
    .click();
  await expect(page.locator(".result-card")).toHaveCount(0);
  assert.equal(await page.getByText(/撤销.*删除|可撤销/).count(), 0);
  await page.getByLabel("结果范围").selectOption("trash");
  await card
    .getByRole("button", { name: "查看 查看报名通知", exact: true })
    .click();
  await page.getByRole("button", { name: "恢复事项", exact: true }).click();
  await page.getByLabel("结果范围").selectOption("active");
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "投递桶", exact: true }).click();
  assert.equal(await page.locator(".delivery-receipts").count(), 0);
  await page.screenshot({ path: "release/desktop-polish-home.png" });
  console.log(
    "PASS: drag leave/cancel/dragend/timeout recover; empty home; links in overview/extracted files open via native browser handler; click-away/Escape menus; bottom-right actions; check animation; top delete without undo; trash restore",
  );
} finally {
  await app.close();
}
