import { it, expect } from "vitest";
import { applyChatProposals } from "./chat-proposals";
import type { Packet, BucketItem } from "./types";
const item: BucketItem = {
  title: "合成事项",
  summary: "要求保留",
  kind: "task",
  facts: [],
  nextSteps: [],
  uncertainties: [],
  evidence: [],
  sourceIds: [],
  due: null,
};
function packets(): Packet[] {
  const base = {
    text: "合成",
    sources: [],
    attachments: [],
    capturedAt: "2026-11-11T00:00:00Z",
    captureDate: "2026-11-11",
    updatedAt: "2026-11-11T00:00:00Z",
    status: "ready" as const,
    error: "",
    doneIds: [],
  };
  return [
    {
      ...base,
      id: "owner",
      itemIds: ["owner-item"],
      result: { summary: "合成", warnings: [], items: [item] },
      itemState: {
        "owner-item": {
          chatProposals: {
            id: "proposal",
            items: [
              {
                packetId: "target",
                itemId: "target-item",
                title: item.title,
                baseVersion: 2,
                patch: { starred: true, status: "done" },
                beforeItem: item,
                beforeState: {},
              },
            ],
          },
        },
      },
    },
    {
      ...base,
      id: "target",
      itemIds: ["target-item"],
      result: { summary: "合成", warnings: [], items: [item] },
      itemState: {},
    },
  ];
}
it("prepares an explicit batch, preserves the source and clears the applied proposal once", () => {
  const source = packets();
  const changes = applyChatProposals(source, "owner", "owner-item");
  expect(
    changes.find((p) => p.id === "target")?.itemState?.["target-item"],
  ).toMatchObject({ starred: true, status: "done" });
  expect(changes.find((p) => p.id === "target")?.doneIds).toEqual([0]);
  expect(source[1].doneIds).toEqual([]);
  expect(
    changes.find((p) => p.id === "owner")?.itemState?.["owner-item"]
      .chatProposals,
  ).toBeNull();
});
it("rejects stale and deleted target batches before changing any source", () => {
  const source = packets();
  source[1] = {
    ...source[1],
    result: {
      ...source[1].result!,
      items: [{ ...item, title: "新的人工修改" }],
    },
  };
  expect(() => applyChatProposals(source, "owner", "owner-item")).toThrow(
    "已有新修改",
  );
  const deleted = packets();
  deleted[1].deletedAt = "2026-11-12T00:00:00Z";
  expect(() => applyChatProposals(deleted, "owner", "owner-item")).toThrow(
    "已删除",
  );
});
