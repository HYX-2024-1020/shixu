import { waitForPageState } from "./desktop-test-wait.mjs";
import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const profile = await mkdtemp(path.join(tmpdir(), "shixu-recovery-test-")),
  env = { ...process.env, SHIXU_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: process.env.SHIXU_PACKAGED_EXE,
  args: process.env.SHIXU_PACKAGED_EXE ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  let calls = 0;
  await page.route("https://api.deepseek.com/**", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    let result;
    if (Array.isArray(body.messages[1].content))
      result = { text: "明天提交报告电子版。", uncertainties: [] };
    else {
      const source = JSON.parse(body.messages[1].content).sources?.find(
        (s) => s.id !== "input",
      );
      result = {
        summary: "补充要求",
        items: source
          ? [
              {
                kind: "task",
                title: "提交报告",
                summary: "补充提交电子版",
                facts: ["提交电子版"],
                nextSteps: [],
                uncertainties: [],
                evidence: [
                  { sourceId: source.id, quote: "明天提交报告电子版。" },
                ],
                sourceIds: [source.id],
                due: null,
              },
            ]
          : [],
        warnings: [],
        links: [],
      };
    }
    await route.fulfill({
      json: {
        model: "deepseek-flash",
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(result) },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      },
    });
  });
  await page.evaluate(
    async (bytes) => {
      const text = "明天交报告";
      const item = {
        kind: "task",
        title: "人工改过的报告任务",
        summary: "人工确认的总结",
        facts: [text],
        nextSteps: [],
        uncertainties: [],
        evidence: [{ sourceId: "input", quote: text }],
        sourceIds: ["input"],
        due: null,
      };
      await window.desktop.store("savePackets", [
        {
          id: "recovery-packet",
          text,
          sources: [{ id: "input", name: "输入原文", text }],
          attachments: [
            {
              id: "image-original",
              name: "待重试.png",
              type: "image/png",
              size: bytes.length,
              bytes: new Uint8Array(bytes).buffer,
            },
          ],
          capturedAt: new Date().toISOString(),
          captureDate: "2026-10-23",
          updatedAt: new Date().toISOString(),
          status: "ready",
          error: "",
          doneIds: [0],
          result: { summary: "已有事项", items: [item], warnings: [] },
          itemIds: ["stable-original"],
          organizedSourceIds: ["input"],
          itemState: {
            "stable-original": {
              corrected: true,
              status: "done",
              importance: 2,
              starred: true,
            },
          },
          coverage: [
            {
              attachmentId: "image-original",
              name: "待重试.png",
              state: "failed",
              detail: "上次网络中断",
              sourceIds: [],
            },
          ],
        },
      ]);
      await window.desktop.key("save", "dummy-key-for-recovery-test");
    },
    Array.from(await readFile("public/desktop-icon.png")),
  );
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page.getByRole("button", { name: "整理记录", exact: true }).click();
  await page
    .getByRole("button", { name: "重试未读内容（保留已有修正）", exact: true })
    .click();
  await waitForPageState(page, async () => {
    const p = (await window.desktop.store("packets"))[0];
    return p.status === "ready" && p.proposedItems?.length === 1;
  });
  let [p] = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(p.result.items.length, 1);
  assert.equal(p.result.items[0].title, "人工改过的报告任务");
  assert.deepEqual(p.itemIds, ["stable-original"]);
  assert.equal(p.itemState["stable-original"].importance, 2);
  assert.deepEqual(p.doneIds, [0]);
  await page
    .locator(".proposal-form select[name=target]")
    .selectOption("stable-original");
  await page.getByRole("button", { name: "确认处理", exact: true }).click();
  await waitForPageState(
    page,
    async () =>
      !(await window.desktop.store("packets"))[0].proposedItems.length,
  );
  [p] = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(p.result.items.length, 1);
  assert.equal(p.result.items[0].title, "人工改过的报告任务");
  assert.ok(p.result.items[0].facts.includes("提交电子版"));
  assert.equal(p.itemState["stable-original"].status, "done");
  await page.evaluate(async () => {
    const p = (await window.desktop.store("packets"))[0];
    await window.desktop.store("savePackets", [
      {
        ...p,
        id: "interrupted-packet",
        result: null,
        itemIds: undefined,
        itemState: undefined,
        doneIds: [],
        status: "processing",
        organizedSourceIds: [],
        proposedItems: undefined,
      },
    ]);
    await window.desktop.store("saveUsage", {
      id: "pending-call",
      packetId: "interrupted-packet",
      startedAt: new Date().toISOString(),
      requestedModel: "deepseek-flash",
      model: "deepseek-flash",
      state: "pending",
      usage: null,
      cost: null,
    });
  });
  const before = calls;
  await page.reload();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await waitForPageState(
    page,
    async () =>
      (await window.desktop.store("packets")).find(
        (p) => p.id === "interrupted-packet",
      ).status === "error" &&
      (await window.desktop.store("usage")).find((u) => u.id === "pending-call")
        ?.state === "unreported",
  );
  const interrupted = await page.evaluate(async () => ({
    packet: (await window.desktop.store("packets")).find(
      (p) => p.id === "interrupted-packet",
    ),
    usage: await window.desktop.store("usage"),
  }));
  assert.equal(calls, before);
  assert.ok(interrupted.packet.sources.some((s) => s.id === "image-original"));
  assert.equal(
    interrupted.usage.find((u) => u.id === "pending-call").state,
    "unreported",
  );
  console.log(
    "PASS (mocked model): unread recovery preserves manual edits/status/identity, new findings require confirmation, merge adds evidence without duplicate items, interrupted jobs retain checkpoints without automatic resubmission",
  );
} finally {
  await app.close();
}
