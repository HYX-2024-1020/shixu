import test from "node:test";
import assert from "node:assert/strict";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
import { validateAssociation } from "./association.mjs";
function history(f, count = 1) {
  for (let n = 0; n < count; n++)
    f.store.apply(
      f.device,
      {
        id: "old" + n,
        opId: "seed-old" + n,
        type: "put",
        baseVersion: 0,
        data: {
          text: "",
          sources: [],
          attachments: [],
          captureDate: "2026-10-31",
          status: "ready",
          itemIds: ["old-item"],
          doneIds: [],
          result: {
            summary: "",
            warnings: [],
            items: [
              {
                kind: "task",
                title: "历史实验" + n,
                summary: "已保存的算法实验",
                facts: ["原有事实" + n],
                nextSteps: [],
                uncertainties: [],
                due: null,
                evidence: [
                  { sourceId: "old-source" + n, quote: "算法实验" + n },
                ],
              },
            ],
          },
        },
      },
      f.store.epoch,
    );
}
function link(items, target) {
  const a = items.find((i) => i.role === "new"),
    b =
      items.find((i) => i.id === target) ||
      items.find((i) => i.role === "history");
  return {
    from: a.id,
    target: b.id,
    relation: "related",
    confidence: 0.98,
    title: "算法实验组",
    newEvidence: a.item.evidence[0],
    oldEvidence: b.item.evidence[0],
  };
}
test("paid history association visits all bounded candidates, publishes only links and keeps old contents, states, due and evidence unchanged", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法实验报告A7319" });
  history(f, 41);
  const before = f.store.record("old0");
  let calls = 0,
    max = 0;
  f.tasks.provider.association = async (sources) => {
    calls++;
    const context = JSON.parse(sources[0].text);
    assert.equal(context.schema, "saved-history-association/1");
    max = Math.max(max, context.items.length);
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        links: context.items.some((r) => r.id === "old40#old-item")
          ? [link(context.items, "old40#old-item")]
          : [],
      },
    };
  };
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(calls, 3);
  assert.ok(max <= 32);
  const p = f.store.record("packet").data;
  assert.equal(p.result.items.length, 1);
  assert.equal(p.association.links.length, 1);
  assert.equal(p.association.links[0].from, "packet#task_item_0");
  assert.equal(p.association.links[0].target, "old40#old-item");
  assert.equal(p.historyAssociation.candidates, 41);
  assert.equal(p.association.links[0].oldEvidence,undefined);
  assert.equal(p.association.links[0].newEvidence,undefined);
  assert.deepEqual(f.store.record("old0"), before);
  assert.equal(f.tasks.roots.stats("task").calls, 4);
  assert.equal(f.ledger.wallet("synthetic").spent, 80);
});
test("association requires both real stored quotes and rejects directions, cross-kind, conflicting dates and invented nodes", () => {
  const rows = [
    {
      id: "new:0",
      role: "new",
      item: {
        kind: "task",
        due: { date: "2026-11-01", time: "18:00" },
        evidence: [{ sourceId: "new-source", quote: "算法报告A7319" }],
      },
    },
    {
      id: "old#item",
      role: "history",
      unitDue: { date: "2026-11-02", time: "18:00" },
      item: {
        kind: "task",
        evidence: [{ sourceId: "old-source", quote: "算法报告A7319" }],
      },
    },
  ];
  const good = link(rows);
  assert.equal(validateAssociation({ links: [good] }, rows).links.length, 1);
  for (const raw of [
    { ...good, from: good.target, target: good.from },
    { ...good, target: "invented" },
    { ...good, newEvidence: { sourceId: "new-source", quote: "不存在引用" } },
    { ...good, relation: "same" },
    { ...good, confidence: 1.1 },
  ])
    assert.throws(
      () => validateAssociation({ links: [raw] }, rows),
      /INVALID_ASSOCIATION/,
    );
  assert.deepEqual(
    validateAssociation({ links: [{ ...good, confidence: 0.8 }] }, rows),
    { links: [] },
  );
});
test("a saved history change during a paid response settles it and blocks publication, never overwrites historical edits", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f);
  let calls = 0;
  f.tasks.provider.association = async (sources) => {
    calls++;
    const old = f.store.record("old0");
    f.store.apply(
      f.device,
      {
        id: "old0",
        opId: "manual-history",
        type: "put",
        baseVersion: old.version,
        data: { itemState: { "old-item": { status: "done" } } },
      },
      f.store.epoch,
    );
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [link(JSON.parse(sources[0].text).items)] },
    };
  };
  f.enqueue();
  const done = await finishMerge(f.tasks);
  assert.notEqual(done.state, "done");
  assert.equal(f.store.record("packet").data.result, null);
  assert.equal(
    f.store.record("old0").data.itemState["old-item"].status,
    "done",
  );
  assert.equal(calls, 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
});

