import test from "node:test";
import assert from "node:assert/strict";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
import { validateMerge, assembleMerge } from "./merge.mjs";
import { ReadingTasks } from "./tasks.mjs";

test("a notice that restates the same action can merge while retaining the action kind and every fact/source",()=>{
  const items=[{id:"notice",item:{kind:"notice",title:"报告通知",summary:"通知背景",facts:["PDF"],evidence:[{sourceId:"a",quote:"合成报告"}],due:null}},
    {id:"action",item:{kind:"task",title:"提交报告",summary:"提交实验报告",facts:["UTF-8源代码"],evidence:[{sourceId:"b",quote:"另附源代码"}],due:null}}];
  const decision=validateMerge({same:[["notice","action"]],related:[]},items);
  const merged=assembleMerge(items,[decision]);assert.equal(merged.items.length,1);assert.equal(merged.items[0].kind,"task");
  assert.equal(merged.items[0].title,"提交报告");assert.equal(merged.items[0].evidence.length,2);
  assert.ok(merged.items[0].facts.includes("PDF"));assert.ok(merged.items[0].facts.includes("UTF-8源代码"));
  assert.throws(()=>validateMerge({same:[["notice","action"]],related:[]},[{...items[0],item:{...items[0].item,kind:"idea"}},items[1]]),/INVALID_MERGE_CONFLICT/);
});

test("bounded semantic pairs visit distant chunk members without truncating any item",async t=>{
  let mergeCalls=0;
  const provider=Object.assign(async sources=>({usage:{prompt_tokens:10,completion_tokens:10},result:{summary:"合成40项",warnings:[],items:Array.from({length:40},(_,i)=>({kind:"task",title:"独立合成事项"+i,summary:"保留"+i,facts:["尾部要求"+i],nextSteps:[],uncertainties:[],due:null,evidence:[{sourceId:sources[0].id,quote:sources[0].text.slice(0,8)}]}))}}),{merge:async sources=>{
    mergeCalls++;const items=JSON.parse(sources[0].text).items;
    assert.ok(items.length<=32);assert.ok(Buffer.byteLength(sources[0].text)<120000);
    const ids=items.map(row=>row.id);
    return {usage:{prompt_tokens:10,completion_tokens:10},result:{same:ids.includes("b0i0")&&ids.includes("b0i39")?[["b0i0","b0i39"]]:[],related:[]}};
  }});
  const f=mergeFixture(t,{provider,sourceText:"合成短文本"});f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state,"done");assert.equal(mergeCalls,6);
  const items=f.store.record("packet").data.result.items;
  assert.equal(items.length,39);
  for(let i=0;i<40;i++)assert.ok(items.some(item=>item.facts.includes("尾部要求"+i)));
});

test("semantic grouping crosses paid blocks, keeps all facts, evidence, order and shared root costs", async (t) => {
  const f = mergeFixture(t);
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  const p = f.store.record("packet").data;
  assert.deepEqual(f.calls(), { organize: 2, merge: 1 });
  assert.equal(p.result.items.length, 1);
  for (const fact of ["格式PDF", "文件名学号_姓名"])
    assert.ok(p.result.items[0].facts.includes(fact));
  assert.equal(p.result.items[0].evidence.length, 2);
  assert.deepEqual(
    p.processingCoverage.processed,
    p.readingCoverage.flatMap((c) => c.covered),
  );
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
  assert.equal(f.tasks.roots.stats("task").calls, 3);
  assert.deepEqual(p.semanticMerge, {
    version: "paid-semantic-pairs/4",
    originalItems: 2,
    mergedItems: 1,
    complete: true,
  });
});

test("merge cannot invent ids, rewrite facts, merge conflicting due dates, or hide a transitive conflict", () => {
  const rows = [
    {
      id: "a",
      item: {
        kind: "task",
        facts: ["A"],
        due: { date: "2026-11-01", time: "17:00" },
      },
    },
    { id: "b", item: { kind: "task", facts: ["B"], due: null } },
    {
      id: "c",
      item: {
        kind: "task",
        facts: ["C"],
        due: { date: "2026-11-02", time: "17:00" },
      },
    },
  ];
  for (const invalid of [
    { same: [["a", "unknown"]], related: [] },
    { same: [["a", "a"]], related: [] },
    { same: [["a", "c"]], related: [] },
    { same: [["a", "b"]], related: [["b", "a"]] },
    { same: [], related: [], facts: ["invented"] },
  ])
    assert.throws(() => validateMerge(invalid, rows), /INVALID_MERGE/);
  assert.throws(
    () =>
      assembleMerge(rows, [
        {
          same: [
            ["a", "b"],
            ["b", "c"],
          ],
          related: [],
        },
      ]),
    /INVALID_MERGE_CONFLICT/,
  );
  const out = assembleMerge(rows, [
    { same: [["a", "b"]], related: [["b", "c"]] },
  ]);
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items[0].facts, ["A", "B"]);
  assert.deepEqual(out.related, [[0, 1]]);
});

