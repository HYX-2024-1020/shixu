import type { Packet, ItemState } from "./types";
export class CardOperationError extends Error {}
export type CardTarget = { packetId: string; itemId: string };
function node(packets: Packet[], target: CardTarget) {
  const packet = packets.find((p) => p.id === target.packetId);
  const index = packet?.itemIds?.indexOf(target.itemId) ?? -1;
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
        itemIds: [...(p.itemIds || [])],
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
export function undoCardMerge(
  packets: Packet[],
  target: CardTarget,
  preserveEdited = false,
) {
  const owner = packets.find((p) => p.id === target.packetId),
    index = owner?.itemIds?.indexOf(target.itemId) ?? -1;
  const meta = owner?.itemState?.[target.itemId],
    merge = meta?.mergedCard;
  if (
    !owner?.result ||
    owner.deletedAt ||
    index < 0 ||
    !merge ||
    meta?.deletedAt
  )
    throw new CardOperationError("合并已撤销或卡片不可用");
  const { mergedCard, chat, history, ...state } = meta;
  const edited =
    JSON.stringify(owner.result.items[index]) !==
      JSON.stringify(merge.initialItem) ||
    JSON.stringify(state) !== merge.initialState ||
    !!chat?.length ||
    !!history?.length;
  if (edited && !preserveEdited)
    throw new CardOperationError(
      "合并后已有修改。请确认将主卡保留为独立卡，或取消撤销",
    );
  const changes = new Map<string, Packet>();
  const copy = (p: Packet) => {
    if (!changes.has(p.id))
      changes.set(p.id, {
        ...p,
        itemState: { ...p.itemState },
        updatedAt: new Date().toISOString(),
      });
    return changes.get(p.id)!;
  };
  for (const source of merge.sources) {
    const p = packets.find((p) => p.id === source.packetId),
      s = p?.itemState?.[source.itemId];
    if (
      !p ||
      p.deletedAt ||
      s?.deletedAt ||
      s?.purgedAt ||
      s?.mergedInto?.packetId !== owner.id ||
      s.mergedInto.itemId !== target.itemId
    )
      throw new CardOperationError("源卡状态已变化，尚未撤销任何卡片");
    copy(p).itemState![source.itemId] = { ...s, mergedInto: null };
  }
  copy(owner).itemState![target.itemId] = {
    ...meta,
    mergedCard: null,
    ...(edited
      ? {}
      : {
          deletedAt: new Date().toISOString(),
          purgedAt: new Date().toISOString(),
        }),
  };
  return [...changes.values()];
}
