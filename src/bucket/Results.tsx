import { allPackets } from "./store";
import { mergeCards, undoCardMerge, mergeCardDeletion } from "./card-merge";
import { worldLayout, layoutPacket } from "./world-layout";
import { defaultCard } from "./default-card";
import { errorMessage } from "./error-message";
import CardFiles from "./CardFiles";
import { sourceLocation } from "../../shared/reading-view.mjs";
import { ADMIN_TEST } from "./edition";
import {
  absoluteItem,
  setDeadline,
  deadlineLabel,
  parseDeadline,
} from "../../shared/deadlines.mjs";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Star,
  GripVertical,
  Check,
  MoreHorizontal,
  Pin,
  ArrowUpRight,
  Paperclip,
  Trash2,
} from "lucide-react";
import ItemDialog from "./ItemDialog";
import DeliverySources from "./DeliverySources";
import ItemChat from "./ItemChat";
import { cardCopy } from "./card-copy";
import LinkText from "./LinkText";
import { leaveCard, resetCard } from "./motion";
import { useCardMotion } from "./useCardMotion";
import { useCardDrag } from "./useCardDrag";
import { mergeCardOrder } from "./card-order";
import type { Packet, ItemState, BucketKind } from "./types";
import SkinArt from "./SkinArt";
import type { Skin } from "./skins";
import { localDate } from "../organize";
import { compareItems, habitCheckin } from "./management";
import {
  buildGroups,
  itemRef,
  removeGroupLinks,
} from "../../shared/relations.mjs";
import { categories } from "./client-ui";
export { categories } from "./client-ui";
function Results({
  skin,
  compact = false,
  reorder,
  packets,
  save,
  saveMany,
  focusPacket,
  onFocusConsumed,
  notify,
  purge,
  onChat,
  onRecords,
  onTasks,
  onRetry,
  onApplyProposals,
}: {
  skin: Skin;
  compact?: boolean;
  reorder: (ids: string[]) => Promise<void>;
  onRecords: () => void;
  onTasks?: () => void;
  onRetry?: (packet: Packet) => Promise<void>;
  onApplyProposals?: (packetId: string, itemId: string) => Promise<void>;
  packets: Packet[];
  save: (p: Packet) => Promise<void>;
  saveMany?: (p: Packet[]) => Promise<void>;
  focusPacket: string;
  onFocusConsumed: () => void;
  notify: (s: string) => void;
  purge: (id: string) => Promise<void>;
  onChat: (
    packetId: string,
    itemId: string,
    text: string,
    options?: {
      scope: "item" | "account" | "packet" | "group" | "selected";
      readAttachments: boolean;
      groupId?: string;
      targets?: { packetId: string; itemId: string }[];
    },
  ) => Promise<ItemState>;
}) {
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [mergePreview, setMergePreview] = useState(false);
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const mergeLock = useRef(false);
  async function cardOperation(
    kind: "merge" | "undo",
    targets: { packetId: string; itemId: string }[],
    title = "",
    preserveEdited = false,
  ) {
    if (mergeLock.current) return;
    mergeLock.current = true;
    setMergeBusy(true);
    try {
      const current = latestPackets.current;
      const cloudState = window.desktop
        ? await window.desktop.cloud("status")
        : null;
      if (cloudState?.base) {
        await window.desktop!.cloud("cardOperation", {
          kind,
          targets: targets.map((t) => ({
            ...t,
            baseVersion: current.find((p) => p.id === t.packetId)?.syncVersion,
          })),
          title,
          itemId: crypto.randomUUID(),
          preserveEdited,
        });
        // The root's normal refresh pulls the canonical, atomic server result.
        window.dispatchEvent(new Event("focus"));
      } else {
        if (!saveMany) throw Error("当前入口暂不支持批量保存");
        await saveMany(
          kind === "merge"
            ? mergeCards(current, targets, crypto.randomUUID(), title)
            : undoCardMerge(current, targets[0], preserveEdited),
        );
      }
      setMergeSelection([]);
      setMergePreview(false);
      notify(
        kind === "merge"
          ? "已合并为一张主卡，各子项和原件来源保留"
          : "已撤销合并，源卡已恢复",
      );
    } finally {
      mergeLock.current = false;
      setMergeBusy(false);
    }
  }
  const layout = worldLayout(packets);
  const [activeGroup, setActiveGroup] = useState("");
  const [legacyGroup, setLegacyGroup] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [groupManager, setGroupManager] = useState(false);
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState("active"),
    [kind, setKind] = useState("all");
  const [sort, setSort] = useState(() => {
      const saved = localStorage.getItem("shixu.card-sort") || "due";
      return ["due", "created", "category", "custom"].includes(saved)
        ? saved
        : "due";
    }),
    [dateFilter, setDateFilter] = useState("all"),
    [starOnly, setStarOnly] = useState(false);
  const [day, setDay] = useState(localDate()),
    [onlyPacket, setOnlyPacket] = useState("");
  const [completing, setCompleting] = useState(new Set<string>());
  const latestPackets = useRef(packets);
  latestPackets.current = packets;
  const mutationLocks = useRef(new Set<string>());
  const mutationTail = useRef(Promise.resolve());
  const motionRoot = useCardMotion();
  const completionLock = useRef(new Set<string>());
  const [showHistory, setShowHistory] = useState(false);
  const [limit, setLimit] = useState(60);
  const [grouped, setGrouped] = useState(false);
  useEffect(() => {
    if (layout.groups.length) setGrouped(false);
  }, [layout.groups.length]);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const [materials, setMaterials] = useState("");
  const materialOrigin = useRef("");
  const [adopting, setAdopting] = useState("");
  const adoptionLock = useRef(new Set<string>());
  const [adoptionError, setAdoptionError] = useState("");
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  useEffect(() => {
    if (!compact) localStorage.setItem("shixu.card-sort", sort);
  }, [sort, compact]);
  useEffect(() => setLimit(60), [query, scope, kind, onlyPacket, dateFilter]);
  useEffect(() => {
    if (!focusPacket) return;
    setOnlyPacket(focusPacket);
    setActiveGroup("");
    setLegacyGroup("");
    setScope("active");
    setKind("all");
    setQuery("");
    setDateFilter("all");
    setStarOnly(false);
    onFocusConsumed();
  }, [focusPacket, onFocusConsumed]);
  useEffect(() => {
    const tick = () => setDay(localDate());
    const timer = setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => {
    setShowHistory(false);
  }, [selected]);
  useEffect(() => {
    if (editing) document.querySelector("dialog[open]")?.scrollTo({ top: 0 });
  }, [editing]);
  async function update(
    p: Packet,
    id: string,
    request: Partial<ItemState> | ((state: ItemState) => Partial<ItemState>),
  ) {
    let changes =
      typeof request === "function"
        ? request(p.itemState?.[id] || {})
        : request;
    const leaving = !!changes.deletedAt || changes.status === "done";
    if (leaving && mutationLocks.current.has(id)) return;
    if (leaving) mutationLocks.current.add(id);
    try {
      if (leaving) await leaveCard(id, !!changes.deletedAt);
      const commit = mutationTail.current
        .catch(() => {})
        .then(async () => {
          p = latestPackets.current.find((packet) => packet.id === p.id) || p;
          if (typeof request === "function")
            changes = request(p.itemState?.[id] || {});
          const index = p.itemIds?.indexOf(id) ?? Number(id.split(":").pop());
          const doneIds = new Set(p.doneIds);
          if (changes.status === "done") doneIds.add(index);
          else if (changes.status) doneIds.delete(index);
          const next = {
            ...p,
            doneIds: [...doneIds],
            itemState: {
              ...p.itemState,
              [id]: { ...p.itemState?.[id], ...changes },
            },
            updatedAt: new Date().toISOString(),
          };
          if (
            "deletedAt" in changes &&
            next.itemState?.[id]?.mergedCard &&
            saveMany
          ) {
            const batch = mergeCardDeletion(
              latestPackets.current.map((row) =>
                row.id === next.id ? next : row,
              ),
              { packetId: next.id, itemId: id },
              changes.deletedAt || "",
            );
            await saveMany(batch);
            Object.assign(
              next,
              batch.find((row) => row.id === next.id),
            );
            const revised = new Map(batch.map((p) => [p.id, p]));
            latestPackets.current = latestPackets.current.map(
              (p) => revised.get(p.id) || p,
            );
          } else await save(next);
          latestPackets.current = latestPackets.current.map((packet) =>
            packet.id === next.id ? next : packet,
          );
        });
      mutationTail.current = commit;
      await commit;
      // A filter switch can keep this same DOM card mounted in its new scope.
      if (leaving) requestAnimationFrame(() => resetCard(id));
      if (
        "deletedAt" in changes ||
        changes.status === "done" ||
        (changes.status === "active" && !changes.checkins)
      )
        setSelected("");
      return true;
    } catch (e) {
      resetCard(id);
      notify((e as Error).message);
      return false;
    } finally {
      mutationLocks.current.delete(id);
    }
  }
  async function toggleCompletion(p: Packet, id: string) {
    if (completionLock.current.has(id)) return;
    completionLock.current.add(id);
    try {
      const current =
        latestPackets.current.find((packet) => packet.id === p.id) || p;
      const index = current.itemIds?.indexOf(id) ?? Number(id.split(":").pop());
      const meta = current.itemState?.[id] || {};
      const habit = current.result?.items[index]?.kind === "habit";
      const checked = habit
        ? !!meta.checkins?.includes(localDate())
        : meta.status === "done" || current.doneIds.includes(index);
      if (!checked) {
        setCompleting((values) => new Set(values).add(id));
        await new Promise((resolve) => setTimeout(resolve, 230));
      }
      await update(
        current,
        id,
        habit
          ? habitCheckin(meta, localDate())
          : {
              status: checked ? "active" : "done",
              completedAt: checked ? "" : new Date().toISOString(),
            },
      );
    } finally {
      completionLock.current.delete(id);
      setCompleting((values) => {
        const next = new Set(values);
        next.delete(id);
        return next;
      });
    }
  }
  const automaticGroups = useMemo(() => buildGroups(packets), [packets]);
  const sourceSearch = useMemo(
    () =>
      new Map(
        packets.map((p) => [
          p.id,
          [
            p.text,
            ...p.sources.map((s) => s.name + " " + s.text),
            ...p.attachments.map((a) => a.name),
          ]
            .join("\n")
            .toLowerCase(),
        ]),
      ),
    [packets],
  );
  const searchTerm = query.toLowerCase();
  const rows = packets.map(defaultCard).flatMap((p) =>
    (p.result?.items || []).map((rawItem, index) => {
      const id = p.itemIds?.[index] || `${p.id}:${index}`,
        storedMeta = p.itemState?.[id] || {};
      const item = absoluteItem(
        rawItem,
        p.captureDate,
        p.sources,
        storedMeta.chat,
      );
      const meta = {
        ...storedMeta,
        group:
          storedMeta.group ??
          (item.group ||
            automaticGroups.find((g) =>
              g.refs.includes(itemRef(p.id, p.itemIds?.[index] || index)),
            )?.title),
      };
      return {
        p,
        item,
        index,
        id,
        meta,
        deleted: p.deletedAt || meta.deletedAt,
        done:
          item.kind !== "habit" &&
          (meta.status === "done" || p.doneIds.includes(index)),
      };
    }),
  );
  const scoped = rows.filter(
    (r) =>
      !r.meta.purgedAt &&
      !r.meta.mergedInto &&
      (scope === "trash"
        ? !!r.deleted
        : !r.deleted && (scope === "done" ? r.done : !r.done)),
  );
  const kinds = [...new Set(scoped.map((r) => r.item.kind))];
  const rankRows = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    const rank = (r: typeof a) => ({
      id: r.id,
      date: r.item.due?.date,
      time: r.item.due?.time,
      kind: r.item.kind,
      importance: r.meta.importance ?? r.item.importance ?? 1,
      pinned: !!r.meta.pinned,
      createdAt: r.p.capturedAt,
      order:
        (activeGroup ? r.meta.groupOrder?.[activeGroup] : undefined) ??
        r.meta.order ??
        r.index,
    });
    return compareItems(rank(a), rank(b), sort, day);
  };
  scoped.sort(rankRows);
  const filtered = scoped.filter(
    (r) =>
      (kind === "all" || r.item.kind === kind) &&
      (!activeGroup || r.meta.groupIds?.includes(activeGroup)) &&
      (!legacyGroup || r.meta.group === legacyGroup) &&
      (!onlyPacket || r.p.id === onlyPacket) &&
      (!starOnly || r.meta.starred) &&
      (`${r.item.title} ${r.item.summary} ${r.item.facts.join(" ")} ${r.meta.additions?.map((a) => a.text).join(" ") || ""}`
        .toLowerCase()
        .includes(searchTerm) ||
        sourceSearch.get(r.p.id)?.includes(searchTerm)) &&
      (dateFilter === "all" ||
        (r.item.due &&
          (dateFilter === "today"
            ? r.item.due.date === day
            : dateFilter === "overdue"
              ? r.item.due.date < day
              : r.item.due.date >= day &&
                Date.parse(r.item.due.date) - Date.parse(day) < 7 * 86400000))),
  );
  if (dragOrder) {
    const positions = new Map(dragOrder.map((id, index) => [id, index]));
    filtered.sort(
      (a, b) => (positions.get(a.id) ?? 1e9) - (positions.get(b.id) ?? 1e9),
    );
  }
  const legacyGroups = [
    ...new Set(
      scoped
        .filter((r) => r.meta.groupIds === undefined)
        .map((r) => r.meta.group?.trim())
        .filter((name): name is string => !!name),
    ),
  ].filter((name) => !layout.groups.some((g) => g.name === name));
  const matchCount = filtered.length;
  filtered.splice(limit);
  const groups = [...new Set(filtered.map((r) => r.meta.group?.trim() || ""))];
  const draggable = filtered.filter(
    (r) => r.meta.defaultDecision !== "pending",
  );
  const drag = useCardDrag(motionRoot, {
    ids: draggable.map((r) => r.id),
    enabled:
      !compact &&
      !selected &&
      !materials &&
      scope !== "trash" &&
      !completing.size,
    groups: grouped
      ? new Map(filtered.map((r) => [r.id, r.meta.group?.trim() || ""]))
      : undefined,
    onPreview: setDragOrder,
    onCommit: async (ids) => {
      if (activeGroup) {
        const complete = mergeCardOrder(
          scoped
            .filter((r) => r.meta.groupIds?.includes(activeGroup))
            .map((r) => r.id),
          draggable.map((r) => r.id),
          ids,
        );
        for (const [order, id] of complete.entries()) {
          const row = rows.find((r) => r.id === id);
          if (
            row &&
            !(await update(row.p, id, {
              groupOrder: { ...row.meta.groupOrder, [activeGroup]: order },
            }))
          )
            throw Error("小组顺序未全部保存，请刷新后重试");
        }
        setSort("custom");
        return;
      }
      const full = mergeCardOrder(
        scoped.map((r) => r.id),
        draggable.map((r) => r.id),
        ids,
      );
      const commit = mutationTail.current
        .catch(() => {})
        .then(() => reorder(full));
      mutationTail.current = commit;
      await commit;
      setSort("custom");
    },
    onError: notify,
  });
  return (
    <section
      className={"results-workspace" + (compact ? " current-results" : "")}
      ref={motionRoot}
    >
      <span className="drag-announcement" role="status" aria-live="polite">
        {drag.announcement}
      </span>
      {!compact && (
        <>
          <div className="world-heading">
            <div>
              <h1>
                消化完了，
                <br />
                这是你的<span>世界。</span>
              </h1>
            </div>
            <span className="world-skin-art">
              <SkinArt skin={skin} />
            </span>
          </div>
          <div className="result-controls">
            <button onClick={onRecords}>整理记录</button>
            {onTasks && <button onClick={onTasks}>整理任务</button>}
            {!!mergeSelection.length && (
              <button
                onClick={() => {
                  setMergeTitle("合并事项");
                  setMergePreview(true);
                }}
              >
                合并已选卡片（{mergeSelection.length}）
              </button>
            )}
            <button
              aria-expanded={groupManager}
              onClick={() => setGroupManager(!groupManager)}
            >
              管理小组与类型入口
            </button>
            <input
              aria-label="搜索整理结果"
              placeholder="搜索标题、原文或文件名"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="结果范围"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setKind("all");
              }}
            >
              <option value="active">待处理</option>
              <option value="done">完成 / 归档</option>
              <option value="trash">最近删除（30 天）</option>
            </select>
            <details className="result-filter-menu">
              <summary>筛选与排序</summary>
              <div>
                <select
                  aria-label="排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="due">截止时间 · 最早优先</option>
                  <option value="category">同类别集中 · 截止时间</option>
                  <option value="created">创建时间 · 最新优先</option>
                  <option value="custom">自定义顺序</option>
                </select>
                <select
                  aria-label="日期筛选"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                >
                  <option value="all">全部日期</option>
                  <option value="today">今日</option>
                  <option value="soon">未来 7 天</option>
                  <option value="overdue">逾期</option>
                </select>
              </div>
            </details>
            <button
              className="star-filter"
              aria-pressed={starOnly}
              onClick={() => setStarOnly(!starOnly)}
            >
              <Star size={17} fill={starOnly ? "currentColor" : "none"} />{" "}
              只展示星标
            </button>
          </div>
          {onlyPacket && (
            <button onClick={() => setOnlyPacket("")}>
              正在查看本次投递 · 显示全部
            </button>
          )}
          <nav className="settings-tabs" aria-label="我的小组">
            <button
              aria-pressed={!activeGroup && !legacyGroup}
              onClick={() => {
                setActiveGroup("");
                setLegacyGroup("");
              }}
            >
              全部小组
            </button>
            {layout.groups.map((g) => (
              <button
                key={g.id}
                aria-pressed={activeGroup === g.id}
                onClick={() => {
                  setActiveGroup(g.id);
                  setLegacyGroup("");
                  setSort("custom");
                }}
              >
                {g.name}
              </button>
            ))}
          </nav>
          {!!legacyGroups.length && (
            <nav className="settings-tabs" aria-label="已有标签小组">
              {legacyGroups.map((name) => (
                <button
                  key={name}
                  aria-pressed={legacyGroup === name}
                  onClick={() => {
                    setActiveGroup("");
                    setLegacyGroup(name);
                  }}
                >
                  {name}
                </button>
              ))}
            </nav>
          )}
          {!!legacyGroup && (
            <button
              onClick={async () => {
                try {
                  if (!saveMany) throw Error("当前入口暂不支持保存小组");
                  const current = latestPackets.current,
                    id = crypto.randomUUID(),
                    live = worldLayout(current);
                  const changes = current.flatMap((p) => {
                    const itemState = { ...p.itemState };
                    let changed = false;
                    (p.result?.items || []).forEach((item, i) => {
                      const itemId = p.itemIds?.[i] || `${p.id}:${i}`,
                        meta = itemState[itemId] || {};
                      const displayed = rows.find((r) => r.id === itemId);
                      if (
                        !p.deletedAt &&
                        !meta.deletedAt &&
                        !meta.mergedInto &&
                        displayed?.meta.group === legacyGroup
                      ) {
                        itemState[itemId] = {
                          ...meta,
                          groupIds: [
                            ...new Set([...(meta.groupIds || []), id]),
                          ],
                        };
                        changed = true;
                      }
                    });
                    return changed
                      ? [
                          {
                            ...p,
                            itemState,
                            updatedAt: new Date().toISOString(),
                          },
                        ]
                      : [];
                  });
                  await saveMany([
                    layoutPacket(current, {
                      ...live,
                      groups: [...live.groups, { id, name: legacyGroup }],
                    }),
                    ...changes,
                  ]);
                  setLegacyGroup("");
                  setActiveGroup(id);
                  notify("已保存为长期小组，AI不会改动确认后的归属");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              将「{legacyGroup}」保留为我的小组
            </button>
          )}
          {!!mergeSelection.length && !!layout.groups.length && (
            <label>
              将选定卡片加入小组
              <select
                aria-label="将选卡加入小组"
                defaultValue=""
                onChange={async (e) => {
                  const id = e.target.value;
                  e.target.value = "";
                  if (!id) return;
                  let failed = false;
                  for (const row of rows.filter((r) =>
                    mergeSelection.includes(r.id),
                  ))
                    if (
                      !(await update(row.p, row.id, {
                        groupIds: [
                          ...new Set([...(row.meta.groupIds || []), id]),
                        ],
                      }))
                    )
                      failed = true;
                  setMergeSelection([]);
                  notify(
                    failed
                      ? "部分卡片未保存，请刷新后核对重试；已成功保存的归属保留"
                      : "选定卡片已加入小组，原有归属保留",
                  );
                }}
              >
                <option value="">选择目标小组</option>
                {layout.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {groupManager && (
            <section className="world-group-manager">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await save(
                      layoutPacket(latestPackets.current, {
                        ...layout,
                        groups: [
                          ...layout.groups,
                          { id: crypto.randomUUID(), name: newGroup.trim() },
                        ],
                      }),
                    );
                    setNewGroup("");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                <input
                  aria-label="新小组名称"
                  value={newGroup}
                  maxLength={80}
                  onChange={(e) => setNewGroup(e.target.value)}
                />
                <button disabled={!newGroup.trim()}>建立小组</button>
              </form>
              {layout.groups.map((g, i) => (
                <div key={g.id}>
                  <b>{g.name}</b>
                  <button
                    onClick={async () => {
                      const name = prompt("小组新名称", g.name);
                      if (name?.trim())
                        try {
                          await save(
                            layoutPacket(latestPackets.current, {
                              ...layout,
                              groups: layout.groups.map((x) =>
                                x.id === g.id ? { ...x, name: name.trim() } : x,
                              ),
                            }),
                          );
                        } catch (e) {
                          notify((e as Error).message);
                        }
                    }}
                  >
                    改名
                  </button>
                  <button
                    disabled={!i}
                    onClick={async () => {
                      const groups = [...layout.groups];
                      [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]];
                      try {
                        await save(
                          layoutPacket(latestPackets.current, {
                            ...layout,
                            groups,
                          }),
                        );
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    上移
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        !confirm("删除小组？组内卡片保留，其他小组不受影响。")
                      )
                        return;
                      try {
                        await save(
                          layoutPacket(latestPackets.current, {
                            ...layout,
                            groups: layout.groups.filter((x) => x.id !== g.id),
                          }),
                        );
                        if (activeGroup === g.id) setActiveGroup("");
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    删除小组
                  </button>
                </div>
              ))}
              <p>显示类型入口（隐藏不删除内容）</p>
              {Object.entries(categories).map(([k, label]) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={!layout.hiddenKinds.includes(k)}
                    onChange={async (e) => {
                      try {
                        await save(
                          layoutPacket(latestPackets.current, {
                            ...layout,
                            hiddenKinds: e.target.checked
                              ? layout.hiddenKinds.filter((x) => x !== k)
                              : [...layout.hiddenKinds, k],
                          }),
                        );
                        if (kind === k) setKind("all");
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  />
                  {label}
                </label>
              ))}
            </section>
          )}
          <div className="world-browsebar">
            <nav className="category-nav" aria-label="内容分类">
              <button
                aria-pressed={kind === "all"}
                onClick={() => setKind("all")}
              >
                全部 {scoped.length}
              </button>
              {kinds
                .filter((k) => !layout.hiddenKinds.includes(k))
                .map((k) => (
                  <button
                    key={k}
                    className={"kind-" + k}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {categories[k]}{" "}
                    {scoped.filter((r) => r.item.kind === k).length}
                  </button>
                ))}
            </nav>
            <div className="view-switch" hidden={!!layout.groups.length}>
              <button aria-pressed={!grouped} onClick={() => setGrouped(false)}>
                卡片
              </button>
              <button aria-pressed={grouped} onClick={() => setGrouped(true)}>
                按分组查看
              </button>
            </div>
          </div>

          {scope === "trash" && (
            <p>
              删除事项会保留整次投递的原文；原始附件可单独管理。 删除的内容保留
              30
              天。永久删除整次投递会同时移除其中事项；共享原件只在没有有效引用时清理。用量记录继续保留。
            </p>
          )}
        </>
      )}
      {!filtered.length && (
        <div className="result-empty">
          {compact
            ? "这次的事情都处理好了。"
            : "这里暂时没有内容。试试调整筛选，或往投递桶放一些材料。"}
        </div>
      )}
      {mergePreview && (
        <ItemDialog
          label="核对多卡合并"
          onClose={() => {
            if (!mergeBusy) setMergePreview(false);
          }}
        >
          <p>
            以下源卡将退出普通列表，成为一张主卡中的独立子项。各自日期、完成状态、全部原件及来源保留，可撤销。
          </p>
          {mergeSelection.map((id) => {
            const row = rows.find((r) => r.id === id);
            return (
              <p key={id}>
                {row
                  ? `${row.item.title} · ${row.item.due ? deadlineLabel(row.item.due) : "无截止时间"} · ${row.done ? "已完成" : "待处理"} · ${row.p.attachments.length}份原件`
                  : "目标已变化，请取消后重选"}
              </p>
            );
          })}
          <label>
            主卡标题
            <input
              value={mergeTitle}
              maxLength={150}
              onChange={(e) => setMergeTitle(e.target.value)}
            />
          </label>
          <button
            disabled={
              mergeBusy || mergeSelection.length < 2 || !mergeTitle.trim()
            }
            onClick={() =>
              void cardOperation(
                "merge",
                mergeSelection.map((id) => {
                  const row = rows.find((r) => r.id === id);
                  if (!row) throw Error("目标已变化");
                  return { packetId: row.p.id, itemId: id };
                }),
                mergeTitle,
              ).catch((e) => notify(e.message))
            }
          >
            {mergeBusy ? "正在合并…" : "确认合并"}
          </button>
        </ItemDialog>
      )}
      {(grouped ? groups : [""]).map((group) => (
        <section className="result-group" key={group}>
          {grouped && group && (
            <header className="collection-heading">
              {group}{" "}
              <small>
                {
                  filtered.filter((r) => (r.meta.group?.trim() || "") === group)
                    .length
                }{" "}
                项
              </small>
            </header>
          )}
          {grouped && group && (
            <button
              onClick={async () => {
                const members = filtered.filter(
                  (r) => (r.meta.group?.trim() || "") === group,
                );
                const changes = removeGroupLinks(
                  packets,
                  members.map((r) =>
                    itemRef(r.p.id, r.p.itemIds?.[r.index] || r.index),
                  ),
                );
                for (const original of packets.filter(
                  (p) =>
                    members.some((r) => r.p.id === p.id) ||
                    changes.some((c) => c.id === p.id),
                )) {
                  const p =
                    changes.find((c) => c.id === original.id) || original;
                  const itemState = { ...p.itemState };
                  for (const row of members.filter((r) => r.p.id === p.id))
                    itemState[row.id] = { ...row.meta, group: "" };
                  await save({ ...p, itemState });
                }
                notify("已拆开分组，事项与来源仍保留");
              }}
            >
              拆开此分组
            </button>
          )}
          <div className="result-grid">
            {filtered
              .filter((r) => !grouped || (r.meta.group?.trim() || "") === group)
              .map(({ p, item, index, id, meta, deleted, done }) => (
                <article
                  className={
                    "result-card kind-" +
                    item.kind +
                    (meta.pinned ? " is-pinned" : "") +
                    (done ? " is-done" : "")
                  }
                  key={id}
                  data-motion-id={id}
                  onPointerDown={drag.onPointerDown}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <div className="card-topline">
                    {ADMIN_TEST && (
                      <button
                        type="button"
                        className="mobile-card-sort"
                        data-card-drag-handle
                        aria-label={"长按拖动排序：" + item.title}
                        title="长按这里拖动排序"
                      >
                        <GripVertical size={20} />
                      </button>
                    )}
                    <button
                      hidden={meta.defaultDecision === "pending"}
                      className={
                        "completion-orbit" +
                        (completing.has(id) ? " is-checking" : "")
                      }
                      aria-label={
                        item.kind === "habit"
                          ? meta.checkins?.includes(day)
                            ? "撤销今日打卡"
                            : "今日打卡"
                          : done
                            ? "撤销完成 / 归档"
                            : item.kind === "task"
                              ? "完成"
                              : "归档"
                      }
                      aria-pressed={
                        item.kind === "habit"
                          ? !!meta.checkins?.includes(day)
                          : done
                      }
                      disabled={p.status !== "ready" || !!deleted}
                      onClick={() => void toggleCompletion(p, id)}
                    >
                      {(done ||
                        completing.has(id) ||
                        (item.kind === "habit" &&
                          meta.checkins?.includes(day))) && <Check size={19} />}
                    </button>
                    <span className="card-kind">
                      {categories[item.kind]}
                      {meta.status === "progress" ? " · 正在做" : ""}
                    </span>
                    {meta.pinned && <Pin size={16} aria-label="已置顶" />}
                    {!deleted && meta.defaultDecision !== "pending" && (
                      <button
                        className="card-delete"
                        aria-label="删除事项"
                        onClick={() =>
                          void update(p, id, {
                            deletedAt: new Date().toISOString(),
                          })
                        }
                      >
                        <Trash2 size={19} />
                      </button>
                    )}
                    <button
                      className="card-star"
                      hidden={meta.defaultDecision === "pending"}
                      aria-label={meta.starred ? "取消星标" : "星标"}
                      aria-pressed={!!meta.starred}
                      disabled={p.status !== "ready" || !!deleted}
                      onClick={() =>
                        void update(p, id, { starred: !meta.starred })
                      }
                    >
                      <Star
                        size={24}
                        fill={meta.starred ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (
                        e.target === e.currentTarget &&
                        ["Enter", " "].includes(e.key)
                      ) {
                        e.preventDefault();
                        setEditing(false);
                        setSelected(id);
                      }
                    }}
                    className="card-open"
                    aria-label={"查看 " + item.title}
                    onClick={() => {
                      setEditing(false);
                      setSelected(id);
                    }}
                  >
                    {meta.defaultDecision &&
                      meta.defaultDecision !== "pending" && (
                        <span className="quiet">原样保留 · 未完成AI整理</span>
                      )}
                    <h2>{cardCopy(item).title}</h2>
                    {cardCopy(item).summary && (
                      <p>
                        <LinkText text={cardCopy(item).summary} />
                      </p>
                    )}
                  </div>
                  {meta.defaultDecision === "pending" && !deleted && (
                    <section
                      className="default-card-decision"
                      aria-label="未完成整理的材料"
                    >
                      <p>{p.error || "本次整理未完成，原件已保留。"}</p>
                      <p>选择保留为普通卡、移入最近删除，或用原任务重试。</p>
                      {(["kept", "deleted", "retry"] as const).map((choice) => (
                        <button
                          key={choice}
                          className="decision-action"
                          disabled={adopting === id}
                          onClick={async () => {
                            if (adoptionLock.current.has(id)) return;
                            adoptionLock.current.add(id);
                            setAdopting(id);
                            try {
                              let original = latestPackets.current.find(
                                (row) => row.id === p.id,
                              );
                              if (
                                !original ||
                                original.deletedAt ||
                                original.result
                              )
                                throw Error("材料状态已变化，请刷新后核对");
                              if (choice === "retry") {
                                await onRetry?.(original);
                              } else {
                                if (window.desktop) {
                                  const state = await window.desktop.cloud(
                                    "sync",
                                    { force: true },
                                  );
                                  if (
                                    state.jobs?.some(
                                      (t) =>
                                        t.packetId === p.id &&
                                        (t.actions?.includes("stop") ||
                                          [
                                            "paused",
                                            "interrupted",
                                            "error",
                                            "conflict",
                                          ].includes(t.state)),
                                    )
                                  )
                                    await window.desktop.cloud("stopPacket", {
                                      packetId: p.id,
                                    });
                                }
                                if (window.desktop) {
                                  const canonical = (await allPackets()).find(
                                    (row) => row.id === p.id,
                                  );
                                  if (
                                    !canonical ||
                                    canonical.deletedAt ||
                                    canonical.result
                                  )
                                    throw Error(
                                      "材料已完成或状态变化，请关闭后刷新核对",
                                    );
                                  original = canonical;
                                }
                                const next = defaultCard(original);
                                await save({
                                  ...next,
                                  status: "ready",
                                  defaultCardDisposition: {
                                    choice,
                                    at: new Date().toISOString(),
                                  },
                                  error: "",
                                  itemState: {
                                    ...next.itemState,
                                    [id]: {
                                      ...next.itemState?.[id],
                                      defaultDecision: choice,
                                      ...(choice === "deleted"
                                        ? {
                                            deletedAt: new Date().toISOString(),
                                          }
                                        : {}),
                                    },
                                  },
                                  updatedAt: new Date().toISOString(),
                                });
                                notify(
                                  choice === "kept"
                                    ? "已保留，可正常编辑、分组和删除"
                                    : "已移入最近删除",
                                );
                              }
                            } catch (e) {
                              notify(errorMessage(e));
                            } finally {
                              adoptionLock.current.delete(id);
                              setAdopting("");
                            }
                          }}
                        >
                          {adopting === id
                            ? "处理中…"
                            : choice === "kept"
                              ? "保留"
                              : choice === "deleted"
                                ? "删除"
                                : "重试"}
                        </button>
                      ))}
                    </section>
                  )}
                  {!compact &&
                    !deleted &&
                    !meta.mergedCard &&
                    meta.defaultDecision !== "pending" && (
                      <label className="merge-select">
                        <input
                          type="checkbox"
                          aria-label={"选择合并 " + item.title}
                          checked={mergeSelection.includes(id)}
                          onChange={(e) =>
                            setMergeSelection(
                              e.target.checked
                                ? [...mergeSelection, id]
                                : mergeSelection.filter((x) => x !== id),
                            )
                          }
                        />
                        选择卡片
                      </label>
                    )}
                  {meta.mergedCard && (
                    <section
                      className="merged-card-parts"
                      aria-label="合并子项"
                    >
                      {meta.mergedCard.sources.map((source) => {
                        const packet = packets.find(
                            (p) => p.id === source.packetId,
                          ),
                          i = packet?.itemIds?.indexOf(source.itemId) ?? -1,
                          child = packet?.result?.items[i],
                          state = packet?.itemState?.[source.itemId] || {};
                        return (
                          <div key={source.itemId}>
                            <b>{child?.title || source.title}</b>
                            <p>{child?.summary}</p>
                            <p>
                              {child?.due
                                ? deadlineLabel(child.due)
                                : "无截止时间"}
                            </p>
                            {packet && child && (
                              <>
                                <button
                                  aria-pressed={
                                    state.status === "done" ||
                                    packet.doneIds.includes(i)
                                  }
                                  onClick={() =>
                                    void toggleCompletion(packet, source.itemId)
                                  }
                                >
                                  {state.status === "done" ||
                                  packet.doneIds.includes(i)
                                    ? "已完成 · 撤销"
                                    : "完成子项"}
                                </button>
                                <button onClick={() => setMaterials(packet.id)}>
                                  查看此项全部原件与来源
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                      <button
                        disabled={mergeBusy}
                        onClick={async () => {
                          try {
                            await cardOperation("undo", [
                              { packetId: p.id, itemId: id },
                            ]);
                          } catch (e) {
                            const text = (e as Error).message;
                            if (
                              text.includes("已有修改") &&
                              confirm(
                                text + "。将主卡保留为一张独立卡并恢复源卡？",
                              )
                            )
                              try {
                                await cardOperation(
                                  "undo",
                                  [{ packetId: p.id, itemId: id }],
                                  "",
                                  true,
                                );
                              } catch (error) {
                                notify((error as Error).message);
                              }
                            else notify(text);
                          }
                        }}
                      >
                        撤销合并
                      </button>
                    </section>
                  )}
                  <div className="card-context">
                    {item.due && (
                      <span
                        className={
                          item.due.date < day && !done
                            ? "deadline is-overdue"
                            : "deadline"
                        }
                      >
                        {deadlineLabel(item.due)}
                        {item.due.date < day && !done ? " · 已过期" : ""}
                      </span>
                    )}
                    {layout.groups
                      .filter((g) => meta.groupIds?.includes(g.id))
                      .map((g) => (
                        <button
                          className="collection-tag"
                          key={g.id}
                          onClick={() => {
                            setActiveGroup(g.id);
                            setLegacyGroup("");
                          }}
                        >
                          {g.name}
                        </button>
                      ))}
                    {meta.groupIds === undefined &&
                      !!meta.group?.trim() &&
                      !layout.groups.some(
                        (g) =>
                          meta.groupIds?.includes(g.id) &&
                          g.name === meta.group,
                      ) && <span className="collection-tag">{meta.group}</span>}
                  </div>
                  <CardFiles
                    attachments={p.attachments}
                    packet={p}
                    onOpen={() => {
                      materialOrigin.current = id;
                      setMaterials(p.id);
                    }}
                  />
                  <div className="card-bottom">
                    <button
                      className="card-source-link"
                      onClick={() => {
                        materialOrigin.current = id;
                        setMaterials(p.id);
                      }}
                    >
                      <Paperclip size={16} />
                      {p.attachments.filter((a) => !a.deletedAt).length
                        ? p.attachments.filter((a) => !a.deletedAt).length +
                          " 份同行材料"
                        : "输入原文"}
                      <ArrowUpRight size={15} />
                    </button>
                    {item.kind === "habit" && !deleted && (
                      <button
                        className="habit-check"
                        aria-pressed={!!meta.checkins?.includes(day)}
                        onClick={() => void toggleCompletion(p, id)}
                      >
                        {meta.checkins?.includes(day)
                          ? "今日已打卡 · 再点撤销"
                          : "今日打卡"}{" "}
                        · 累计 {new Set(meta.checkins || []).size} 天
                      </button>
                    )}
                    <button
                      className="card-detail-link"
                      onClick={() => {
                        setEditing(false);
                        setSelected(id);
                      }}
                    >
                      查看详情 <ArrowUpRight size={16} />
                    </button>
                    {!deleted && meta.defaultDecision !== "pending" && (
                      <button
                        className="card-detail-link"
                        onClick={() => {
                          setEditing(true);
                          setSelected(id);
                        }}
                      >
                        手动编辑
                      </button>
                    )}
                    <details
                      className="card-menu"
                      hidden={meta.defaultDecision === "pending"}
                    >
                      <summary aria-label="更多事项操作">
                        <MoreHorizontal size={23} />
                      </summary>
                      <div>
                        {!!layout.groups.length && (
                          <fieldset>
                            <legend>加入小组（可多选）</legend>
                            {layout.groups.map((g) => (
                              <GroupMembership
                                key={g.id}
                                name={g.name}
                                checked={!!meta.groupIds?.includes(g.id)}
                                notify={notify}
                                change={(checked) =>
                                  update(p, id, (current) => ({
                                    groupIds: checked
                                      ? [
                                          ...new Set([
                                            ...(current.groupIds || []),
                                            g.id,
                                          ]),
                                        ]
                                      : (current.groupIds || []).filter(
                                          (x) => x !== g.id,
                                        ),
                                  }))
                                }
                              />
                            ))}
                          </fieldset>
                        )}
                        <button
                          onClick={() => {
                            setEditing(true);
                            setSelected(id);
                          }}
                        >
                          编辑内容与分组
                        </button>
                        {!deleted && (
                          <>
                            <button
                              onClick={() =>
                                void update(p, id, { pinned: !meta.pinned })
                              }
                            >
                              {meta.pinned ? "取消置顶" : "置顶"}
                            </button>
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                  {selected === id && (
                    <ItemDialog onClose={() => setSelected("")}>
                      {p.status !== "ready" && (
                        <p>
                          {meta.defaultDecision === "pending"
                            ? "尚未完成AI整理，请先在卡片上选择保留、删除或重试；原样材料仍可查看。"
                            : "正在补充读取，本次事项暂不可修改；你可以继续投递或查看其他事项。"}
                        </p>
                      )}
                      <fieldset
                        className={"result-body kind-" + item.kind}
                        disabled={p.status !== "ready"}
                      >
                        <div className="result-heading">
                          <span>{categories[item.kind]}</span>
                          <h2>{cardCopy(item).title}</h2>
                          {meta.pinned && <b>置顶</b>}
                          {meta.starred && <b>★</b>}
                        </div>
                        {!deleted && (
                          <section className="item-editor" hidden={!editing}>
                            <h3>编辑内容与分组</h3>
                            <form
                              key={JSON.stringify([item, meta])}
                              onSubmit={async (e) => {
                                e.preventDefault();
                                const data = new FormData(e.currentTarget),
                                  date = String(data.get("date") || "");
                                let parsedDue = null;
                                try {
                                  parsedDue = date
                                    ? parseDeadline(
                                        date,
                                        localDate(),
                                        String(data.get("time") || ""),
                                      )
                                    : null;
                                } catch (error) {
                                  notify((error as Error).message);
                                  return;
                                }
                                const items = [...p.result!.items];
                                items[index] = {
                                  ...item,
                                  title: String(data.get("title")).trim(),
                                  kind: String(data.get("kind")) as BucketKind,
                                  due: parsedDue,
                                };
                                items[index] = {
                                  ...items[index],
                                  summary: String(data.get("summary") || ""),
                                  facts: String(data.get("facts") || "")
                                    .split("\n")
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                  uncertainties: String(
                                    data.get("uncertainties") || "",
                                  )
                                    .split("\n")
                                    .filter(Boolean),
                                };
                                items[index] = setDeadline(
                                  {
                                    ...absoluteItem(items[index], localDate()),
                                    due: item.due,
                                  },
                                  items[index].due,
                                  p.captureDate,
                                );
                                const edits = [
                                  ["标题", item.title, items[index].title],
                                  ["分类", item.kind, items[index].kind],
                                  [
                                    "日期",
                                    item.due?.date || "",
                                    items[index].due?.date || "",
                                  ],
                                  ["总结", item.summary, items[index].summary],
                                ]
                                  .filter(
                                    ([, before, after]) => before !== after,
                                  )
                                  .map(([field, before, after]) => ({
                                    at: new Date().toISOString(),
                                    field,
                                    before,
                                    after,
                                    source: "人工确认",
                                  }));
                                await save({
                                  ...p,
                                  result: { ...p.result!, items },
                                  itemState: {
                                    ...p.itemState,
                                    [id]: {
                                      ...meta,
                                      corrected: true,
                                      history: [
                                        ...(meta.history || []),
                                        ...edits,
                                      ],
                                      importance: Number(
                                        data.get("importance"),
                                      ),
                                      group: String(data.get("group") || ""),
                                      order: Number(data.get("order")),
                                    },
                                  },
                                });
                                notify("修改已保存，原始来源保留");
                                setEditing(false);
                              }}
                            >
                              <label>
                                标题
                                <input
                                  name="title"
                                  required
                                  maxLength={150}
                                  defaultValue={item.title}
                                />
                              </label>
                              <label>
                                总结
                                <textarea
                                  name="summary"
                                  aria-label="总结"
                                  defaultValue={item.summary}
                                />
                              </label>
                              <label>
                                关键要求（每行一项）
                                <textarea
                                  name="facts"
                                  aria-label="关键要求（每行一项）"
                                  defaultValue={item.facts.join("\n")}
                                />
                              </label>
                              <label>
                                备注（每行一项）
                                <textarea
                                  name="uncertainties"
                                  aria-label="备注（每行一项）"
                                  defaultValue={item.uncertainties.join("\n")}
                                />
                              </label>
                              <label>
                                分类
                                <select name="kind" defaultValue={item.kind}>
                                  {Object.entries(categories).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                日期
                                <input
                                  type="text"
                                  name="date"
                                  placeholder="26号 / 26-28 / 明天14:00到16:00"
                                  defaultValue={
                                    item.due?.startDate
                                      ? deadlineLabel(item.due).replace(
                                          " → ",
                                          " 至 ",
                                        )
                                      : item.due?.date
                                  }
                                />
                              </label>
                              <label>
                                时间
                                <input
                                  type="time"
                                  name="time"
                                  defaultValue={
                                    item.due?.startDate ? "" : item.due?.time
                                  }
                                />
                              </label>
                              <label>
                                重要程度
                                <select
                                  name="importance"
                                  defaultValue={
                                    meta.importance ?? item.importance ?? 1
                                  }
                                >
                                  <option value="0">低</option>
                                  <option value="1">普通</option>
                                  <option value="2">高</option>
                                </select>
                              </label>
                              <label>
                                课程 / 项目
                                <input
                                  name="group"
                                  defaultValue={meta.group}
                                  list="project-groups"
                                />
                              </label>
                              <label>
                                自定义位置
                                <input
                                  name="order"
                                  type="number"
                                  defaultValue={meta.order ?? index}
                                />
                              </label>
                              <button type="submit">保存修改</button>
                            </form>
                          </section>
                        )}
                        <div hidden={editing}>
                          {item.due && (
                            <p
                              className={
                                item.due.date < day && !done
                                  ? "is-overdue"
                                  : "result-date"
                              }
                            >
                              {item.kind === "event" ? "发生时间" : "截止"}：
                              {deadlineLabel(item.due)}{" "}
                              {item.due.date < day
                                ? item.kind === "event"
                                  ? "· 已结束"
                                  : !done
                                    ? "· 已逾期"
                                    : ""
                                : item.due.date === day
                                  ? "· 今天"
                                  : ""}
                            </p>
                          )}
                          <p>
                            <LinkText text={item.summary} />
                          </p>
                          <DeliverySources
                            packet={p}
                            save={save}
                            notify={notify}
                          />
                          {!deleted && (
                            <ItemChat
                              groups={layout.groups}
                              selectedTargets={rows
                                .filter((r) => mergeSelection.includes(r.id))
                                .map((r) => ({
                                  packetId: r.p.id,
                                  itemId: r.id,
                                  title: r.item.title,
                                }))}
                              expansionTargets={rows
                                .filter(
                                  (r) =>
                                    !r.deleted &&
                                    !r.meta.mergedInto &&
                                    (r.p.id === p.id ||
                                      r.meta.groupIds?.some((g) =>
                                        meta.groupIds?.includes(g),
                                      )),
                                )
                                .map((r) => ({
                                  packetId: r.p.id,
                                  itemId: r.id,
                                  title: r.item.title,
                                }))}
                              mergeProposal={async () => {
                                if (!meta.chatMerge)
                                  throw Error("合并建议已失效");
                                for (const target of meta.chatMerge.targets) {
                                  const packet = latestPackets.current.find(
                                      (p) => p.id === target.packetId,
                                    ),
                                    i =
                                      packet?.itemIds?.indexOf(target.itemId) ??
                                      -1;
                                  if (
                                    !packet?.result ||
                                    i < 0 ||
                                    JSON.stringify(
                                      absoluteItem(
                                        packet.result.items[i],
                                        packet.captureDate,
                                      ),
                                    ) !== JSON.stringify(target.beforeItem)
                                  )
                                    throw Error(
                                      "目标卡片已修改，请重新核对合并建议",
                                    );
                                }
                                await cardOperation(
                                  "merge",
                                  meta.chatMerge.targets,
                                  meta.chatMerge.title,
                                );
                              }}
                              meta={meta}
                              applyProposals={
                                onApplyProposals
                                  ? () => onApplyProposals(p.id, id)
                                  : undefined
                              }
                              send={async (text, options) => {
                                const next = await onChat(
                                  p.id,
                                  id,
                                  text,
                                  options,
                                );
                                setKind("all");
                                setDateFilter("all");
                                setStarOnly(false);
                                setScope(
                                  next.status === "done" ? "done" : "active",
                                );
                              }}
                            />
                          )}
                          {meta.origin && (
                            <p>此行动由你采纳 AI 建议生成，属于自选行动。</p>
                          )}
                          <details
                            className="item-metadata"
                            hidden={!showHistory}
                            open={showHistory}
                          >
                            <summary>事项信息与修改记录</summary>
                            <small>
                              重要程度：
                              {
                                ["低", "普通", "高"][
                                  meta.importance ?? item.importance ?? 1
                                ]
                              }{" "}
                              ·{" "}
                              {meta.importance !== undefined
                                ? "人工确认"
                                : item.importanceReason || "AI 未提供明确依据"}
                            </small>
                            {meta.corrected && (
                              <small>已人工修正，重试不会覆盖此结果</small>
                            )}
                            {item.kind === "habit" && (
                              <p>
                                {meta.checkins?.includes(day)
                                  ? "今日已打卡"
                                  : "今日待打卡"}{" "}
                                · 累计 {new Set(meta.checkins || []).size} 天
                              </p>
                            )}
                            {item.kind !== "habit" && meta.completedAt && (
                              <p>
                                <small>
                                  完成 / 归档于{" "}
                                  {new Date(meta.completedAt).toLocaleString()}
                                </small>
                              </p>
                            )}
                            {!!meta.history?.length && (
                              <details>
                                <summary>修改与补充记录</summary>
                                {meta.history.map((change, i) => (
                                  <div key={i}>
                                    <p>
                                      {new Date(change.at).toLocaleString()} ·{" "}
                                      {change.field} · {change.source}
                                    </p>
                                    <p>修改前：{change.before || "未设置"}</p>
                                    <p>修改后：{change.after || "未设置"}</p>
                                  </div>
                                ))}
                              </details>
                            )}
                          </details>
                          {deleted ? (
                            <div className="result-actions">
                              <span>
                                剩余{" "}
                                {Math.max(
                                  0,
                                  30 -
                                    Math.floor(
                                      (Date.now() - Date.parse(deleted)) /
                                        86400000,
                                    ),
                                )}{" "}
                                天
                              </span>
                              <button
                                onClick={async () => {
                                  if (p.deletedAt) {
                                    await save({ ...p, deletedAt: undefined });
                                    notify("已恢复整次投递及其分组");
                                  } else
                                    await update(p, id, {
                                      deletedAt: "",
                                    });
                                }}
                              >
                                恢复{p.deletedAt ? "整次投递" : "事项"}
                              </button>
                              {!p.deletedAt && (
                                <button
                                  onClick={async () => {
                                    if (
                                      !confirm(
                                        "永久删除此事项及打卡记录？原始投递与其他事项仍保留。",
                                      )
                                    )
                                      return;
                                    const items = [...p.result!.items];
                                    items[index] = {
                                      kind: "other",
                                      title: "已永久删除",
                                      summary: "",
                                      facts: [],
                                      nextSteps: [],
                                      uncertainties: [],
                                      evidence: [],
                                      sourceIds: [],
                                      due: null,
                                    };
                                    await save({
                                      ...p,
                                      result: { ...p.result!, items },
                                      itemState: {
                                        ...p.itemState,
                                        [id]: {
                                          purgedAt: new Date().toISOString(),
                                        },
                                      },
                                    });
                                  }}
                                >
                                  永久删除此事项
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (
                                    confirm(
                                      "永久删除整次投递及其中所有事项？此操作无法恢复。",
                                    )
                                  )
                                    void purge(p.id);
                                }}
                              >
                                永久删除整次投递
                              </button>
                            </div>
                          ) : null}
                          <section
                            className="item-requirements"
                            aria-label="原文要求、建议与来源"
                          >
                            <h3>要做什么</h3>
                            <ul>
                              {item.facts.map((f, i) => (
                                <li key={i}>
                                  <LinkText text={f} />
                                </li>
                              ))}
                            </ul>
                            <h3>原文依据</h3>
                            {item.evidence.map((e, i) => (
                              <blockquote key={i}>
                                <small>
                                  {sourceLocation(
                                    p.readingCoverage,
                                    e.sourceId,
                                  ) ||
                                    p.sources.find((s) => s.id === e.sourceId)
                                      ?.name}
                                  {e.sourceId === "input"
                                    ? " · 输入原文"
                                    : p.sources
                                          .find((s) => s.id === e.sourceId)
                                          ?.text.startsWith("[图像识别转写") ||
                                        p.sources
                                          .find((s) => s.id === e.sourceId)
                                          ?.originalText?.startsWith(
                                            "[图像识别转写",
                                          )
                                      ? " · 图像识别转写（需对照原图）"
                                      : " · 文件提取文字"}
                                </small>
                                <p>
                                  <LinkText text={e.quote} />
                                </p>
                              </blockquote>
                            ))}
                            {!!item.nextSteps.length && (
                              <>
                                <h3>AI 建议（可选）</h3>
                                <ul>
                                  {item.nextSteps.map((f, i) => (
                                    <li key={i}>
                                      <LinkText text={f} />
                                      {!deleted && (
                                        <button
                                          disabled={
                                            adopting === p.id ||
                                            Object.values(
                                              p.itemState || {},
                                            ).some(
                                              (m) =>
                                                m.origin ===
                                                `${id}:suggestion:${i}`,
                                            )
                                          }
                                          onClick={async () => {
                                            const origin = `${id}:suggestion:${i}`;
                                            if (adoptionLock.current.has(p.id))
                                              return;
                                            if (
                                              Object.values(
                                                p.itemState || {},
                                              ).some((m) => m.origin === origin)
                                            )
                                              return notify("这条建议已采纳");
                                            adoptionLock.current.add(p.id);
                                            setAdopting(p.id);
                                            setAdoptionError("");
                                            const nextId = crypto.randomUUID();
                                            try {
                                              await save({
                                                ...p,
                                                itemIds: [
                                                  ...(p.itemIds ||
                                                    p.result!.items.map(
                                                      (_, i) => `${p.id}:${i}`,
                                                    )),
                                                  nextId,
                                                ],
                                                result: {
                                                  ...p.result!,
                                                  items: [
                                                    ...p.result!.items,
                                                    {
                                                      ...item,
                                                      kind: "task",
                                                      title: f.slice(0, 150),
                                                      summary:
                                                        "你采纳的 AI 建议：" +
                                                        f,
                                                      facts: [],
                                                      nextSteps: [],
                                                      due: null,
                                                    },
                                                  ],
                                                },
                                                itemState: {
                                                  ...p.itemState,
                                                  [nextId]: {
                                                    origin,
                                                    group: meta.group,
                                                    importance: 1,
                                                  },
                                                },
                                              });
                                              notify("已采纳为自选行动");
                                            } catch (error) {
                                              setAdoptionError(
                                                (error as Error).message,
                                              );
                                            } finally {
                                              adoptionLock.current.delete(p.id);
                                              setAdopting("");
                                            }
                                          }}
                                        >
                                          {Object.values(
                                            p.itemState || {},
                                          ).some(
                                            (m) =>
                                              m.origin ===
                                              `${id}:suggestion:${i}`,
                                          )
                                            ? "已采纳 ✓"
                                            : adopting === p.id
                                              ? "正在添加…"
                                              : "采纳为行动"}
                                        </button>
                                      )}
                                      {Object.values(p.itemState || {}).some(
                                        (m) =>
                                          m.origin === `${id}:suggestion:${i}`,
                                      ) && (
                                        <span
                                          className="adoption-receipt"
                                          role="status"
                                        >
                                          已加入任务卡片
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                {adoptionError && (
                                  <p role="alert">
                                    添加失败：{adoptionError}，请重试。
                                  </p>
                                )}
                              </>
                            )}
                          </section>
                        </div>
                        {!deleted && (
                          <div className="dialog-footer">
                            <button onClick={() => setEditing((v) => !v)}>
                              {editing ? "返回详情" : "手动编辑"}
                            </button>
                            <details className="detail-action-menu">
                              <summary aria-label="卡片操作">
                                <MoreHorizontal size={23} />
                              </summary>
                              <div>
                                <button onClick={() => setEditing((v) => !v)}>
                                  {editing ? "查看详情" : "编辑内容"}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditing(true);
                                    requestAnimationFrame(() =>
                                      document
                                        .querySelector<HTMLInputElement>(
                                          "dialog[open] input[name=group]",
                                        )
                                        ?.focus(),
                                    );
                                  }}
                                >
                                  分组
                                </button>
                                <button
                                  onClick={() =>
                                    void update(p, id, { pinned: !meta.pinned })
                                  }
                                >
                                  {meta.pinned ? "取消置顶" : "置顶"}
                                </button>
                                <button
                                  onClick={() => void toggleCompletion(p, id)}
                                >
                                  {item.kind === "habit"
                                    ? meta.checkins?.includes(day)
                                      ? "撤销今日打卡"
                                      : "今日打卡"
                                    : done
                                      ? "撤销完成 / 归档"
                                      : item.kind === "task"
                                        ? "完成"
                                        : "归档"}
                                </button>
                                <button
                                  onClick={() => {
                                    setShowHistory((v) => !v);
                                    setEditing(false);
                                  }}
                                >
                                  修改记录
                                </button>
                              </div>
                            </details>
                          </div>
                        )}
                      </fieldset>
                    </ItemDialog>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
      <datalist id="project-groups">
        {groups.filter(Boolean).map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      {materials && packets.find((p) => p.id === materials) && (
        <ItemDialog
          label="同行材料"
          originId={materialOrigin.current}
          onClose={() => setMaterials("")}
        >
          <DeliverySources
            packet={packets.find((p) => p.id === materials)!}
            save={save}
            notify={notify}
          />
        </ItemDialog>
      )}
      {matchCount > limit && (
        <button onClick={() => setLimit((n) => n + 60)}>
          再显示 60 项（共 {matchCount} 项）
        </button>
      )}
      {scope === "trash" &&
        packets
          .filter((p) => !p.deletedAt && p.attachments.some((a) => a.deletedAt))
          .map((p) => (
            <section className="deleted-delivery" key={p.id}>
              <h2>{p.text.slice(0, 60) || "这次投递的材料"}</h2>
              <DeliverySources packet={p} save={save} notify={notify} />
            </section>
          ))}
      {scope === "trash" &&
        packets
          .filter((p) => p.deletedAt && !p.result?.items.length)
          .map((p) => (
            <article className="result-card" key={p.id}>
              <p>
                {p.text.slice(0, 100) || "未完成的投递"} ·{" "}
                {p.attachments.length} 个附件
              </p>
              <button onClick={() => void save({ ...p, deletedAt: undefined })}>
                恢复投递
              </button>
              <button
                onClick={() => {
                  if (confirm("永久删除这次投递？")) void purge(p.id);
                }}
              >
                永久删除
              </button>
            </article>
          ))}
    </section>
  );
}
function GroupMembership({
  name,
  checked,
  change,
  notify,
}: {
  name: string;
  checked: boolean;
  change: (checked: boolean) => Promise<boolean | undefined>;
  notify: (message: string) => void;
}) {
  const [pending, setPending] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => setPending(null), [checked]);
  return (
    <label>
      <input
        type="checkbox"
        checked={pending ?? checked}
        disabled={busy}
        aria-busy={busy}
        onChange={async (e) => {
          const desired = e.target.checked;
          setPending(desired);
          setBusy(true);
          try {
            if (!(await change(desired))) setPending(null);
          } catch (error) {
            setPending(null);
            notify((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {name}
      {busy && <span aria-hidden="true"> · 保存中…</span>}
    </label>
  );
}
export default memo(Results);
