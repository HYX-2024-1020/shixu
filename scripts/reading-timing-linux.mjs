import assert from "node:assert/strict";
import { mkdir, chmod, rm, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import http from "node:http";
import {
  createBrokerService,
  createBrokerClient,
} from "../server/reading/broker-service.mjs";
import { readMaterial, sha256 } from "../server/reading/material.mjs";

const root = resolve(process.argv[2] || "");
if (
  process.platform !== "linux" ||
  process.getuid() !== 0 ||
  !/^\/opt\/shixu-bcd-test-[\w-]+$/.test(root)
)
  throw Error("SYNTHETIC_ROOT_REQUIRED");
const socketDirectory = "/run/shixu-bcd-timing-socket",
  staging = "/run/shixu-bcd-timing-input";
await mkdir(socketDirectory, { mode: 0o700 });
await mkdir(staging, { mode: 0o700 });
await chmod(staging, 0o700);
let server;
const observations = [];
const file = (body, name = "合成.txt") => ({
  id: "a",
  name,
  body,
  size: body.length,
  hash: sha256(body),
});
const large = file(
  Buffer.from("中文😀完整材料。\n".repeat(300000) + "唯一尾部"),
);
const expected = readMaterial(large);
const expectedHash = sha256(expected.segments.map((s) => s.text).join(""));
try {
  server = await createBrokerService({
    socketPath: socketDirectory + "/reader.sock",
    runtime: "/opt/shixu-bcd-test-20261028/runtime",
    staging,
  });
  const reader = createBrokerClient(socketDirectory + "/reader.sock");
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const cancel of [false, true]) {
      let ready;
      const active = new Promise((resolve) => {
        ready = resolve;
      });
      const holder = reader(large, {
        onPhase: (p) => {
          if (p.phase === "active") ready();
        },
      });
      await active;
      const controller = new AbortController();
      let queued = false;
      const start = performance.now();
      let failure;
      try {
        await reader(cancel ? large : { ...large, hash: "0".repeat(64) }, {
          signal: controller.signal,
          onPhase: (p) => {
            if (p.phase === "queued") {
              queued = true;
              if (cancel) setTimeout(() => controller.abort(), 70);
            }
          },
        });
        assert.fail("expected failure");
      } catch (error) {
        failure = error;
      }
      const failureMs = performance.now() - start;
      const value = await holder;
      assert.equal(
        sha256(value.segments.map((s) => s.text).join("")),
        expectedHash,
      );
      assert.deepEqual(value.covered, expected.covered);
      assert.ok(
        queued,
        "second read must queue behind real isolated long input",
      );
      assert.equal(
        failure.message,
        cancel ? "READING_ABORTED" : "ISOLATED_READING_FAILED",
      );
      assert.ok(Number.isFinite(failure.timing?.waitingMs));
      assert.ok(failure.timing.waitingMs > 0);
      assert.ok(!failure.timingUncertain);
      observations.push({
        repeat,
        case: cancel ? "queued-cancellation" : "queued-integrity-failure",
        waitingMs: failure.timing.waitingMs,
        failureMs,
        elapsedMs: performance.now() - start,
        fullHashAndCoverageEqual: true,
      });
    }
    const start = performance.now();
    await assert.rejects(
      reader(large, { activeBudgetMs: 25 }),
      (error) =>
        error.message === "READING_ACTIVE_LIMIT" &&
        Number.isFinite(error.timing?.waitingMs),
    );
    observations.push({
      repeat,
      case: "remaining-active-deadline",
      budgetMs: 25,
      elapsedMs: performance.now() - start,
    });
    assert.deepEqual(await readdir(staging), []);
  }
  await new Promise((resolve) => server.close(resolve));
  server = null;
  const transportGuards = [];
  for (const fault of ["queue-full", "disconnect", "old-protocol"]) {
    server = http.createServer((req, res) => {
      req.resume();
      if (fault === "queue-full") {
        res.writeHead(429);
        res.end();
      } else if (fault === "old-protocol") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      } else {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write('{"type":"phase","phase":"queued"}\n');
        setTimeout(() => res.destroy(), 10);
      }
    });
    await new Promise((resolve) =>
      server.listen(socketDirectory + "/reader.sock", resolve),
    );
    await assert.rejects(reader(file(Buffer.from("测试😀"))), (error) =>
      fault === "queue-full"
        ? error.message === "READING_QUEUE_FULL" &&
          error.timing.waitingMs === 0 &&
          !error.timingUncertain
        : error.timingUncertain === true,
    );
    transportGuards.push({ fault, guarded: true });
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  const result = {
    synthetic: true,
    realProviderCalls: 0,
    node: process.version,
    longInputBytes: large.size,
    repeats: 5,
    maxProcessRssKiB: process.resourceUsage().maxRSS,
    scope:
      "real isolated parser and socket protocol, root-host client; ordinary UID dual-client loop separately tested",
    observations,
    transportGuards,
  };
  const json = JSON.stringify(result, null, 2) + "\n";
  if (process.argv[3]) await writeFile(resolve(process.argv[3]), json);
  else process.stdout.write(json);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(socketDirectory, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
}
