import assert from "node:assert/strict";
import { runClientLoop } from "./reading-client-loop.mjs";
import { readMaterial } from "../server/reading/material.mjs";
import { buildGroups } from "../server/generated/ai-core.mjs";
export async function runAssociationClients({
  directory,
  reader,
  deleted = false,
} = {}) {
  let baseline,
    calls = 0;
  const report = await runClientLoop({
    directory,
    reader:
      reader ||
      Object.assign((f, o) => readMaterial(f, o), { pdfWindows: true }),
    sourceByMini: true,
    startByMini: true,
    ...(deleted
      ? { deleteBeforeStart: true }
      : { originalQuota: 1, expireBeforeStart: true }),
    semanticMerge: {
      provider: async (sources) => {
        const items = JSON.parse(sources[0].text).items;
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: {
            same: items.slice(1).map((i) => [items[0].id, i.id]),
            related: [],
          },
        };
      },
      verify: () => {},
    },
    historyAssociation: {
      async prepare({ cloud, page }) {
        const packets = await cloud.packets(),
          old = {
            id: "history",
            text: "",
            sources: [],
            attachments: [],
            captureDate: "2026-10-28",
            capturedAt: "2026-10-28T00:00:00.000Z",
            updatedAt: "2026-10-28T00:00:00.000Z",
            status: "ready",
            itemIds: ["previous-item", "done-item"],
            doneIds: [1],
            itemState: { "done-item": { status: "done" } },
            result: {
              summary: "合成历史",
              warnings: [],
              items: ["未完成合成事项", "已完成合成事项"].map((title, i) => ({
                kind: "task",
                title,
                summary: "历史合成",
                facts: ["原有事实"],
                nextSteps: [],
                uncertainties: [],
                due: null,
                evidence: [
                  { sourceId: "history-source" + i, quote: "历史合成依据" + i },
                ],
              })),
            },
          };
        await cloud.call("savePackets", [...packets, old], cloud.config.active);
        await cloud.action("sync");
        await page.sync();
        baseline = (await cloud.packets()).find((p) => p.id === "history");
      },
      provider: async (sources) => {
        calls++;
        const items = JSON.parse(sources[0].text).items,
          a = items.find((i) => i.role === "new"),
          b = items.find((i) => i.role === "history");
        assert.equal(items.filter((i) => i.role === "history").length, 1);
        return {
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          result: {
            links: [
              {
                from: a.id,
                target: b.id,
                relation: "related",
                title: "合成事项组",
                confidence: 0.98,
                newEvidence: a.item.evidence[0],
                oldEvidence: b.item.evidence[0],
              },
            ],
          },
        };
      },
      async verify({ win, mini, page, cloud }) {
        assert.equal(win.historyAssociation.complete, true);
        assert.equal(win.historyAssociation.candidates, 1);
        assert.deepEqual(
          win.association,
          JSON.parse(JSON.stringify(mini.association)),
        );
        assert.equal(win.association.links.length, 1);
        assert.equal(win.association.links[0].target, "history#previous-item");
        assert.equal(calls, 1);
        const old = (await cloud.packets()).find((p) => p.id === "history"),
          miniOld = page._record("history").data;
        assert.deepEqual(old.result, baseline.result);
        assert.deepEqual(old.doneIds, baseline.doneIds);
        assert.deepEqual(old.itemState, baseline.itemState);
        assert.deepEqual(
          old.result,
          JSON.parse(JSON.stringify(miniOld.result)),
        );
        const groups = buildGroups([win, old]);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].units.length, 2);
        assert.equal(groups[0].refs.length, 2);
        const job = cloud.readJobs()[0];
        assert.equal(job.phase, "associating");
        assert.equal(job.completedAssociationBatches, 1);
        assert.match(
          page.data.jobs.find((j) => j.id === job.id).mergeLabel,
          /历史事项关联.*1 批/,
        );
      },
    },
  });
  return {
    ...report,
    historyAssociationProviderCalls: calls,
    unchangedHistoryBoth: true,
    completedItemExcluded: true,
  };
}
