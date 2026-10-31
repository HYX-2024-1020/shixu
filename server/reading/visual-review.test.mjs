import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodePng } from "./image.mjs";
import { readMaterial } from "./material.mjs";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
import { ReadingTasks } from "./tasks.mjs";
import {
  visualClaims,
  validateVisualReview,
  projectVisualReview,
} from "./visual-review.mjs";
const usage = { prompt_tokens: 10, completion_tokens: 10 };
const result = (id) => ({
  summary: "提交报告",
  warnings: [],
  items: [
    {
      kind: "task",
      title: "提交报告",
      summary: "按要求提交",
      facts: ["格式PDF", "需在报告尾部写9537"],
      nextSteps: ["建议导出PDF", "建议在报告尾部写9537"],
      uncertainties: [],
      due: null,
      evidence: [{ sourceId: id, quote: "格式PDF" }],
    },
  ],
});
function decisions(claims) {
  return {
    claims: claims.map((c) => ({
      id: c.id,
      status: c.text.includes("尾部写9537")
        ? "unsupported"
        : c.field === "nextSteps"
          ? "suggestion"
          : "supported",
      reason: c.text.includes("尾部写9537") ? "页尾标记不构成报告要求" : "",
    })),
  };
}
function fixture(t, review, sourceBytes) {
  let calls = 0,
    reviews = 0;
  const provider = Object.assign(
    async (sources) => {
      calls++;
      return { usage, result: result(sources[0].id) };
    },
    {
      imageInput: true,
      reviewVisual: async (...args) => {
        reviews++;
        return review
          ? review(...args)
          : { usage, result: decisions(JSON.parse(args[0][0].text).claims) };
      },
    },
  );
  const f = mergeFixture(t, {
    provider,
    sourceName: "合成.png",
    sourceBytes:
      sourceBytes || encodePng(2, 1, Buffer.from([1, 2, 3, 255, 4, 5, 6, 255])),
    reader: Object.assign((file, o) => readMaterial(file, o), {
      imageWindows: true,
      pdfWindows: true,
    }),
  });
  return { ...f, calls: () => calls, reviews: () => reviews };
}
test("actual PDF hallucination fixture preserves true requirements and moves footer inferences out of facts/steps", () => {
  const raw = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/bcd/evidence/pdf-visual-real-published.json",
        import.meta.url,
      ),
    ),
  ).result;
  const claims = visualClaims(raw, new Set(raw.items[0].sourceIds));
  const verdicts = claims.map((c) => ({
    id: c.id,
    status: c.text.includes("报告尾部") ? "unsupported" : "supported",
    reason: c.text.includes("报告尾部") ? "原文仅有页尾核对标记" : "",
  }));
  const before = JSON.stringify(raw),
    out = projectVisualReview(raw, claims, verdicts).result;
  assert.equal(JSON.stringify(raw), before);
  assert.equal(out.items[0].due.time, "16:45");
  assert.equal(out.items[0].facts.length, 4);
  assert.equal(out.items[0].nextSteps.length, 1);
  assert.ok(out.items[0].facts.some((t) => t.includes("算法思路与时间复杂度")));
  assert.equal(out.items[0].evidence.length, 5);
  assert.ok(
    out.items[0].uncertainties.some((t) => t.includes("需写在报告尾部")),
  );
  for (const invalid of [
    { claims: verdicts.slice(1) },
    { claims: [...verdicts.slice(1), verdicts[1]] },
    {
      claims: verdicts.map((v, n) => (n ? v : { ...v, status: "suggestion" })),
    },
  ])
    assert.throws(
      () => validateVisualReview(invalid, claims),
      /INVALID_VISUAL_REVIEW/,
    );
});
test("image review is separately billed, keeps raw paid result immutable, and publishes only grounded projection", async (t) => {
  const f = fixture(t);
  f.enqueue();
  assert.equal((await f.tasks.run("task")).state, "queued");
  assert.equal(f.calls(), 1);
  assert.equal(f.reviews(), 0);
  assert.equal(f.tasks.visual.publishable(f.tasks.get("task")), false);
  assert.equal(
    (await finishMerge(f.tasks)).state,
    "done",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.reviews(), 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  assert.equal(f.tasks.roots.stats("task").calls, 2);
  const item = f.store.record("packet").data.result.items[0];
  assert.deepEqual(item.facts, ["格式PDF"]);
  assert.deepEqual(item.nextSteps, ["建议导出PDF"]);
  assert.equal(item.uncertainties.length, 2);
  assert.ok(
    f.store.db
      .prepare("SELECT result FROM reading_blocks")
      .get()
      .result.includes("需在报告尾部写9537"),
  );
  assert.ok(
    !JSON.stringify(
      f.ledger.db.prepare("SELECT * FROM reading_visual_intents").all(),
    ).includes("格式PDF"),
  );
});
test("pending image review cannot be accepted partially or bypassed by disabling provider or editing tenant ranges", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  f.action("stop");
  // Only paused tasks may accept partial; interrupted is produced by shutdown.
  f.store.db
    .prepare("UPDATE reading_tasks SET state='paused' WHERE id='task'")
    .run();
  assert.throws(
    () => f.action("accept-partial"),
    (e) =>
      e.code === "VISUAL_REVIEW_REQUIRED" ||
      e.message === "VISUAL_REVIEW_REQUIRED",
  );
  delete f.tasks.provider.reviewVisual;
  const block = f.store.db.prepare("SELECT * FROM reading_blocks").get();
  assert.throws(
    () => f.tasks.visual.effective(f.tasks.get("task"), block),
    /VISUAL_REVIEW_REQUIRED/,
  );
  const ranges = JSON.parse(
    f.store.db.prepare("SELECT ranges FROM reading_block_ranges").get().ranges,
  );
  ranges[0].kind = "text";
  f.store.db
    .prepare("UPDATE reading_block_ranges SET ranges=?")
    .run(JSON.stringify(ranges));
  assert.throws(
    () => f.tasks.visual.effective(f.tasks.get("task"), block),
    /SAFETY_RECONCILIATION/,
  );
  assert.equal(f.reviews(), 0);
});
test("stopped review settles late usage without publication, and restart requires explicit continued review", async (t) => {
  let release, entered;
  const held = new Promise((r) => (release = r)),
    started = new Promise((r) => (entered = r));
  const f = fixture(t, async (sources) => {
    entered();
    await held;
    return { usage, result: decisions(JSON.parse(sources[0].text).claims) };
  });
  f.enqueue();
  await f.tasks.run("task");
  const pending = f.tasks.run("task");
  await started;
  f.action("stop");
  release();
  await pending;
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  assert.equal(f.store.record("packet").data.result, null);
  f.action("continue");
  assert.equal(
    (await finishMerge(f.tasks)).state,
    "done",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.reviews(), 2);
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
});
test("review envelope recovers after tenant write failure without a duplicate charge, missing settled decision fails closed", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  const prepare = f.store.db.prepare.bind(f.store.db);
  let fail = true;
  f.store.db.prepare = (sql) => {
    if (fail && sql.startsWith("INSERT INTO reading_visual_results")) {
      fail = false;
      throw Error("synthetic write failure");
    }
    return prepare(sql);
  };
  await f.tasks.run("task");
  f.store.db.prepare = prepare;
  assert.equal(f.reviews(), 1);
  assert.equal(f.tasks.get("task").state, "paused");
  f.action("continue");
  assert.equal(
    (await finishMerge(f.tasks)).state,
    "done",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.reviews(), 1);
  const row = prepare("SELECT * FROM reading_visual_results").get();
  prepare("DELETE FROM reading_visual_results").run();
  assert.throws(
    () =>
      f.tasks.visual.effective(
        f.tasks.get("task"),
        prepare("SELECT * FROM reading_blocks").get(),
      ),
    /VISUAL_REVIEW_REQUIRED/,
  );
  const job = { fingerprint: row.fingerprint, claims: [] };
  assert.ok(f.tasks.visual.proof("task", job.fingerprint));
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
});
test("unknown review cost cannot retry through continue, and invalid decisions settle but never publish", async (t) => {
  for (const unknown of [true, false]) {
    const f = fixture(t, async () => {
      if (unknown) throw Error("synthetic lost response");
      return { usage, result: { claims: [] } };
    });
    f.enqueue();
    await finishMerge(f.tasks);
    assert.equal(f.tasks.get("task").state, "paused");
    assert.equal(f.store.record("packet").data.result, null);
    assert.equal(f.reviews(), 1);
    if (unknown)
      assert.throws(
        () => f.action("continue"),
        (e) => ["UNKNOWN_COST", "LEDGER_PAUSED"].includes(e.code),
      );
    else assert.equal(f.ledger.wallet("synthetic").spent, 40);
  }
});
test("exact revision reuse verifies both paid stages without new calls; changed capture date invalidates them", async (t) => {
  const f = fixture(t);
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  f.enqueue("revision2");
  assert.equal(
    (await finishMerge(f.tasks, "revision2")).state,
    "done",
    JSON.stringify(f.tasks.get("revision2")),
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.reviews(), 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  f.put({ captureDate: "2026-11-01" });
  f.enqueue("revision3");
  assert.equal((await finishMerge(f.tasks, "revision3")).state, "done");
  assert.equal(f.calls(), 2);
  assert.equal(f.reviews(), 2);
});
test("restart revalidates immutable input, upstream and reviewer proofs; a changed tenant verdict cannot publish", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  await f.tasks.run("task");
  f.action("stop");
  const restarted = new ReadingTasks(f.args);
  f.action("continue", "task", restarted);
  assert.equal((await finishMerge(restarted)).state, "done");
  assert.equal(f.reviews(), 1);
  const row = f.store.db.prepare("SELECT * FROM reading_visual_results").get();
  const raw = JSON.parse(row.result);
  raw.claims[0].status = "unsupported";
  raw.claims[0].reason = "forged";
  f.store.db
    .prepare("UPDATE reading_visual_results SET result=?")
    .run(JSON.stringify(raw));
  assert.throws(
    () =>
      restarted.visual.effective(
        restarted.get("task"),
        f.store.db.prepare("SELECT * FROM reading_blocks").get(),
      ),
    /SAFETY_RECONCILIATION/,
  );
  assert.throws(
    () => f.ledger.db.prepare("DELETE FROM reading_visual_inputs").run(),
    /IMMUTABLE_VISUAL_PROOF/,
  );
  assert.throws(
    () =>
      f.ledger.db
        .prepare("UPDATE reading_visual_intents SET claims_hash='forged'")
        .run(),
    /IMMUTABLE_VISUAL_PROOF/,
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.reviews(), 1);
  restarted.close();
});
test("review overflow pauses without silently dropping rejected claims", () => {
  const raw = result("image");
  raw.items[0].facts = Array.from({ length: 9 }, (_, i) => "无依据要求" + i);
  const claims = visualClaims(raw, new Set(["image"]));
  assert.throws(
    () =>
      projectVisualReview(
        raw,
        claims,
        claims.map((c) => ({
          id: c.id,
          status: "unsupported",
          reason: "无依据",
        })),
      ),
    /VISUAL_REVIEW_CONTEXT_LIMIT/,
  );
});
test("review cannot reserve a new call when preflight exhausts the root time allowance", async (t) => {
  const f = fixture(t);
  f.enqueue();
  await f.tasks.run("task");
  const task = f.tasks.get("task"),
    block = f.store.db.prepare("SELECT * FROM reading_blocks").get();
  const file = f.store.record("packet").data.attachments[0];
  const body = encodePng(2, 1, Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]));
  const material = await readMaterial({ ...file, body });
  const batch = material.segments;
  const plan = f.tasks.visual.plan(task, batch, block);
  let checks = 0;
  f.tasks.provider.reviewVisual.prepare = () => ({
    maxPromptTokens: 10,
    maxOutputTokens: 10,
  });
  await assert.rejects(
    f.tasks.visual.step(task, batch, block, plan, {
      signal: new AbortController().signal,
      execution: {},
      remainingMs: () => (checks++ ? 0 : 1),
    }),
    /EXECUTION_LIMIT/,
  );
  assert.equal(f.reviews(), 0);
  assert.equal(f.tasks.roots.stats("task").calls, 1);
});
test("cross-image semantic merge consumes reviewed facts and binds every review proof", async (t) => {
  const f = fixture(
    t,
    undefined,
    encodePng(1025, 1, Buffer.alloc(1025 * 4, 255)),
  );
  let merges = 0;
  f.tasks.provider.merge = async (sources) => {
    merges++;
    const items = JSON.parse(sources[0].text).items;
    assert.ok(
      items.every((i) => !i.item.facts.some((s) => s.includes("尾部"))),
    );
    return {
      usage,
      result: { same: [[items[0].id, items[1].id]], related: [] },
    };
  };
  f.enqueue();
  assert.equal(
    (await finishMerge(f.tasks)).state,
    "done",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.calls(), 2);
  assert.equal(f.reviews(), 2);
  assert.equal(merges, 1);
  assert.equal(f.tasks.roots.stats("task").calls, 5);
  const item = f.store.record("packet").data.result.items[0];
  assert.deepEqual(item.facts, ["格式PDF"]);
  assert.equal(item.evidence.length, 2);
  assert.ok(item.uncertainties.some((s) => s.includes("需在报告尾部写9537")));
  const row = f.store.db
    .prepare("SELECT * FROM reading_visual_results LIMIT 1")
    .get();
  f.store.db
    .prepare("DELETE FROM reading_visual_results WHERE fingerprint=?")
    .run(row.fingerprint);
  assert.throws(
    () => f.tasks.merge.plan(f.tasks.get("task")),
    /VISUAL_REVIEW_REQUIRED/,
  );
});
