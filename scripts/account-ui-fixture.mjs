import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMultiUserService } from "../server/sync-multi-user.mjs";
import { waitForPageState } from "./desktop-test-wait.mjs";
export function fixtureItem(title = "合成事项", summary = title) {
  return {
    kind: "task",
    title,
    summary,
    facts: [],
    nextSteps: [],
    uncertainties: [],
    evidence: [],
    sourceIds: ["input"],
    due: null,
  };
}
export async function accountUIFixture(ai = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "shixu-account-ui-"));
  const service = createMultiUserService({
    directory: path.join(root, "server"),
    secret: "synthetic-ui-secret-with-32-characters",
    wechat: async (code) => code,
    aiLimits: { enabled: true, taskBudgetMicros: 10, dailyBudgetMicros: 10000 },
    ai: {
      organize: async (packet) => ({
        result: {
          summary: "合成整理",
          items: [
            fixtureItem(
              packet.text.includes("相册") ? "整理相册" : "提交英语报告",
              packet.text,
            ),
          ],
          warnings: [],
        },
      }),
      chat: async () => ({ reply: "已按指令修改", patch: { starred: true } }),
      ...ai,
    },
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${service.server.address().port}`,
    [invitation] = service.registry.generate();
  // Synthetic harness gets a generous request rate; production keeps its default.
  service.registry.limits(invitation.userId, {
    requestsPerMinute: 1000,
    dailyJobs: 100,
  });
  return {
    service,
    root,
    base,
    invitation,
    env: {
      ...process.env,
      SHIXU_DATA_DIR: path.join(root, "profile"),
      SHIXU_TEST_SERVICE_ORIGIN: base,
    },
    async activate(page, copySyntheticLocal = false) {
      await page
        .getByRole("textbox", { name: "往桶里放入内容", exact: true })
        .waitFor();
      const saved = copySyntheticLocal
        ? await page.evaluate(() => window.desktop.store("packets"))
        : [];
      await page.locator(".bucket-settings").click();
      await page.getByLabel("邀请码", { exact: true }).fill(invitation.invite);
      await page
        .getByRole("button", { name: "激活此设备", exact: true })
        .click();
      await waitForPageState(
        page,
        async () => !!(await window.desktop.cloud("status")).base,
      );
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page
        .getByRole("textbox", { name: "往桶里放入内容", exact: true })
        .waitFor();
      await waitForPageState(
        page,
        () => !document.querySelector("textarea").disabled,
      );
      if (saved.length) {
        await page.evaluate(
          (rows) =>
            window.desktop.store(
              "savePackets",
              rows.map((p) => ({ ...p, syncVersion: undefined })),
            ),
          saved,
        );
        await page.evaluate(() => window.desktop.cloud("sync"));
        await page.reload();
        await page
          .getByRole("textbox", { name: "往桶里放入内容", exact: true })
          .waitFor();
      }
    },
    async close() {
      await new Promise((done) => service.server.close(done));
      if (!root.startsWith(path.join(tmpdir(), "shixu-account-ui-")))
        throw Error("Unsafe test cleanup");
      await rm(root, { recursive: true, force: true });
    },
  };
}
