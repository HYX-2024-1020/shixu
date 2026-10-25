import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { accountUIFixture, fixtureItem } from "./account-ui-fixture.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
const { createSyncClient } = createRequire(import.meta.url)(
  "../miniprogram/lib/sync-client.js",
);
const fixture = await accountUIFixture();
delete fixture.env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env: fixture.env });
  const page = await app.firstWindow();
  await fixture.activate(page);
  await page.locator(".bucket-settings").click();
  await expect(page.getByLabel("邀请码", { exact: true })).toBeVisible();
  assert.equal(
    await page.getByLabel("DeepSeek API 密钥", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("同步服务地址", { exact: true }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => window.desktop.key("read")), "");
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("Windows 云同步 UI 合成投递");
  await page.locator(".bucket-send").click();
  await waitForPageState(page, async () =>
    (await window.desktop.store("packets")).some(
      (p) => p.result?.items?.length,
    ),
  );
  const enrolled = await fetch(fixture.base + "/api/v3/activate/wechat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invite: fixture.invitation.invite,
      code: "synthetic-mini-runtime",
    }),
  }).then((r) => r.json());
  let state;
  const mini = createSyncClient({
    protocolVersion: 3,
    read: () => state,
    write: (next) => {
      state = structuredClone(next);
    },
    request: async (method, api, data) => {
      const r = await fetch(fixture.base + api, {
        method,
        headers: {
          Authorization: `Bearer ${enrolled.token}`,
          "Content-Type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      const result = await r.json();
      if (!r.ok) throw Object.assign(Error(result.error), result);
      return result;
    },
  });
  await mini.sync();
  assert.ok(
    mini.records().some((r) => r.data?.text === "Windows 云同步 UI 合成投递"),
  );
  mini.put("phone-ui-probe", {
    id: "phone-ui-probe",
    text: "手机合成资料",
    sources: [],
    attachments: [],
    capturedAt: new Date().toISOString(),
    captureDate: "2026-10-25",
    status: "ready",
    result: {
      summary: "手机事项",
      warnings: [],
      items: [fixtureItem("手机送来的待办")],
    },
    itemIds: ["phone-item"],
    doneIds: [],
    itemState: {},
  });
  await mini.sync();
  await page.evaluate(() => window.desktop.cloud("sync"));
  await page.reload();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "手机送来的待办", exact: true }),
  ).toBeVisible();
  await page.locator(".bucket-settings").click();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "切回本机资料", exact: true }).click(),
  ]);
  await waitForPageState(
    page,
    async () => !(await window.desktop.cloud("status")).base,
  );
  assert.equal(
    (await page.evaluate(() => window.desktop.store("packets"))).length,
    0,
  );
  console.log(
    "PASS: invitation UI, main-process credential boundary, server AI, shared v3 queue and independent local workspace (synthetic)",
  );
} finally {
  await app?.close();
  await fixture.close();
}