test("more than 24 association calls advance the existing root checkpoint instead of imposing a total cap", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f, 401);
  let calls = 0;
  f.tasks.provider.association = async () => {
    calls++;
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [] },
    };
  };
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(calls, 26);
  assert.equal(f.tasks.roots.stats("task").calls, 27);
  assert.equal(f.tasks.roots.stats("task").nextCheckpointCalls, 48);
  assert.equal(
    f.store.record("packet").data.historyAssociation.candidates,
    401,
  );
});
test("unknown association fees pause the shared wallet and a missing certified decision never sends another request", async (t) => {
  for (const lost of [false, true]) {
    const f = mergeFixture(t, { sourceText: "算法报告A7319" });
    history(f);
    let calls = 0;
    f.tasks.provider.association = async (sources) => {
      calls++;
      if (!lost) throw Error("synthetic network");
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: { links: [link(JSON.parse(sources[0].text).items)] },
      };
    };
    f.enqueue();
    if (!lost) {
      const task = await finishMerge(f.tasks);
      assert.equal(task.reason, "UNKNOWN_COST");
      assert.equal(f.ledger.wallet("synthetic").pausedReason, "UNKNOWN_COST");
      assert.equal(calls, 1);
    } else {
      while (
        !f.store.db.prepare("SELECT 1 FROM reading_association_results").get()
      )
        await f.tasks.run("task");
      f.store.db.prepare("DELETE FROM reading_association_results").run();
      const task = await finishMerge(f.tasks);
      assert.equal(task.reason, "SAFETY_RECONCILIATION");
      assert.equal(calls, 1);
      assert.equal(f.ledger.wallet("synthetic").spent, 40);
    }
  }
});

import { ReadingTasks } from "./tasks.mjs";
async function untilAssociation(f) {
  for (let i = 0; i < 10 && !f.tasks.association.active("task"); i++)
    await f.tasks.run("task");
  assert.equal(f.tasks.association.active("task"), true);
}
test("paid association envelope and publication survive tenant failure/restart without another provider call or duplicate link", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f);
  let calls = 0;
  f.tasks.provider.association = async (sources) => {
    calls++;
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [link(JSON.parse(sources[0].text).items)] },
    };
  };
  f.enqueue();
  await untilAssociation(f);
  f.store.db.exec(
    "CREATE TRIGGER fail_association BEFORE INSERT ON reading_association_results BEGIN SELECT RAISE(ABORT,'INJECTED');END;",
  );
  assert.equal((await f.tasks.run("task")).state, "paused");
  f.store.db.exec("DROP TRIGGER fail_association");
  const restart = new ReadingTasks(f.args);
  try {
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
    assert.equal(calls, 1);
    assert.equal(f.ledger.wallet("synthetic").spent, 40);
    assert.equal(f.store.record("packet").data.association.links.length, 1);
  } finally {
    restart.close();
  }
});
test("association stop fences late provider output, settles its usage and only explicit continue runs another call", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f);
  let calls = 0,
    entered,
    release;
  const ready = new Promise((r) => (entered = r));
  f.tasks.provider.association = async (sources) => {
    calls++;
    if (calls === 1) {
      entered();
      await new Promise((r) => (release = r));
    }
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [link(JSON.parse(sources[0].text).items)] },
    };
  };
  f.enqueue();
  await untilAssociation(f);
  const running = f.tasks.run("task");
  await ready;
  f.action("stop");
  release();
  await running;
  assert.equal(f.tasks.get("task").state, "cancelled");
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  assert.equal(f.store.record("packet").data.result, null);
  f.action("continue");
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(calls, 2);
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
});

