import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImageClients } from "../../scripts/reading-image-clients.mjs";
import { readMaterial } from "./material.mjs";
import { mergeProgressView } from "../../shared/reading-view.mjs";
for (const deleted of [false, true])
  test(
    `visual review shares both signed client adapters and ${deleted ? "deleted" : "temporary"} original recovery`,
    { timeout: 30000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "shixu-visual-review-clients-"),
      );
      let reviewed = 0;
      try {
        await runImageClients({
          directory,
          deleted,
          reader: Object.assign((f, o) => readMaterial(f, o), {
            pdfWindows: true,
            imageWindows: true,
          }),
          visualReview: {
            provider: async (sources) => {
              reviewed++;
              const context = JSON.parse(sources[0].text);
              assert.ok(sources.some((s) => s.image));
              return {
                usage: { prompt_tokens: 10, completion_tokens: 10 },
                result: {
                  claims: context.claims.map((c) => ({
                    id: c.id,
                    status: "supported",
                    reason: "",
                  })),
                },
              };
            },
            verify: async ({ page, cloud, ledger, account }) => {
              const win = cloud.readJobs()[0],
                mini = page.data.jobs.find((j) => j.id === win.id);
              assert.ok(reviewed >= 3);
              assert.equal(win.state, mini.state);
              assert.equal(win.rootSpent, ledger.wallet(account).spent);
              assert.ok(win.completedVisualBatches >= 3);
              assert.equal(
                win.completedVisualBatches,
                mini.completedVisualBatches,
              );
            },
          },
        });
        assert.match(
          mergeProgressView("verifying", 0, reviewed),
          /图像依据核对/,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
