import { test, expect } from "@playwright/test";
import { world } from "./current-ui";

test("AI split confirmation preserves source and dates, persists once and exposes no technical scope selector", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, body: "synthetic offline" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const url = "/src/bucket/store.ts",
      store = await import(url);
    const item = {
      title: "合成原卡",
      kind: "task",
      summary: "分别处理甲乙",
      facts: ["甲", "乙"],
      sourceIds: [],
      evidence: [],
      nextSteps: [],
      uncertainties: [],
      due: null,
    };
    await store.putPackets([
      {
        id: "split-packet",
        text: "合成原文",
        sources: [],
        attachments: [],
        status: "ready",
        error: "",
        doneIds: [],
        itemIds: ["source"],
        capturedAt: "2026-11-15T00:00:00Z",
        updatedAt: "2026-11-15T00:00:00Z",
        captureDate: "2026-11-15",
        result: { summary: "", warnings: [], items: [item] },
        itemState: {
          source: {
            chatCreations: {
              id: "synthetic-split",
              mode: "split",
              packetId: "split-packet",
              itemId: "source",
              beforeItem: item,
              beforeState: { status: "active" },
              patches: [
                { title: "合成甲", summary: "处理甲", facts: ["甲"] },
                { title: "合成乙", summary: "处理乙", facts: ["乙"] },
              ],
            },
          },
        },
      },
    ]);
  });
  await page.reload();
  await world(page);
  await page.getByRole("heading", { name: "合成原卡", exact: true }).click();
  await expect(page.getByLabel("卡片AI查询范围")).toHaveCount(0);
  await expect(page.getByText("待确认的拆分", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "确认保存这些卡片", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "合成甲", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "合成乙", exact: true }),
  ).toBeVisible();
  await page.reload();
  await world(page);
  await expect(page.locator(".result-card")).toHaveCount(2);
  await page.getByLabel("结果范围", { exact: true }).selectOption("trash");
  await expect(
    page.getByRole("heading", { name: "合成原卡", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /合并已选/ })).toHaveCount(0);
});

test("conflicting card opens its exact sync resolution with a separate zero-queue conflict count", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("shixu-native-store-v1", "complete");
    const packet = {
      id: "conflict-card",
      text: "合成材料",
      syncConflict: true,
      sources: [],
      attachments: [],
      status: "error",
      result: null,
      error: "合成冲突",
      doneIds: [],
      capturedAt: "2026-11-15T00:00:00Z",
      updatedAt: "2026-11-15T00:00:00Z",
      captureDate: "2026-11-15",
    };
    const state = {
      base: "account:synthetic",
      activation: "active",
      materialConsentAccepted: true,
      pending: 0,
      conflicts: [
        { id: packet.id, text: packet.text, code: "REVISION_CONFLICT" },
      ],
      jobs: [],
      devices: [],
      error: "",
    };
    window.desktop = {
      key: async () => "",
      store: async (method) =>
        method === "packets"
          ? [packet]
          : method === "draft"
            ? { text: "", attachments: [] }
            : [],
      cloud: async (action) => {
        if (action === "resolve") {
          state.conflicts = [];
          packet.syncConflict = false;
        }
        return state;
      },
    } as any;
  });
  await page.goto("/");
  await world(page);
  await page
    .getByRole("button", { name: "处理此卡同步冲突", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "账号与设置" });
  await expect(
    dialog.getByRole("heading", { name: "同步", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("0 个操作待同步 · 1 个冲突");
  await dialog
    .getByRole("button", {
      name: "放弃本次待传修改，采用云端版本",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText("这张卡当前没有待处理冲突");
});
