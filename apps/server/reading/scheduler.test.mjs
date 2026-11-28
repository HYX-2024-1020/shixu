import test from "node:test";
import assert from "node:assert/strict";
import { createReadingScheduler } from "./scheduler.mjs";
test("long account yields after every block, short account completes and global slots stay bounded", async () => {
  const scheduler = createReadingScheduler({ concurrency: 1 });
  const order = [];
  const engine = (account, steps) => ({
    account,
    async run() {
      order.push(account);
      return { state: --steps ? "queued" : "done" };
    },
    close() {},
  });
  const long = scheduler.submit(engine("long", 4), "a"),
    short = scheduler.submit(engine("short", 1), "b");
  await Promise.all([long, short]);
  assert.deepEqual(order, ["long", "short", "long", "long", "long"]);
  assert.deepEqual(scheduler.snapshot(), {
    running: 0,
    waiting: 0,
    accounts: 0,
  });
  scheduler.close();
});
test("account slot, queue backpressure and three global model slots cannot be bypassed", async () => {
  const scheduler = createReadingScheduler({ concurrency: 3, waitingLimit: 2 });
  let running = 0,
    peak = 0;
  const engine = (account) => ({
    account,
    async run() {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { state: "done" };
    },
    close() {},
  });
  const a = engine("a"),
    first = scheduler.submit(a, "a");
  await assert.rejects(scheduler.submit(a, "other"), /TASK_SLOT_FULL/);
  const second = scheduler.submit(engine("b"), "b");
  await assert.rejects(scheduler.submit(engine("c"), "c"), /QUEUE_FULL/);
  await Promise.all([first, second]);
  assert.ok(peak <= 3);
  scheduler.close();
});
