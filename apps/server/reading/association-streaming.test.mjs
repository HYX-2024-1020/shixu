import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "./material.mjs";
import { buildGroups } from "../generated/ai-core.mjs";
import { ASSOCIATION_VERSION } from "./association.mjs";
import { mergeFixture, finishMerge } from "./merge-fixtures.mjs";
import { seedAssociationHistory } from "./association-history-fixtures.mjs";

test("history larger than 16 MiB preflights all candidates and streams bounded model batches including the tail", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法实验报告A7319" });
  seedAssociationHistory(f, 401, { factBytes: 45000 });
  let calls = 0;
  f.tasks.provider.association = async () => {
    calls++;
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: { links: [] },
    };
  };
  f.enqueue();
  for (
    let n = 0;
    n < 4 &&
    f.tasks.get("task").state === "queued" &&
    !f.tasks.association.active("task");
    n++
  )
    await f.tasks.run("task");
  assert.equal(
    f.tasks.get("task").state,
    "queued",
    JSON.stringify(f.tasks.get("task")),
  );
  assert.equal(f.tasks.association.active("task"), true);
  const plan = f.tasks.association.plan(f.tasks.get("task"));
  let seen = 0,
    tail;
  for (const pair of f.tasks.association.pairs(plan)) {
    assert.ok(Buffer.byteLength(JSON.stringify(pair.items)) < 114000);
    for (const row of pair.items)
      if (row.role === "history") {
        seen++;
        tail = row.id;
      }
  }
  t.diagnostic(
    JSON.stringify({
      savedHistoricalBytes: f.store.db
        .prepare(
          "SELECT SUM(length(CAST(data AS BLOB))) bytes FROM sync_records WHERE id LIKE 'stream-old-%'",
        )
        .get().bytes,
      graphBytes: plan.graphBytes,
      heapUsed: process.memoryUsage().heapUsed,
      maxRSSKiB: process.resourceUsage().maxRSS,
      candidates: seen,
    }),
  );
  assert.equal(seen, 401);
  assert.equal(tail, "stream-old-00400#old-item");
  assert.equal(calls, 0);
  await f.tasks.run("task");
  assert.equal(calls, 1);
  const old = f.store.record("stream-old-00400");
  f.store.apply(
    f.device,
    {
      id: old.id,
      opId: "change-tail",
      type: "put",
      baseVersion: old.version,
      data: { itemState: { "old-item": { facts: ["尾部改变"] } } },
    },
    f.store.epoch,
  );
  await f.tasks.run("task");
  assert.equal(f.tasks.get("task").reason, "ASSOCIATION_INPUT_CHANGED");
  assert.equal(calls, 1);
  assert.equal(f.ledger.wallet("synthetic").spent, 40);
});

