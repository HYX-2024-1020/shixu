import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { accountUIFixture, fixtureItem } from "./account-ui-fixture.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
let calls = 0,
  finish;
const gate = new Promise((done) => {
  finish = done;
});
const fixture = await accountUIFixture({
  organize: async () => {
    calls++;
    await gate;
    return {
      result: {
        summary: "合成结果",
        items: [fixtureItem("返回的合成事项")],
        warnings: [],
      },
    };
  },
});
delete fixture.env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env: fixture.env });
  const page = await app.firstWindow();
  await fixture.activate(page);
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .fill("任务处理中断网与重启，不能重复调用");
  await page.locator(".bucket-send").click();
  await waitForPageState(page, async () =>
    (await window.desktop.cloud("status")).jobs.some(
      (j) => j.state === "running" || j.state === "queued",
    ),
  );
  await page.reload();
  await page
    .getByRole("textbox", { name: "往桶里放入内容", exact: true })
    .waitFor();
  assert.equal(calls, 1);
  const [packet] = await page.evaluate(() => window.desktop.store("packets"));
  await page.evaluate(async (p) => {
    await window.desktop.store("savePackets", [
      { ...p, text: p.text + "，人工补充应保留", status: "pending" },
    ]);
    await window.desktop.cloud("sync");
  }, packet);
  finish();
  await waitForPageState(page, async () => {
    await window.desktop.cloud("sync");
    return (await window.desktop.cloud("status")).jobs.some(
      (j) => j.state === "conflict",
    );
  });
  const [saved] = await page.evaluate(() => window.desktop.store("packets"));
  assert.match(saved.text, /人工补充应保留/);
  assert.equal(saved.result, null);
  assert.equal(calls, 1);
  const state = await page.evaluate(() => window.desktop.cloud("status"));
  assert.ok(state.jobs[0].output);
  console.log(
    "PASS: server job survives client reload without recharging; a late paid result retains a conflict instead of overwriting manual edits",
  );
} finally {
  finish();
  await app?.close();
  await fixture.close();
}
