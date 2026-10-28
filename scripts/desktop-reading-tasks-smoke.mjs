import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountUIFixture } from "./account-ui-fixture.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { readMaterial } from "../server/reading/material.mjs";
const root = await mkdtemp(join(tmpdir(), "shixu-v4-ui-ledger-"));
const ledger = new ReadingLedger(join(root, "ledger.sqlite"));
ledger.freezePrice({
  id: "fixture",
  model: "fixture",
  currency: "CNY",
  source: "synthetic UI fixture",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 100000,
  outputMicrosPerMillion: 1000000,
});
let calls = 0;
const reading = {
  enabled: true,
  ledger,
  reader: async (f) => readMaterial(f),
  priceId: "fixture",
  modelVersion: "synthetic/1",
  provider: async (sources, signal) => {
    if (++calls === 1)
      await new Promise((done) => {
        signal.addEventListener("abort", () => setTimeout(done, 30), {
          once: true,
        });
      });
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        summary: "合成摘要",
        warnings: [],
        items: [
          {
            kind: "note",
            title: "原件整理事项",
            summary: "保留来源",
            facts: [],
            nextSteps: [],
            uncertainties: [],
            due: null,
            evidence: [
              { sourceId: sources[0].id, quote: sources[0].text.slice(0, 10) },
            ],
          },
        ],
      },
    };
  },
};
const fixture = await accountUIFixture({}, { reading });
ledger.grantInitial(fixture.invitation.userId);
const remote = process.env.SHIXU_SYNTHETIC_REMOTE_ORIGIN;
if (remote) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(remote) ||
    !process.env.SHIXU_SYNTHETIC_REMOTE_INVITE
  )
    throw Error("SYNTHETIC_TUNNEL_REQUIRED");
  fixture.env.SHIXU_TEST_SERVICE_ORIGIN = remote;
}
delete fixture.env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env: fixture.env });
  const page = await app.firstWindow();
  if (remote) {
    await page
      .getByRole("textbox", { name: "往桶里放入内容", exact: true })
      .waitFor();
    await page.locator(".bucket-settings").click();
    await page
      .getByLabel("邀请码", { exact: true })
      .fill(process.env.SHIXU_SYNTHETIC_REMOTE_INVITE);
    await page.getByRole("button", { name: "激活此设备", exact: true }).click();
    await waitForPageState(
      page,
      async () => !!(await window.desktop.cloud("status")).base,
    );
    await page.getByRole("dialog").waitFor({ state: "detached" });
  } else await fixture.activate(page);
  await page.evaluate(async () => {
    const bytes = new TextEncoder().encode(
      "合成完整材料😀。\n".repeat(16000) + "尾部标记",
    ).buffer;
    await window.desktop.store("savePackets", [
      {
        id: "task-ui",
        text: "",
        sources: [],
        attachments: [
          { id: "original", name: "合成.txt", type: "text/plain", bytes },
        ],
        doneIds: [],
        capturedAt: "2026-10-28T00:00:00.000Z",
        captureDate: "2026-10-28",
        updatedAt: "2026-10-28T00:00:00.000Z",
        result: null,
        status: "pending",
      },
    ]);
    await window.desktop.cloud("sync");
    await window.desktop.cloud("ai", { kind: "organize", packetId: "task-ui" });
  });
  await page.locator(".bucket-settings").click();
  await expect(page.getByText(/累计已消费/)).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByText(/已停止 · 已调用/)).toBeVisible();
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await waitForPageState(page, async () => {
    await window.desktop.cloud("sync");
    return (
      (await window.desktop.store("packets")).find((p) => p.id === "task-ui")
        ?.result?.items?.length > 0
    );
  });
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await expect(page.getByText(/已发布 · 已调用/)).toBeVisible();
  const status = await page.evaluate(() => window.desktop.cloud("status"));
  assert.ok(status.account.wallet.spent > 0);
  assert.ok(status.jobs.find((j) => j.packetId === "task-ui")?.calls > 1);
  console.log(
    JSON.stringify({
      synthetic: true,
      realProviderCalls: 0,
      electronSourceUI: true,
      sshTunnelToIsolatedLinux: !!remote,
      originalUpload: true,
      stopContinueButtons: true,
      cumulativeWallet: true,
      published: true,
      simulatedCalls: status.jobs.find((j) => j.packetId === "task-ui")?.calls,
    }),
  );
} finally {
  await app?.close();
  await fixture.close();
  ledger.close();
  await rm(root, { recursive: true, force: true });
}
