import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";

test(
  "Windows and mini item chat use signed v4 tasks, one root and wallet without re-reading originals",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-chat-clients-"));
    let chats = 0;
    try {
      await runClientLoop({
        directory,
        reader: (f, o) => readMaterial(f, o),
        original: {
          name: "合成.txt",
          type: "text/plain",
          body: Buffer.from("合成报告要求。".repeat(18000) + "尾部唯一标记"),
        },
        itemChat: {
          provider: async (sources) => {
            chats++;
            assert.equal(sources.length, 1);
            const context = JSON.parse(sources[0].text);
            assert.equal(context.schema, "saved-item-chat/1");
            assert.match(context.scope, /没有重新读取原件/);
            assert.ok(!JSON.stringify(context).includes("尾部唯一标记"));
            return {
              usage: { prompt_tokens: 10, completion_tokens: 10 },
              result: {
                reply: "已修改当前事项",
                patch: { group: chats === 1 ? "Windows组" : "微信组" },
              },
            };
          },
          verify: async ({
            win,
            page,
            cloud,
            service,
            ledger,
            account,
            parserRuns,
          }) => {
            const itemId = win.itemIds[0],
              beforeCalls = cloud.readJobs()[0].rootCalls;
            const beforeSpent = ledger.wallet(account).spent,
              reads = parserRuns();
            const wait = async () => {
              while (service.readingRoutes.snapshot().accounts)
                await new Promise((r) => setTimeout(r, 10));
              await cloud.action("sync");
              await page.sync();
            };
            assert.equal(cloud.accountState.reading.features.itemChat, true);
            await cloud.createAI({
              kind: "chat",
              packetId: "packet",
              itemId,
              instruction: "放到Windows组",
            });
            await wait();
            const first = cloud
              .readJobs()
              .find((j) => j.request.kind === "chat");
            assert.equal(first.state, "done");
            assert.equal(first.rootCalls, beforeCalls + 1);
            assert.equal(first.request.itemId, itemId);
            assert.match(first.contextScope, /没有重新读取原件/);
            assert.equal(
              (await cloud.packets())[0].itemState[itemId].group,
              "Windows组",
            );
            // Drop local job copies to exercise remote discovery of kind/itemId.
            cloud.writeJobs([]);
            await cloud.action("sync");
            assert.equal(
              cloud.readJobs().find((j) => j.id === first.id).request.kind,
              "chat",
            );
            await page._startJob("chat", "packet", itemId, "放到微信组");
            assert.equal(page.data.error, "");
            await wait();
            const after = (await cloud.packets())[0],
              mini = page._record("packet").data;
            assert.equal(after.itemState[itemId].group, "微信组");
            assert.deepEqual(
              after.itemState[itemId].chat,
              JSON.parse(JSON.stringify(mini.itemState[itemId].chat)),
            );
            assert.equal(after.itemState[itemId].chat.length, 4);
            assert.deepEqual(after.readingCoverage, win.readingCoverage);
            assert.equal(ledger.wallet(account).spent, beforeSpent + 40);
            assert.equal(chats, 2);
            assert.equal(parserRuns(), reads);
            assert.equal(
              cloud.readJobs().filter((j) => j.request.kind === "chat").length,
              2,
            );
            assert.ok(
              cloud
                .readJobs()
                .filter((j) => j.request.kind === "chat")
                .every((j) => j.rootTaskId === first.rootTaskId),
            );
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
