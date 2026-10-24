import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createSyncService } from "../server/sync-server.mjs";
import { createRequire } from "node:module";
import { waitForPageState } from "./desktop-test-wait.mjs";
const require = createRequire(import.meta.url);
const { createSyncClient } = require("../miniprogram/lib/sync-client.js");
const root = await mkdtemp(path.join(tmpdir(), "shixu-cloud-ui-"));
const password = "synthetic-cloud-ui-passphrase";
const service = createSyncService({
  database: path.join(root, "server.sqlite"),
  password,
});
await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${service.server.address().port}`;
const env = { ...process.env, SHIXU_DATA_DIR: path.join(root, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await waitForPageState(
    page,
    () =>
      !!document.querySelector("textarea") &&
      !document.querySelector("textarea").disabled,
  );
  await page.locator(".bucket-settings").click();
  await page.getByLabel("同步服务地址", { exact: true }).fill(base);
  await page.getByLabel("同步访问口令", { exact: true }).fill(password);
  await page.getByRole("button", { name: "连接云端资料", exact: true }).click();
  await waitForPageState(
    page,
    async () => !!(await window.desktop.cloud("status")).base,
  );
  await waitForPageState(
    page,
    () =>
      !!document.querySelector("textarea") &&
      !document.querySelector("textarea").disabled,
  );
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("Windows 云同步 UI 合成投递");
  await page.locator(".bucket-send").click();
  await waitForPageState(page, async () =>
    (await window.desktop.store("packets")).some(
      (p) => p.text === "Windows 云同步 UI 合成投递",
    ),
  );
  await page.evaluate(() => window.desktop.cloud("sync"));
  const d = await fetch(base + "/api/v2/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, name: "synthetic mini runtime" }),
  }).then((r) => r.json());
  const mini = createSyncClient({
    read: () => null,
    write: () => {},
    request: async (method, api, data) => {
      const r = await fetch(base + api, {
        method,
        headers: {
          Authorization: `Bearer ${d.token}`,
          "Content-Type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      const body = await r.json();
      if (!r.ok) throw Object.assign(Error(body.error), body);
      return body;
    },
  });
  await mini.sync();
  assert.ok(
    mini.records().some((r) => r.data?.text === "Windows 云同步 UI 合成投递"),
  );
  mini.put("phone-ui-probe", {
    id: "phone-ui-probe",
    text: "手机端合成资料",
    sources: [],
    attachments: [],
    capturedAt: "2026-10-24T01:00:00Z",
    captureDate: "2026-10-24",
    status: "ready",
    error: "",
    doneIds: [],
    itemIds: ["phone_item"],
    result: {
      summary: "手机事项",
      warnings: [],
      items: [
        {
          kind: "task",
          title: "手机送来的待办",
          summary: "验证跨端展示",
          facts: [],
          nextSteps: [],
          uncertainties: [],
          sourceIds: [],
          evidence: [],
          due: null,
        },
      ],
    },
  });
  await mini.sync();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "整理结果", exact: true }).click();
  await page
    .getByText("手机送来的待办", { exact: true })
    .waitFor({ timeout: 20000 });
  assert.equal(
    await page.evaluate(
      async () =>
        (await window.desktop.store("packets")).find(
          (p) => p.id === "phone-ui-probe",
        ).syncAutoOrganize,
    ),
    false,
  );
  await page.locator(".bucket-settings").click();
  await page.getByRole("button", { name: "切回本机资料", exact: true }).click();
  await waitForPageState(
    page,
    async () => !(await window.desktop.cloud("status")).base,
  );
  assert.equal(
    await page.evaluate(
      async () => (await window.desktop.store("packets")).length,
    ),
    0,
  );
  console.log(
    "PASS: real Windows cloud connection form, encrypted enrollment, UI capture to mini queue, phone task rendered, local/cloud isolation",
  );
} finally {
  if (app) await app.close();
  await new Promise((r) => service.server.close(r));
  await rm(root, { recursive: true, force: true });
}
