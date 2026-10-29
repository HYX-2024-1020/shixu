import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadingLedger } from "./ledger.mjs";
import { ReadingRootSafety } from "./root-safety.mjs";
import { readMaterial } from "./material.mjs";
import { runClientLoop } from "../../scripts/reading-client-loop.mjs";
import { spawnSync } from "node:child_process";

const snapshot = {
  calls: 24,
  activeMs: 1234,
  completed: 24,
  checkpointCalls: 24,
  reason: "",
  spent: 100,
  unknownRisk: 0,
};

test("a killed process leaves an independent execution fence even without any surviving tenant running state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shixu-safety-crash-"));
  try {
    const path = join(directory, "ledger.sqlite");
    const script = `import {ReadingLedger} from ${JSON.stringify(new URL("./ledger.mjs", import.meta.url).href)};
      import {ReadingRootSafety} from ${JSON.stringify(new URL("./root-safety.mjs", import.meta.url).href)};
      const ledger=new ReadingLedger(${JSON.stringify(path)});
      const guard=new ReadingRootSafety(ledger,"a"); guard.bind("p","t","t");guard.begin("t","t",1);
      process.stdout.write("fence committed");process.kill(process.pid,"SIGKILL");`;
    const killed = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 5000, maxBuffer: 4096 },
    );
    assert.equal(killed.error, undefined);
    assert.match(killed.stdout, /fence committed/);
    assert.notEqual(killed.status, 0);
    const ledger = new ReadingLedger(path);
    try {
      const guard = new ReadingRootSafety(ledger, "a");
      assert.equal(
        guard.observe("t", {
          ...snapshot,
          calls: 0,
          completed: 0,
          checkpointCalls: 0,
          activeMs: 0,
        }).reason,
        "ACTIVE_TIME_RECONCILIATION",
      );
    } finally {
      ledger.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("independent watermarks retain root identity, latch rollback and reject edits without storing input", () => {
  const ledger = new ReadingLedger(":memory:");
  try {
    const guard = new ReadingRootSafety(ledger, "a");
    assert.equal(guard.bind("packet", "first", "first"), "first");
    assert.equal(guard.bind("packet", "later", "later"), "first");
    assert.throws(
      () => guard.bind("other-packet", "first", "other"),
      /SAFETY_RECONCILIATION/,
    );
    const initial = guard.observe("first", snapshot);
    assert.equal(initial.reason, "");
    const older = guard.observe("first", {
      ...snapshot,
      activeMs: 0,
      completed: 0,
      checkpointCalls: 0,
    });
    assert.equal(older.activeMs, 1234);
    assert.equal(older.completed, 24);
    assert.equal(older.checkpointCalls, 24);
    assert.equal(older.reason, "SAFETY_RECONCILIATION");
    // Correct-looking tenant counters cannot self-authorize removing the gate.
    assert.equal(
      new ReadingRootSafety(ledger, "a").observe("first", snapshot).reason,
      "SAFETY_RECONCILIATION",
    );
    assert.deepEqual(guard.tasks("first"), ["first", "later"]);
    assert.equal(
      new ReadingRootSafety(ledger, "b").observe("first", {
        ...snapshot,
        activeMs: 0,
      }).reason,
      "",
    );
    for (const table of [
      "reading_safe_roots",
      "reading_safe_links",
      "reading_safe_events",
      "reading_safe_steps",
      "reading_safe_drains",
    ]) {
      if (table === "reading_safe_steps") guard.begin("first", "first", 1);
      if (table === "reading_safe_drains") {
        const step = guard.begin("first", "first", 2);
        guard.finish(step);
      }
      assert.throws(
        () => ledger.db.exec(`DELETE FROM ${table}`),
        /SAFETY_APPEND_ONLY/,
      );
    }
    assert.throws(
      () => ledger.db.exec("UPDATE reading_safe_events SET active_ms=0"),
      /SAFETY_APPEND_ONLY/,
    );
  } finally {
    ledger.close();
  }
});

test("an unconfirmed execution survives loss of queued tenant state while confirmed drains do not invent unknown time", () => {
  const ledger = new ReadingLedger(":memory:");
  try {
    const guard = new ReadingRootSafety(ledger, "a");
    guard.bind("p", "t", "t");
    const step = guard.begin("t", "t", 1);
    assert.equal(guard.observe("t", snapshot).reason, ""); // Still owned by this live executor.
    guard.finish(step);
    const restarted = new ReadingRootSafety(ledger, "a");
    assert.equal(restarted.observe("t", snapshot).reason, "");
    restarted.begin("t", "t", 2);
    const crashed = new ReadingRootSafety(ledger, "a");
    assert.equal(
      crashed.observe("t", snapshot).reason,
      "ACTIVE_TIME_RECONCILIATION",
    );
  } finally {
    ledger.close();
  }
});

test(
  "both clients retain cumulative time and deny continue after synthetic tenant rollback",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "shixu-safety-loop-"));
    try {
      const evidence = await runClientLoop({
        directory,
        reader: async (f) => readMaterial(f),
        rollbackRootAfterStop: true,
      });
      assert.equal(evidence.continueDenied, true);
      assert.equal(evidence.realProviderCalls, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
