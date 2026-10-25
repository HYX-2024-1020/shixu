import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { accountUIFixture, fixtureItem } from "./account-ui-fixture.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
let calls = 0;
const fixture = await accountUIFixture({
  organize: async (packet) => {
    calls++;
    return {
      result: {
        summary: "已读取 UTF-8 原件",
        items: [
          fixtureItem("提交报告", packet.sources.map((s) => s.text).join("\n")),
        ],
        warnings: [],
      },
    };
  },
});
delete fixture.env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env: fixture.env });
try {
  const page = await app.firstWindow();
  await fixture.activate(page);
  const bytes = await readFile("public/desktop-icon.png");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "合成截图.png",
      mimeType: "image/png",
      buffer: bytes,
    });
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("合成二进制附件，不能假装已读取");
  await page.locator(".bucket-send").click();
  await waitForPageState(page, async () =>
    (await window.desktop.store("packets")).some((p) => p.status === "error"),
  );
  let [packet] = await page.evaluate(() => window.desktop.store("packets"));
  assert.equal(packet.attachments.length, 1);
  assert.deepEqual(
    await page.evaluate(async () =>
      Array.from(
        new Uint8Array(
          (await window.desktop.store("packets"))[0].attachments[0].bytes,
        ),
      ),
    ),
    Array.from(bytes),
  );
  assert.equal(calls, 0);
  assert.match(packet.error, /尚未支持读取|部分原件/);
  await page.reload();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  [packet] = await page.evaluate(() => window.desktop.store("packets"));
  assert.deepEqual(
    await page.evaluate(async () =>
      Array.from(
        new Uint8Array(
          (await window.desktop.store("packets"))[0].attachments[0].bytes,
        ),
      ),
    ),
    Array.from(bytes),
  );
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("明天交报告");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "合成通知.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("报告需要电子版和附件。"),
    });
  await page.locator(".bucket-send").click();
  await waitForPageState(page, async () =>
    (await window.desktop.store("packets")).some(
      (p) => p.result?.items?.[0]?.title === "提交报告",
    ),
  );
  const ready = (
    await page.evaluate(() => window.desktop.store("packets"))
  ).find((p) => p.result);
  assert.ok(ready.sources.some((s) => s.text.includes("电子版和附件")));
  assert.equal(calls, 1);
  assert.equal(await page.evaluate(() => window.desktop.key("read")), "");
  await expect(page.locator(".bucket-toast")).toHaveCount(0, {
    timeout: 10000,
  });
  console.log(
    "PASS: binary original retained without fake reading or model charges; UTF-8 original read by server and organized; bytes survive restart",
  );
} finally {
  await app.close();
  await fixture.close();
}
