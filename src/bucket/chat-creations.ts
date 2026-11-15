import { absoluteItem } from "../../shared/deadlines.mjs";
import { applyChatProposals } from "./chat-proposals";
import type { Packet, ItemState } from "./types";

export function applyChatChanges(
  packets: Packet[],
  ownerPacket: string,
  ownerItem: string,
  expectedId?: string,
): Packet[] {
  const owner = packets.find((p) => p.id === ownerPacket);
  const meta = owner?.itemState?.[ownerItem];
  const creation = meta?.chatCreations;
  const proposal = creation || meta?.chatProposals;
  if (expectedId && proposal?.id !== expectedId)
    throw Error("建议已变化，请重新核对；尚未保存");
  if (!creation) return applyChatProposals(packets, ownerPacket, ownerItem);
  const source = packets.find((p) => p.id === creation.packetId);
  const index = source?.itemIds?.indexOf(creation.itemId) ?? -1;
  const state = source?.itemState?.[creation.itemId] || {};
  if (
    !owner ||
    owner.deletedAt ||
    meta?.deletedAt ||
    meta?.purgedAt ||
    !source?.result ||
    source.deletedAt ||
    index < 0 ||
    state.deletedAt ||
    state.purgedAt ||
    state.mergedCard ||
    state.mergedInto
  )
    throw Error("来源或对话卡已删除或状态变化，尚未保存任何新卡");
  const item = { ...source.result.items[index] };
  for (const field of [
    "title",
    "summary",
    "facts",
    "kind",
    "due",
    "dueCleared",
  ])
    if (field in state)
      Object.assign(item, {
        [field]: (state as Record<string, unknown>)[field],
      });
  const currentItem = absoluteItem(item, source.captureDate);
  const currentState = {
    ...state,
    status:
      state.status || (source.doneIds?.includes(index) ? "done" : "active"),
    group: state.group ?? item.group,
  } as Record<string, unknown>;
  if (
    JSON.stringify(currentItem) !== JSON.stringify(creation.beforeItem) ||
    ["group", "status", "importance", "starred", "pinned", "groupIds"].some(
      (key) =>
        JSON.stringify(currentState[key]) !==
        JSON.stringify(creation.beforeState[key]),
    )
  )
    throw Error("来源卡已有新修改，尚未新增或删除任何卡片，请重新核对");
  if (
    !["create", "split"].includes(creation.mode) ||
    creation.patches.length < (creation.mode === "split" ? 2 : 1) ||
    creation.patches.length > 10
  )
    throw Error("新增卡片建议无效");
  const at = new Date().toISOString();
  const next = structuredClone(source);
  const done = new Set(next.doneIds || []);
  const allowed = new Set([
    "title",
    "summary",
    "facts",
    "kind",
    "due",
    "dueCleared",
    "group",
    "importance",
    "status",
    "starred",
    "pinned",
  ]);
  for (const [i, patch] of creation.patches.entries()) {
    if (
      Object.keys(patch).some((key) => !allowed.has(key)) ||
      typeof patch.title !== "string" ||
      !patch.title.trim() ||
      typeof patch.summary !== "string" ||
      !Array.isArray(patch.facts)
    )
      throw Error("新增建议包含无效内容");
    const id = `${creation.id}_new_${i}`;
    if (packets.some((p) => p.itemIds?.includes(id)))
      throw Error("这些卡片已保存，请刷新核对，未重复创建");
    const child = { ...currentItem };
    // Do not copy prior chat, pending suggestions, deletion or merge markers.
    const childState: ItemState = {
      status:
        state.status || (source.doneIds?.includes(index) ? "done" : "active"),
      starred: state.starred,
      pinned: state.pinned,
      importance: state.importance,
      group: state.group,
      groupIds: state.groupIds,
      origin: `从「${currentItem.title}」${creation.mode === "split" ? "拆分" : "新建"}`,
      history: [
        {
          at,
          field: "created",
          before: "",
          after: String(patch.title),
          source: "用户确认AI新增卡片",
        },
      ],
    };
    for (const [field, value] of Object.entries(patch)) {
      if (
        ["title", "summary", "facts", "kind", "due", "dueCleared"].includes(
          field,
        )
      )
        Object.assign(child, { [field]: value });
      else Object.assign(childState, { [field]: value });
    }
    next.result!.items.push(child);
    next.itemIds!.push(id);
    next.itemState = { ...next.itemState, [id]: childState };
    if (childState.status === "done") done.add(next.result!.items.length - 1);
  }
  next.doneIds = [...done];
  next.updatedAt = at;
  if (creation.mode === "split")
    next.itemState = {
      ...next.itemState,
      [creation.itemId]: {
        ...state,
        deletedAt: at,
        origin: "拆分前原卡，保留以便恢复",
      },
    };
  const changes = new Map<string, Packet>([[next.id, next]]);
  const nextOwner = changes.get(owner.id) || structuredClone(owner);
  nextOwner.itemState = {
    ...nextOwner.itemState,
    [ownerItem]: {
      ...nextOwner.itemState?.[ownerItem],
      chatCreations: null,
      chatProposals: null,
    },
  };
  changes.set(nextOwner.id, nextOwner);
  return [...changes.values()];
}
