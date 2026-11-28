import type { Packet } from "./types";
export class CardOperationError extends Error {}
export function mergeCardDeletion(
  packets: Packet[],
  target: CardTarget,
  deletedAt: string,
): Packet[] {
  const owner = packets.find((p) => p.id === target.packetId);
  const sources = owner?.itemState?.[target.itemId]?.mergedCard?.sources;
  if (!owner || !sources) return owner ? [owner] : [];
  const changes = new Map<string, Packet>([[owner.id, owner]]);
  for (const source of sources) {
    const p =
      changes.get(source.packetId) ||
      packets.find((p) => p.id === source.packetId);
    const meta = p?.itemState?.[source.itemId];
    if (
      !p ||
      !meta ||
      meta.mergedInto?.packetId !== owner.id ||
      meta.mergedInto.itemId !== target.itemId
    )
      continue;
    if (deletedAt ? !!meta.deletedAt : meta.deletedByMerge !== target.itemId)
      continue;
    changes.set(p.id, {
      ...p,
      itemState: {
        ...p.itemState,
        [source.itemId]: {
          ...meta,
          deletedAt,
          deletedByMerge: deletedAt ? target.itemId : null,
        },
      },
      updatedAt: new Date().toISOString(),
    });
  }
  return [...changes.values()];
}
export type CardTarget = { packetId: string; itemId: string };
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
  const { mergedCard, chat, history, deletedAt, deletedByMerge, ...state } =
    meta;
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
