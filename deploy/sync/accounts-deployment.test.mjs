import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMultiUserService } from "../../server/sync-multi-user.mjs";
import { backupAccounts } from "./backup-accounts.mjs";
import { verifyAccounts } from "./verify-accounts.mjs";

test("account deployment probe exercises real HTTP, restart, isolation, originals, deletion, AI replay and revocation without provider costs", async () => {
  const root = await mkdtemp(join(tmpdir(), "shixu-account-deployment-")),
    directory = join(root, "data");
  let service,
    base,
    calls = 0;
  const start = async () => {
    service = createMultiUserService({
      directory,
      secret: "fixture".repeat(8),
      aiLimits: {
        enabled: true,
        taskBudgetMicros: 250000,
        dailyBudgetMicros: 500000,
      },
      ai: {
        organize: async () => {
          calls++;
          return {
            result: {
              summary: "合成",
              items: [{ title: "测试报告", kind: "task" }],
              warnings: [],
            },
          };
        },
        chat: async () => {
          calls++;
          return { reply: "已加星标", patch: { starred: true } };
        },
      },
    });
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${service.server.address().port}`;
  };
  const stop = () => new Promise((done) => service.server.close(done));
  try {
    await start();
    // Restart on the same port; keep the administrator's independent connection.
    const { AccountRegistry } = await import("../../server/sync-accounts.mjs");
    const registry = new AccountRegistry(directory, "fixture".repeat(8));
    try {
      const port = service.server.address().port;
      const report = await verifyAccounts(base, registry, {
        realAI: true,
        restart: async () => {
          await stop();
          service = createMultiUserService({
            directory,
            secret: "fixture".repeat(8),
            aiLimits: {
              enabled: true,
              taskBudgetMicros: 250000,
              dailyBudgetMicros: 500000,
            },
            ai: {
              organize: async () => {
                calls++;
                return {
                  result: {
                    summary: "合成",
                    items: [{ title: "测试报告", kind: "task" }],
                    warnings: [],
                  },
                };
              },
              chat: async () => {
                calls++;
                return { reply: "已加星标", patch: { starred: true } };
              },
            },
          });
          await new Promise((done) =>
            service.server.listen(port, "127.0.0.1", done),
          );
        },
      });
      assert.equal(report.reservedMicros, 500000);
      assert.equal(calls, 2);
      assert.equal(report.cleanedSyntheticRecords, true);
      assert.equal(
        registry.db
          .prepare("SELECT COUNT(*) AS n FROM accounts WHERE enabled=1")
          .get().n,
        0,
      );
    } finally {
      registry.close();
    }
    await assert.rejects(
      backupAccounts(directory, join(root, "backups")),
      /Stop/,
    );
    await stop();
    service = null;
    const snapshot = await backupAccounts(directory, join(root, "backups"), {
      serviceStopped: true,
    });
    assert.ok((await readdir(snapshot)).includes("accounts.sqlite"));
    assert.ok((await readdir(join(snapshot, "users"))).length === 2);
  } finally {
    if (service) await stop();
    assert.ok(root.startsWith(join(tmpdir(), "shixu-account-deployment-")));
    await rm(root, { recursive: true, force: true });
  }
});
