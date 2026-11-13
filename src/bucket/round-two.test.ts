import { test, expect } from "vitest";
import { defaultCard } from "./default-card";
import { mergeCards, undoCardMerge } from "./card-merge";
import { layoutPacket, worldLayout } from "./world-layout";
import type { Packet } from "./types";
function packet(id: string): Packet {
  return {
    id,
    text: "合成要求",
    sources: [],
    attachments: [],
    capturedAt: "2026-11-13T10:00:00Z",
    captureDate: "2026-11-13",
    status: "ready",
    error: "",
    doneIds: [],
    updatedAt: "2026-11-13T10:00:00Z",
    itemIds: [id + "_item"],
    result: {
      summary: "合成",
      warnings: [],
      items: [
        {
          kind: "task",
          title: id,
          summary: "独立要求",
          facts: [id],
          nextSteps: [],
          uncertainties: [],
          sourceIds: [],
          evidence: [],
          due: {
            date: "2026-11-14",
            time: "18:00",
            anchor: "11月14日18:00",
            sourceId: "input",
          },
        },
      ],
    },
  };
}
test("failed delivery has one stable ordinary card; preserving it does not manufacture another fallback", () => {
  const raw = {
    ...packet("failed"),
    result: null,
    status: "error" as const,
    error: "未读完",
  };
  const fallback = defaultCard(raw);
  expect(fallback.itemIds).toEqual(["failed_default"]);
  expect(fallback.result?.items).toHaveLength(1);
  expect(defaultCard(fallback)).toBe(fallback);
  expect(defaultCard({ ...raw, deletedAt: "2026-11-13" }).result).toBeNull();
});
test("merge retains independent source deadlines, completion and originals, and undo restores sources without overwriting later source edits", () => {
  const a = packet("a"),
    b = packet("b");
  b.doneIds = [0];
  b.itemState = { b_item: { status: "done" } };
  b.attachments = [
    {
      id: "file",
      name: "要求.txt",
      size: 1,
      type: "text/plain",
      hash: "a".repeat(64),
    },
  ];
  const changes = mergeCards(
    [a, b],
    [
      { packetId: "a", itemId: "a_item" },
      { packetId: "b", itemId: "b_item" },
    ],
    "merged",
    "统一办理",
  );
  expect(changes[0].result?.items).toHaveLength(2);
  expect(changes[1].doneIds).toEqual([0]);
  expect(changes[1].attachments).toEqual(b.attachments);
  expect(changes[0].itemState?.merged.mergedCard?.sources).toHaveLength(2);
  expect(changes[0].result?.items[0].due).toEqual(a.result?.items[0].due);
  changes[1].result!.items[0] = {
    ...changes[1].result!.items[0],
    summary: "合并后补充子项",
  };
  const undone = undoCardMerge(changes, { packetId: "a", itemId: "merged" });
  expect(undone[0].itemState?.a_item.mergedInto).toBeNull();
  expect(undone[1].result?.items[0].summary).toBe("合并后补充子项");
  expect(undone[0].itemState?.merged.purgedAt).toBeTruthy();
});
test("edited main card requires explicit preservation before undo; stale or duplicate sources reject before any write", () => {
  const a = packet("a"),
    b = packet("b"),
    targets = [
      { packetId: "a", itemId: "a_item" },
      { packetId: "b", itemId: "b_item" },
    ];
  expect(() =>
    mergeCards([a, b], [targets[0], targets[0]], "merged", "标题"),
  ).toThrow();
  const changes = mergeCards([a, b], targets, "merged", "标题");
  changes[0].result!.items[1] = {
    ...changes[0].result!.items[1],
    summary: "新内容",
  };
  expect(() =>
    undoCardMerge(changes, { packetId: "a", itemId: "merged" }),
  ).toThrow("已有修改");
  const undone = undoCardMerge(
    changes,
    { packetId: "a", itemId: "merged" },
    true,
  );
  expect(undone[0].itemState?.merged.deletedAt).toBeUndefined();
  expect(undone[0].result?.items[1].summary).toBe("新内容");
  expect(undone[0].itemState?.merged.mergedCard).toBeNull();
  expect(a.itemState).toBeUndefined();
  expect(a.result?.items).toHaveLength(1);
});
test("empty groups and hidden type entries survive serialized storage and group removal retains cards", () => {
  const a = packet("a"),
    layout = {
      groups: [{ id: "empty", name: "校园电动车" }],
      hiddenKinds: ["notice"],
    };
  const setting = layoutPacket([a], layout);
  expect(worldLayout(JSON.parse(JSON.stringify([a, setting])))).toEqual(layout);
  expect(
    layoutPacket([a, setting], { ...layout, groups: [] }).result?.items,
  ).toHaveLength(0);
  expect(a.result?.items).toHaveLength(1);
});