test("paid merge survives tenant write failure, restart and publication failure without paying or duplicating twice", async (t) => {
  const f = mergeFixture(t);
  f.enqueue();
  await f.untilMerge();
  f.store.db.exec(
    "CREATE TRIGGER fail_merge BEFORE INSERT ON reading_merge_results BEGIN SELECT RAISE(ABORT,'INJECTED'); END;",
  );
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.deepEqual(f.calls(), { organize: 2, merge: 1 });
  f.store.db.exec("DROP TRIGGER fail_merge");
  const restart = new ReadingTasks(f.args);
  f.action("continue", "task", restart);
  await restart.run("task");
  const apply = f.store.apply.bind(f.store);
  f.store.apply = () => {
    throw Error("INJECTED_PUBLICATION");
  };
  assert.equal((await restart.run("task")).state, "paused");
  f.store.apply = apply;
  f.action("continue", "task", restart);
  assert.equal((await finishMerge(restart)).state, "done");
  assert.deepEqual(f.calls(), { organize: 2, merge: 1 });
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
  restart.close();
});

for (const mutation of [
  "lost-decision",
  "changed-decision",
  "changed-upstream",
  "lost-upstream",
  "forged-upstream-certificate",
])
  test(`independent merge dependencies reject ${mutation} without another payment`, async (t) => {
    const f = mergeFixture(t);
    f.enqueue();
    await f.untilMerge();
    await f.tasks.run("task");
    if (mutation === "lost-decision")
      f.store.db.exec("DELETE FROM reading_merge_results");
    if (mutation === "changed-decision")
      f.store.db.exec(
        `UPDATE reading_merge_results SET result='{"same":[],"related":[]}'`,
      );
    if (mutation === "lost-upstream")
      f.store.db.exec(
        "DELETE FROM reading_blocks WHERE rowid=(SELECT MIN(rowid) FROM reading_blocks)",
      );
    if (
      ["changed-upstream", "forged-upstream-certificate"].includes(mutation)
    ) {
      const row = f.store.db
          .prepare("SELECT * FROM reading_blocks LIMIT 1")
          .get(),
        result = JSON.parse(row.result);
      result.items[0].title = "篡改标题";
      f.store.db
        .prepare(
          "UPDATE reading_blocks SET result=? WHERE task=? AND fingerprint=?",
        )
        .run(JSON.stringify(result), row.task, row.fingerprint);
      if (mutation === "forged-upstream-certificate")
        f.store.db.exec("UPDATE reading_reuse_keys SET result_hash='forged'");
    }
    const state = await f.tasks.run("task");
    assert.equal(state.state, "paused");
    assert.equal(state.reason, "SAFETY_RECONCILIATION");
    assert.deepEqual(f.calls(), { organize: 2, merge: 1 });
    assert.equal(f.store.record("packet").data.result, null);
  });

test("stopping a merge fences late result, settles usage and continues only by explicit user action", async (t) => {
  let entered, resolve;
  const ready = new Promise((r) => (entered = r));
  const f = mergeFixture(t, {
    merge: async (sources) => {
      entered();
      await new Promise((r) => (resolve = r));
      const ids = JSON.parse(sources[0].text).items.map((i) => i.id);
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: { same: [[ids[0], ids[1]]], related: [] },
      };
    },
  });
  f.enqueue();
  await f.untilMerge();
  const running = f.tasks.run("task");
  await ready;
  f.action("stop");
  resolve();
  await running;
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
  assert.equal(f.store.record("packet").data.result, null);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) n FROM reading_merge_results").get().n,
    0,
  );
});

test("unknown merge fees share wallet gates and are never automatically retried", async (t) => {
  const f = mergeFixture(t, {
    merge: async () => {
      throw Error("transport loss");
    },
  });
  f.enqueue();
  await f.untilMerge();
  assert.equal((await f.tasks.run("task")).reason, "UNKNOWN_COST");
  assert.equal(f.ledger.wallet("synthetic").pausedReason, "UNKNOWN_COST");
  assert.throws(() => f.action("continue"), /UNKNOWN_COST/);
  assert.deepEqual(f.calls(), { organize: 2, merge: 1 });
});

test("cross-revision exact merge reuse requires every upstream hash; a changed paid item invalidates all old pairs", async (t) => {
  const f = mergeFixture(t);
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  // Same original content and model context creates a new explicit task. Reading
  // blocks and semantic decision are reused, rather than claiming semantic cache.
  f.enqueue("task2");
  assert.equal((await finishMerge(f.tasks, "task2")).state, "done");
  assert.deepEqual(f.calls(), { organize: 2, merge: 1 });
  f.put({ captureDate: "2026-11-01" });
  f.enqueue("task3");
  assert.equal((await finishMerge(f.tasks, "task3")).state, "done");
  assert.deepEqual(f.calls(), { organize: 4, merge: 2 });
});

test("invalid semantic output still settles usage, cannot publish, and partial acceptance preserves certified source items", async (t) => {
  const f = mergeFixture(t, {
    merge: async () => ({
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { same: [["invented", "b0i0"]], related: [] },
    }),
  });
  f.enqueue();
  await f.untilMerge();
  assert.equal((await f.tasks.run("task")).state, "paused");
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
  f.action("accept-partial");
  const packet = f.store.record("packet").data;
  assert.equal(packet.result.items.length, 2);
  assert.equal(packet.semanticMerge.complete, false);
  assert.ok(
    packet.result.warnings.some((w) => w.includes("语义核对尚未全部完成")),
  );
});
