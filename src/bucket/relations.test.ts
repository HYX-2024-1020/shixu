import { describe, expect, it } from "vitest";
import {
  associatePacket,
  relationContext,
  buildGroups,
  filterLiveLinks,
  removeGroupLinks,
  removePacketLinks,
  type RelationPacket,
} from "../../shared/relations.mjs";
function packet(
  id: string,
  title: string,
  date = "2026-10-21",
): RelationPacket {
  return {
    id,
    status: "ready",
    capturedAt: date + "T10:00:00Z",
    captureDate: date,
    doneIds: [],
    sources: [{ id: "input", name: "输入", text: title }],
    updatedAt: date + "T10:00:00Z",
    result: {
      summary: title,
      warnings: [],
      items: [
        {
          kind: "task",
          title,
          summary: title,
          facts: [title + "的要求"],
          nextSteps: [],
          uncertainties: [],
          due: null,
          sourceIds: ["input"],
          evidence: [{ sourceId: "input", quote: title }],
        },
      ],
    },
  };
}
const first = () => packet("first", "做Python第一课作业");
const second = () => packet("second", "做Python第二课作业", "2026-10-22");
function model(relation = "related", title = "Python第一、二课作业") {
  return (async (_url, init) => {
    const payload = JSON.parse(String(init?.body)),
      body = JSON.parse(payload.messages[1].content),
      fresh = body.newItems[0],
      old = body.openItems[0];
    return Response.json({
      usage: { prompt_tokens: 100, completion_tokens: 30 },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              links: [
                {
                  from: fresh.ref,
                  target: old.ref,
                  relation,
                  title,
                  confidence: 0.99,
                  newEvidence: fresh.evidence[0],
                  oldEvidence: old.evidence[0],
                },
              ],
            }),
          },
        },
      ],
    });
  }) as typeof fetch;
}
const opts = { apiKey: "fixture-key-not-real", captureDate: "2026-10-22" };
describe("cross-capture associations preserve the original work", () => {
  it("relates lesson one and lesson two across days without losing deadlines, sources, or separate completion", async () => {
    const a = first(),
      b = second();
    a.result!.items[0].due = {
      date: "2026-10-23",
      time: "18:00",
      anchor: "原通知",
      sourceId: "input",
    };
    b.result!.items[0].due = {
      date: "2026-10-25",
      time: "23:59",
      anchor: "原通知",
      sourceId: "input",
    };
    b.association = await associatePacket(b, [a], {
      ...opts,
      fetcher: model(),
    });
    const groups = buildGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Python第一、二课作业");
    expect(groups[0].units).toHaveLength(2);
    expect(groups[0].units.map((u) => u.item.due?.date)).toEqual([
      "2026-10-23",
      "2026-10-25",
    ]);
    a.doneIds = [0];
    expect(buildGroups([a, b])[0].units.map((u) => u.done)).toEqual([
      true,
      false,
    ]);
    expect(a.sources[0].text).toBe("做Python第一课作业");
    expect(b.sources[0].text).toBe("做Python第二课作业");
  });
  it("deduplicates the same unfinished work and keeps earlier requirements and its date", async () => {
    const a = first(),
      b = packet("repeat", "做Python第一课作业", "2026-10-22");
    a.result!.items[0].due = {
      date: "2026-10-23",
      time: "",
      anchor: "原通知",
      sourceId: "input",
    };
    b.result!.items[0].facts = ["新增附件要求"];
    b.association = await associatePacket(b, [a], {
      ...opts,
      fetcher: model("same", "Python第一课作业"),
    });
    const group = buildGroups([a, b])[0];
    expect(group.units).toHaveLength(1);
    expect(group.units[0].item.facts).toContain("新增附件要求");
    expect(group.units[0].item.due?.date).toBe("2026-10-23");
    expect(group.units[0].refs).toEqual(["first#0", "repeat#0"]);
  });
  it("never offers completed, deleted, or differently typed items as candidates", async () => {
    const a = first();
    a.doneIds = [0];
    let calls = 0;
    const out = await associatePacket(second(), [a], {
      ...opts,
      fetcher: (async () => {
        calls++;
        throw Error("must not call");
      }) as typeof fetch,
    });
    expect(calls).toBe(0);
    expect(out.links).toEqual([]);
    a.doneIds = [];
    a.deletedAt = "2026-10-22";
    expect(relationContext(second(), [a]).batches).toEqual([]);
    a.deletedAt = undefined;
    a.result!.items[0].kind = "habit";
    expect(relationContext(second(), [a]).batches).toEqual([]);
  });
  it("rejects fabricated references and inconsistent duplicate dates while preserving independent results", async () => {
    const a = first(),
      b = second();
    const bad = (async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                links: [
                  {
                    from: "second#0",
                    target: "invented#0",
                    relation: "same",
                    title: "错误",
                    confidence: 0.99,
                  },
                ],
              }),
            },
          },
        ],
      })) as typeof fetch;
    expect(
      (await associatePacket(b, [a], { ...opts, fetcher: bad })).state,
    ).toBe("error");
    a.result!.items[0].due = {
      date: "2026-10-23",
      time: "",
      anchor: "旧日期",
      sourceId: "input",
    };
    b.result!.items[0].due = {
      date: "2026-10-25",
      time: "",
      anchor: "新日期",
      sourceId: "input",
    };
    const conflict = await associatePacket(b, [a], {
      ...opts,
      fetcher: model("same"),
    });
    expect(conflict.links).toEqual([]);
    expect(conflict.warnings.join()).toContain("不同截止时间");
    expect(b.result!.items[0].due.date).toBe("2026-10-25");
  });
  it("revalidates a target that is completed or deleted while the model is working", async () => {
    const a = first(),
      b = second();
    const result = await associatePacket(b, [a], { ...opts, fetcher: model() });
    a.doneIds = [0];
    expect(filterLiveLinks(result.links, [a, b])).toEqual([]);
    a.doneIds = [];
    a.deletedAt = "2026-10-22";
    expect(filterLiveLinks(result.links, [a, b])).toEqual([]);
  });
  it("can split a group without changing raw text, dates, or completion, and removes dangling associations on deletion", async () => {
    const a = first(),
      b = second();
    b.association = await associatePacket(b, [a], {
      ...opts,
      fetcher: model(),
    });
    const group = buildGroups([a, b])[0],
      changed = removeGroupLinks([a, b], group.refs);
    expect(buildGroups([a, ...changed])).toHaveLength(0);
    expect(changed[0].sources).toEqual(b.sources);
    expect(changed[0].result).toEqual(b.result);
    expect(removePacketLinks([a, b], a.id)[0].association?.links).toEqual([]);
  });
  it("extends an existing group without reopening its completed child and rejects a deleted context during an in-flight extension", async () => {
    const a = first(),
      b = second();
    b.association = await associatePacket(b, [a], {
      ...opts,
      fetcher: model(),
    });
    a.doneIds = [0];
    const c = packet("third", "做Python第三课作业", "2026-10-23");
    c.association = await associatePacket(c, [a, b], {
      ...opts,
      fetcher: model("related", "Python第一、二、三课作业"),
    });
    const group = buildGroups([a, b, c])[0];
    expect(group.title).toBe("Python第一、二、三课作业");
    expect(group.units.map((u) => u.done)).toEqual([true, false, false]);
    a.deletedAt = "2026-10-23";
    expect(filterLiveLinks(c.association.links, [a, b, c])).toHaveLength(0);
  });
  it("considers all open candidates in bounded batches and abstains on equally plausible different groups", async () => {
    const old = Array.from({ length: 41 }, (_, i) =>
        packet("old-" + i, "Python候选" + i),
      ),
      b = second();
    let calls = 0,
      seen = 0;
    const fetcher = (async (url, init) => {
      calls++;
      seen += JSON.parse(JSON.parse(String(init?.body)).messages[1].content)
        .openItems.length;
      return model()(url, init);
    }) as typeof fetch;
    const out = await associatePacket(b, old, { ...opts, fetcher });
    expect(calls).toBe(2);
    expect(seen).toBe(41);
    expect(out.links).toEqual([]);
    expect(out.warnings.join()).toContain("多个相近事项");
  });
});
