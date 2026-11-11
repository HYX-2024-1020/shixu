import { absoluteItem } from "../../shared/deadlines.mjs";
import type { Packet, ItemState } from "./types";

const contentFields = [
  "title",
  "summary",
  "facts",
  "kind",
  "due",
  "dueCleared",
];
const editable = new Set([
  ...contentFields,
  "group",
  "importance",
  "status",
  "starred",
  "pinned",
]);
// Prepare the complete batch before saving anything. A stale or deleted target
// rejects the batch, including proposals inside the owner's own delivery.
export function applyChatProposals(
  packets: Packet[],
  ownerPacket: string,
  ownerItem: string,
): Packet[] {
  const owner = packets.find((p) => p.id === ownerPacket);
  const proposal = owner?.itemState?.[ownerItem]?.chatProposals;
  if (
    !owner ||
    owner.deletedAt ||
    !proposal?.items.length ||
    owner.itemState?.[ownerItem]?.deletedAt
  )
    throw Error("修改建议已失效，请重新发起对话");
  const changes = new Map<string, Packet>();
  for (const target of proposal.items) {
    const packet = packets.find((p) => p.id === target.packetId);
    const index = packet?.itemIds?.indexOf(target.itemId) ?? -1;
    const meta = packet?.itemState?.[target.itemId] || {};
    if (
      !packet?.result ||
      packet.deletedAt ||
      index < 0 ||
      meta.deletedAt ||
      meta.purgedAt
    )
      throw Error("有目标事项已删除，尚未保存任何建议，请重新核对");
    const item = { ...packet.result.items[index] };
    for (const key of contentFields)
      if (key in meta)
        Object.assign(item, { [key]: (meta as Record<string, unknown>)[key] });
    const state = {
      status: meta.status,
      starred: meta.starred,
      group: meta.group,
      pinned: meta.pinned,
      importance: meta.importance,
    };
    if (
      JSON.stringify(absoluteItem(item, packet.captureDate)) !==
        JSON.stringify(target.beforeItem) ||
      JSON.stringify(state) !== JSON.stringify(target.beforeState)
    )
      throw Error("目标事项已有新修改，尚未保存任何建议，请重新核对");
    if (Object.keys(target.patch).some((key) => !editable.has(key)))
      throw Error("修改建议包含不支持的操作");
    const next = changes.get(packet.id) || {
      ...packet,
      result: { ...packet.result, items: [...packet.result.items] },
      itemState: { ...packet.itemState },
      doneIds: [...packet.doneIds],
    };
    const nextMeta: Record<string, unknown> = { ...meta };
    const at = new Date().toISOString();
    for (const [key, value] of Object.entries(target.patch)) {
      if (contentFields.includes(key))
        next.result!.items[index] = {
          ...next.result!.items[index],
          [key]: value,
        };
      nextMeta[key] = value;
    }
    const done = new Set(next.doneIds);
    if (target.patch.status === "done") done.add(index);
    else if (target.patch.status) done.delete(index);
    next.doneIds = [...done];
    if (target.patch.status)
      nextMeta.completedAt = target.patch.status === "done" ? at : "";
    nextMeta.corrected = true;
    nextMeta.history = [
      ...(meta.history || []),
      ...Object.entries(target.patch).map(([field, value]) => ({
        at,
        field,
        before:
          JSON.stringify(
            (meta as Record<string, unknown>)[field] ??
              (item as unknown as Record<string, unknown>)[field],
          ) || "",
        after: JSON.stringify(value),
        source: "用户确认跨卡片AI建议",
      })),
    ];
    next.itemState![target.itemId] = nextMeta as ItemState;
    next.updatedAt = at;
    changes.set(packet.id, next);
  }
  const nextOwner = changes.get(ownerPacket) || {
    ...owner,
    itemState: { ...owner.itemState },
  };
  nextOwner.itemState = {
    ...nextOwner.itemState,
    [ownerItem]: { ...nextOwner.itemState?.[ownerItem], chatProposals: null },
  };
  changes.set(ownerPacket, nextOwner);
  return [...changes.values()];
}