test("oversize historical item pauses before association billing and partial acceptance explicitly keeps fresh content without links", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f);
  const old = f.store.record("old0");
  f.store.apply(
    f.device,
    {
      id: "old0",
      opId: "large-saved-item",
      type: "put",
      baseVersion: old.version,
      data: { itemState: { "old-item": { facts: ["x".repeat(60000)] } } },
    },
    f.store.epoch,
  );
  let calls = 0;
  f.tasks.provider.association = async () => {
    calls++;
    throw Error("must not bill oversized context");
  };
  f.enqueue();
  const paused = await finishMerge(f.tasks);
  assert.equal(paused.reason, "ASSOCIATION_CONTEXT_LIMIT");
  assert.equal(calls, 0);
  assert.equal(f.ledger.wallet("synthetic").spent, 20);
  f.action("accept-partial");
  const p = f.store.record("packet").data;
  assert.equal(p.result.items.length, 1);
  assert.equal(p.association.links.length, 0);
  assert.ok(p.result.warnings.some((w) => w.includes("未应用历史事项关联")));
  assert.equal(
    f.store.record("old0").data.itemState["old-item"].facts[0].length,
    60000,
  );
});
test("legacy stable numeric references are still candidates while deleted legacy item metadata is excluded", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f, 2);
  for (const n of [0, 1]) {
    const row = f.store.record("old" + n),
      data = { ...row.data };
    delete data.itemIds;
    if (n === 1)
      data.itemState = { "old1:0": { deletedAt: "2026-10-31T00:00:00Z" } };
    f.store.db
      .prepare("UPDATE sync_records SET data=? WHERE id=?")
      .run(JSON.stringify(data), "old" + n);
  }
  f.tasks.provider.association = async (sources) => ({
    usage: { prompt_tokens: 10, completion_tokens: 10 },
    result: { links: [link(JSON.parse(sources[0].text).items)] },
  });
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  const p = f.store.record("packet").data;
  assert.equal(p.historyAssociation.candidates, 1);
  assert.equal(p.association.links[0].target, "old0#0");
});
test("association proof schema/version history and removed immutable trigger fail closed at startup", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  assert.equal(
    f.ledger.db
      .prepare(
        "SELECT version FROM reading_schema_versions WHERE component='history-association'",
      )
      .get().version,
    1,
  );
  f.ledger.db.exec("DROP TRIGGER reading_association_proofs_no_delete");
  assert.throws(() => new ReadingTasks(f.args), /READING_SCHEMA_MISMATCH/);
});

test("exact history decision reuse binds every saved item dependency and remaps fresh references without another fee", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f);
  let calls = 0;
  f.tasks.provider.association = async (sources) => {
    calls++;
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [link(JSON.parse(sources[0].text).items)] },
    };
  };
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  f.enqueue("later");
  assert.equal((await finishMerge(f.tasks, "later")).state, "done");
  assert.equal(calls, 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
  assert.equal(
    f.store.record("packet").data.association.links[0].from,
    "packet#later_item_0",
  );
  const old = f.store.record("old0");
  f.store.apply(
    f.device,
    {
      id: "old0",
      opId: "change-history-fact",
      type: "put",
      baseVersion: old.version,
      data: { itemState: { "old-item": { facts: ["新的人工历史事实"] } } },
    },
    f.store.epoch,
  );
  f.enqueue("changed");
  assert.equal((await finishMerge(f.tasks, "changed")).state, "done");
  assert.equal(calls, 2);
  assert.equal(f.ledger.wallet("synthetic").spent, 60);
  assert.deepEqual(f.store.record("old0").data.itemState["old-item"].facts, [
    "新的人工历史事实",
  ]);
});
test("near-tied matches from different history batches do not apply a partial or ambiguous relation", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法报告A7319" });
  history(f, 17);
  let calls = 0;
  f.tasks.provider.association = async (sources) => {
    calls++;
    const raw = link(JSON.parse(sources[0].text).items);
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [{ ...raw, confidence: calls === 1 ? 0.98 : 0.97 }] },
    };
  };
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(calls, 2);
  const p = f.store.record("packet").data;
  assert.equal(p.association.links.length, 0);
  assert.ok(p.result.warnings.some((w) => w.includes("多个相近历史事项")));
});
