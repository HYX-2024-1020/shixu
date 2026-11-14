import type { Packet } from "./types";
export const LAYOUT_ID = "shixu_world_layout";
export function worldLayout(
  packets: Packet[],
): NonNullable<Packet["worldLayout"]> {
  return (
    packets.find((p) => p.id === LAYOUT_ID && !p.deletedAt)?.worldLayout || {
      groups: [],
      hiddenKinds: [],
    }
  );
}
export function layoutPacket(
  packets: Packet[],
  layout: NonNullable<Packet["worldLayout"]>,
): Packet {
  if (
    layout.groups.length > 100 ||
    new Set(layout.groups.map((g) => g.id)).size !== layout.groups.length ||
    layout.groups.some((g) => !g.name.trim() || g.name.length > 80)
  )
    throw Error("小组名称需为1至80字，最多100个小组");
  const at = new Date().toISOString();
  return {
    id: LAYOUT_ID,
    text: "世界小组与显示设置",
    sources: [],
    attachments: [],
    capturedAt: at,
    captureDate: at.slice(0, 10),
    status: "ready",
    result: { summary: "世界显示设置", items: [], warnings: [] },
    doneIds: [],
    error: "",
    ...packets.find((p) => p.id === LAYOUT_ID),
    worldLayout: layout,
    updatedAt: at,
  };
}
