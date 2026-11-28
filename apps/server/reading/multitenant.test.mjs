import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMultiUserService } from "../sync-multi-user.mjs";
import { ReadingLedger } from "./ledger.mjs";
import { readMaterial } from "./material.mjs";
import { createHash } from "node:crypto";

test(
  "four authenticated tenants share the live v4 scheduler without sharing records, budget or blocking ordinary queries",
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-v4-tenants-"));
    const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
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
    let running = 0,
      peak = 0;
    const completed = [];
    const service = createMultiUserService({
      directory: join(directory, "server"),
      secret: "synthetic-multi-account-secret-32-characters",
      wechat: async (code) => code,
      reading: {
        ledger,
        enabled: true,
        priceId: "fixture",
        modelVersion: "fixture",
        reader: async (file) => readMaterial(file),
        provider: async (sources) => {
          peak = Math.max(peak, ++running);
          await new Promise((done) => setTimeout(done, 40));
          running--;
          return {
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            result: {
              summary: "合成",
              warnings: [],
              items: [
                {
                  kind: "note",
                  title: "合成事项",
                  summary: "合成",
                  facts: [],
                  nextSteps: [],
                  uncertainties: [],
                  due: null,
                  evidence: [
                    {
                      sourceId: sources[0].id,
                      quote: sources[0].text.slice(0, 10),
                    },
                  ],
                },
              ],
            },
          };
        },
      },
    });
    await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${service.server.address().port}`;
    const request = async (binding, method, path, data, headers = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(binding ? { Authorization: "Bearer " + binding.token } : {}),
          ...headers,
        },
        ...(data
          ? { body: Buffer.isBuffer(data) ? data : JSON.stringify(data) }
          : {}),
      });
      const value = await response.json();
      if (!response.ok) throw Object.assign(Error(value.error), value);
      return value;
    };
    try {
      const bindings = [];
      for (const [index, invitation] of service.registry
        .generate(4)
        .entries()) {
        ledger.grantInitial(invitation.userId);
        service.registry.limits(invitation.userId, { requestsPerMinute: 1000 });
        const binding = await request(null, "POST", "/api/v3/activate/wechat", {
          invite: invitation.invite,
          code: "synthetic-" + index,
        });
        bindings.push(binding);
        const put = (data, version) =>
          request(binding, "POST", "/api/v3/operations", {
            epoch: binding.epoch,
            operation: {
              opId: crypto.randomUUID(),
              id: "packet",
              type: "put",
              baseVersion: version,
              data,
            },
          });
        let record = (
          await put(
            {
              text: "",
              captureDate: "2026-10-28",
              result: null,
              attachments: [],
            },
            0,
          )
        ).record;
        const body = Buffer.from(
          index === 0
            ? "合成长任务。".repeat(90000)
            : `第${index}个账号独立材料`,
        );
        const manifest = [
          {
            id: "original",
            name: "合成.txt",
            type: "text/plain",
            size: body.length,
            hash: createHash("sha256").update(body).digest("hex"),
          },
        ];
        const submission = await request(
          binding,
          "POST",
          "/api/v4/submissions",
          {
            submissionId: "upload",
            packetId: "packet",
            manifest,
            epoch: binding.epoch,
          },
        );
        await request(
          binding,
          "PUT",
          `/api/v4/submissions/upload/files/original`,
          body,
          {
            "Content-Type": "application/octet-stream",
            "X-Shixu-File-Name": encodeURIComponent("合成.txt"),
          },
        );
        record = (
          await request(binding, "POST", "/api/v4/submissions/upload/commit", {
            manifestHash: submission.manifestHash,
            epoch: binding.epoch,
            operation: {
              opId: "commit",
              id: "packet",
              type: "put",
              baseVersion: record.version,
              data: { attachments: manifest },
            },
          })
        ).record;
        binding.version = record.version;
      }
      await Promise.all(
        bindings.map((b, i) =>
          request(b, "POST", "/api/v4/tasks", {
            contractVersion: 1,
            id: "task_" + i,
            kind: "organize",
            packetId: "packet",
            epoch: b.epoch,
            baseVersion: b.version,
          }),
        ),
      );
      const queryMs = [];
      for (let attempt = 0; attempt < 100 && completed.length < 4; attempt++) {
        for (const [index, binding] of bindings.entries()) {
          const start = performance.now(),
            tasks = (await request(binding, "GET", "/api/v4/tasks")).tasks;
          queryMs.push(performance.now() - start);
          assert.equal(tasks.length, 1);
          assert.equal(tasks[0].id, "task_" + index);
          if (tasks[0].state === "done" && !completed.includes(index))
            completed.push(index);
        }
        await new Promise((done) => setTimeout(done, 5));
      }
      assert.equal(completed.length, 4);
      assert.ok(peak <= 3 && peak > 1);
      assert.notEqual(
        completed[0],
        0,
        "short tenants complete while long tenant yields",
      );
      await assert.rejects(
        request(bindings[1], "GET", "/api/v4/tasks/task_0"),
        (e) => e.code === "TASK_NOT_FOUND",
      );
      assert.ok(
        ledger.wallet(bindings[0].userId).spent >
          ledger.wallet(bindings[1].userId).spent,
      );
      queryMs.sort((a, b) => a - b);
      assert.ok(queryMs[Math.ceil(queryMs.length * 0.95) - 1] < 1000);
    } finally {
      await new Promise((done) => service.server.close(done));
      await service.drained();
      ledger.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
