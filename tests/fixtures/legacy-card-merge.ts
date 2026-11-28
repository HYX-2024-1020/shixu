import type { Packet, ItemState } from "../../apps/web/src/bucket/types";
import {
  CardOperationError,
  type CardTarget,
} from "../../apps/web/src/bucket/card-merge.ts";
// Historical format manufacturer for compatibility tests only; never bundled.
function node(packets: Packet[], target: CardTarget) {
  const packet = packets.find((p) => p.id === target.packetId);
  const index = packet?.itemIds
    ? packet.itemIds.indexOf(target.itemId)
    : (packet?.result?.items.findIndex(
        (_, i) => `${packet.id}:${i}` === target.itemId,
      ) ?? -1);
  const meta = packet?.itemState?.[target.itemId] || {};
  if (
    !packet?.result ||
    packet.deletedAt ||
    index < 0 ||
    meta.deletedAt ||
    meta.purgedAt ||
    meta.mergedInto ||
    meta.mergedCard ||
    meta.defaultDecision === "pending"
  )
    throw new CardOperationError("目标卡片已变化、删除或参与合并，请重新核对");
  return { packet, index, meta, item: packet.result.items[index] };
}
export function mergeCards(
  packets: Packet[],
  targets: CardTarget[],
  itemId: string,
  title: string,
) {
  if (
    targets.length < 2 ||
    targets.length > 20 ||
    !title.trim() ||
    title.length > 150 ||
    !/^[\w-]{1,100}$/.test(itemId) ||
    new Set(targets.map((t) => t.packetId + "#" + t.itemId)).size !==
      targets.length
  )
    throw new CardOperationError("请选择2至20张不同卡片并填写合并标题");
  const nodes = targets.map((t) => node(packets, t));
  if (packets.some((p) => p.itemIds?.includes(itemId)))
    throw new CardOperationError("合并编号已存在");
  const changes = new Map<string, Packet>();
  const copy = (p: Packet) => {
    if (!changes.has(p.id))
      changes.set(p.id, {
        ...p,
        result: { ...p.result!, items: [...p.result!.items] },
        itemIds: [
          ...(p.itemIds || p.result!.items.map((_, i) => `${p.id}:${i}`)),
        ],
        itemState: { ...p.itemState },
        updatedAt: new Date().toISOString(),
      });
    return changes.get(p.id)!;
  };
  const host = copy(nodes[0].packet);
  const item = {
    ...nodes[0].item,
    kind: "note" as const,
    title: title.trim(),
    summary: nodes
      .map((n) => n.item.title + "：" + n.item.summary)
      .join("\n")
      .slice(0, 2000),
    facts: [],
    nextSteps: [],
    uncertainties: [],
    due: null,
    sourceIds: [...new Set(nodes.flatMap((n) => n.item.sourceIds || []))],
    evidence: [],
  };
  const base: ItemState = {
    status: "active",
    groupIds: [...new Set(nodes.flatMap((n) => n.meta.groupIds || []))],
  };
  host.result!.items.push(item);
  host.itemIds!.push(itemId);
  host.itemState![itemId] = {
    ...base,
    mergedCard: {
      sources: targets.map((t, i) => ({ ...t, title: nodes[i].item.title })),
      initialItem: item,
      initialState: JSON.stringify(base),
    },
  };
  for (const [i, t] of targets.entries())
    copy(nodes[i].packet).itemState![t.itemId] = {
      ...nodes[i].meta,
      mergedInto: { packetId: host.id, itemId },
    };
  return [...changes.values()];
}
