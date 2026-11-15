import type { Packet } from "./types";

// A stable ID lets old failed deliveries participate in the ordinary world
// without inventing another delivery or triggering another model request.
export function defaultCard(packet: Packet): Packet {
  if (packet.deletedAt || packet.result || packet.status !== "error")
    return packet;
  const id = packet.id + "_default";
  return {
    ...packet,
    itemIds: [id],
    itemState: {
      ...packet.itemState,
      [id]: { ...packet.itemState?.[id], defaultDecision: "pending" },
    },
    result: {
      summary: "原样材料，尚未完成AI整理",
      warnings: [packet.error || "尚未得到通过核对的结果"],
      items: [
        {
          kind: "note",
          title:
            packet.text.trim().slice(0, 48) ||
            packet.attachments[0]?.name ||
            "原样材料",
          summary: packet.text.slice(0, 2000),
          facts: [],
          nextSteps: [],
          uncertainties: [],
          due: null,
          sourceIds: packet.sources.map((s) => s.id),
          evidence: [],
        },
      ],
    },
  };
}
