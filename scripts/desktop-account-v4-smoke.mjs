import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { accountUIFixture } from "./account-ui-fixture.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
import { readMaterial } from "../server/reading/material.mjs";
const root = await mkdtemp(join(tmpdir(), "shixu-account-v4-ui-")),
  ledger = new ReadingLedger(join(root, "ledger.sqlite"));
ledger.freezePrice({
  id: "fixture",
  model: "fixture",
  currency: "CNY",
  source: "synthetic",
  verifiedAt: 1,
  inputMicrosPerMillion: 1000000,
  cachedMicrosPerMillion: 100000,
  outputMicrosPerMillion: 1000000,
});
const fixture = await accountUIFixture(
  {},
  {
    reading: {
      credentials: true,
      enabled: false,
      ledger,
      priceId: "fixture",
      modelVersion: "fixture",
      reader: async (file) => readMaterial(file),
      provider: async () => {
        throw Error("unexpected provider call");
      },
    },
  },
);
delete fixture.env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env: fixture.env });
  const page = await app.firstWindow();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容", exact: true }),
  ).toBeEnabled();
  await page.locator(".bucket-settings").click();
  await page.getByLabel("账号名称", { exact: true }).fill("ui-tester");
  await page.getByLabel("登录密码", { exact: true }).fill("synthetic-password");
  await page
    .getByLabel("注册邀请码", { exact: true })
    .fill(fixture.invitation.invite);
  await page.getByRole("button", { name: "注册新账号", exact: true }).click();
  await waitForPageState(
    page,
    async () => !!(await window.desktop.cloud("status")).base,
  );
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.locator(".bucket-settings").click();
  await expect(
    page.getByRole("heading", { name: "设备与密码", exact: true }),
  ).toBeVisible();
  await page.getByLabel("登录密码", { exact: true }).fill("synthetic-password");
  await page
    .getByLabel("新密码", { exact: true })
    .fill("new-synthetic-password");
  await page
    .getByRole("button", { name: "修改密码并撤销全部设备", exact: true })
    .click();
  await waitForPageState(
    page,
    async () => (await window.desktop.cloud("status")).activation === "invalid",
  );
  await page
    .getByLabel("登录密码", { exact: true })
    .fill("new-synthetic-password");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.getByRole("button", { name: "账号登录", exact: true }).click(),
  ]);
  await expect(
    page.getByRole("textbox", { name: "往桶里放入内容", exact: true }),
  ).toBeEnabled();
  await waitForPageState(
    page,
    async () => (await window.desktop.cloud("status")).activation === "active",
  );
  const status = await page.evaluate(() => window.desktop.cloud("status"));
  assert.equal(status.account.wallet.granted, 20000000);
  assert.equal(status.devices.length, 1);
  console.log(
    JSON.stringify({
      synthetic: true,
      electronSourceUI: true,
      passwordRegistration: true,
      passwordChangeAndRevokeAll: true,
      relogin: true,
      initialGrantExactlyOnce: true,
      providerCalls: 0,
    }),
  );
} finally {
  await app?.close();
  await fixture.close();
  ledger.close();
  await rm(root, { recursive: true, force: true });
}