test("incremental dependency and pair hashes preserve the full-array version-1 paid decision contract including groups", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法实验报告A7319" });
  seedAssociationHistory(f, 3);
  const old = f.store.record("stream-old-00001");
  f.store.apply(
    f.device,
    {
      id: old.id,
      opId: "group-and-edit",
      type: "put",
      baseVersion: old.version,
      data: {
        itemState: {
          "old-item": { title: "人工补充标题", facts: ["人工事实"] },
        },
        association: {
          links: [
            {
              id: "existing-link",
              from: old.id + "#old-item",
              target: "stream-old-00000#old-item",
              relation: "same",
              title: "完整分组",
              contextRefs: [old.id + "#old-item", "stream-old-00000#old-item"],
            },
          ],
        },
      },
    },
    f.store.epoch,
  );
  f.tasks.provider.association = async () => ({
    usage: { prompt_tokens: 10, completion_tokens: 10 },
    result: { links: [] },
  });
  f.enqueue();
  for (let n = 0; n < 4 && !f.tasks.association.active("task"); n++)
    await f.tasks.run("task");
  const task = f.tasks.get("task"),
    plan = f.tasks.association.plan(task),
    history = [...plan.historyRows()],
    upstream = f.tasks.merge.plan(task),
    semantic = f.tasks.merge.result(task);
  assert.equal(plan.history, undefined);
  assert.equal(plan.items, undefined);
  assert.equal(
    plan.dependencyHash,
    sha256(
      JSON.stringify([
        ASSOCIATION_VERSION,
        f.tasks.account,
        task.packet,
        f.tasks.modelVersion,
        upstream.dependencyHash,
        semantic?.items || null,
        plan.fresh,
        history,
      ]),
    ),
  );
  const groups = buildGroups([...f.tasks.association.packets(task)]);
  for (const row of history) {
    const g = groups.find((g) => g.refs.includes(row.id)),
      unit = g?.units.find((u) => u.refs.includes(row.id));
    assert.deepEqual(
      row.group,
      g
        ? {
            id: g.id,
            title: g.title,
            refs: g.refs,
            members: g.units.map((u) => ({
              title: u.item.title,
              done: u.done,
            })),
          }
        : null,
    );
    assert.deepEqual(row.unitDue, unit?.item.due || row.item.due);
  }
  const pair = [...f.tasks.association.pairs(plan)];
  assert.equal(pair.length, 1);
  assert.equal(
    pair[0].fingerprint,
    sha256(
      JSON.stringify([
        ASSOCIATION_VERSION,
        plan.dependencyHash,
        0,
        0,
        [...plan.fresh, ...history],
      ]),
    ),
  );
});
test("a large relationship graph remains explicitly bounded and an oversized far-tail candidate preflights before any association fee", async (t) => {
  for (const graph of [false, true]) {
    const f = mergeFixture(t, { sourceText: "算法实验报告A7319" });
    seedAssociationHistory(
      f,
      graph ? 401 : 18,
      graph ? { titleBytes: 45000 } : {},
    );
    if (!graph) {
      const old = f.store.record("stream-old-00017");
      f.store.apply(
        f.device,
        {
          id: old.id,
          opId: "oversized-tail",
          type: "put",
          baseVersion: old.version,
          data: { itemState: { "old-item": { facts: ["x".repeat(60000)] } } },
        },
        f.store.epoch,
      );
    }
    let calls = 0;
    f.tasks.provider.association = async () => {
      calls++;
      throw Error("must preflight before billing");
    };
    f.enqueue();
    for (let n = 0; n < 4 && f.tasks.get("task").state === "queued"; n++)
      await f.tasks.run("task");
    assert.equal(f.tasks.get("task").reason, "ASSOCIATION_CONTEXT_LIMIT");
    assert.equal(calls, 0);
    assert.equal(f.ledger.wallet("synthetic").spent, 20);
  }
});

test("large saved packet overviews do not hide the far-tail candidate and publication retains all old data", async (t) => {
  const f = mergeFixture(t, { sourceText: "算法实验报告A7319" });
  seedAssociationHistory(f, 33, { summaryBytes: 540000 });
  const old = f.store.record("stream-old-00032");
  let calls = 0;
  f.tasks.provider.association = async (sources) => {
    calls++;
    const rows = JSON.parse(sources[0].text).items,
      a = rows.find((r) => r.role === "new"),
      b = rows.find((r) => r.id === "stream-old-00032#old-item");
    return {
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      result: {
        links: b
          ? [
              {
                from: a.id,
                target: b.id,
                relation: "same",
                title: "算法实验报告",
                confidence: 0.98,
                newEvidence: a.item.evidence[0],
                oldEvidence: b.item.evidence[0],
              },
            ]
          : [],
      },
    };
  };
  f.enqueue();
  assert.equal((await finishMerge(f.tasks)).state, "done");
  assert.equal(calls, 3);
  const p = f.store.record("packet").data;
  assert.equal(p.historyAssociation.candidates, 33);
  assert.equal(p.association.links[0].target, "stream-old-00032#old-item");
  assert.deepEqual(f.store.record(old.id), old);
  assert.equal(f.ledger.wallet("synthetic").spent, 80);
});
