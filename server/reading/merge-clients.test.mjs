import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { readMaterial } from "./material.mjs";

test("semantic paid merges publish identical source unions through Windows and actual Page signed HTTP with shared progress/costs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-merge-clients-"));
  try {
    await runClientLoop({
      directory,
      reader: readMaterial,
      original: {
        name: "合成.txt",
        type: "text/plain",
        body: Buffer.from("合成报告要求。".repeat(18000) + "尾部唯一标记"),
      },
      semanticMerge: {
        provider: async (sources) => {
          const items = JSON.parse(sources[0].text).items;
          return {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: {
              same: items.slice(1).map((row) => [items[0].id, row.id]),
              related: [],
            },
          };
        },
        verify: async ({ win, mini, page, cloud }) => {
          assert.equal(win.result.items.length, 1);
          assert.equal(mini.result.items.length, 1);
          assert.deepEqual(win.result, JSON.parse(JSON.stringify(mini.result)));
          const ids = new Set(
            win.result.items[0].evidence.map((e) => e.sourceId),
          );
          assert.ok(
            ids.size > 1,
            "must preserve both blocks' original sources",
          );
          const job = cloud.readJobs()[0];
          assert.equal(job.phase, "merging");
          assert.equal(job.completedMergeBatches, 1);
          assert.match(
            page.data.jobs.find((j) => j.id === job.id).mergeLabel,
            /语义核对.*1 批.*累计费用/,
          );
        },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
