import { absoluteItem, setDeadline } from "./deadlines.mjs";
import { itemDeadlineTime } from "./deadline-time.mjs";

// A typed private sync record reuses account isolation, durable queues, originals
// and backup. It never becomes a bucket capture or a model request.
export const BOARD_ID = "shixu-board-workspace-v1";
export const isBoardRecord = (p) => p?.recordType === "board-workspace";
export const emptyBoard = () => ({
  version: 1,
  activePlanId: "daily",
  plans: [{ id: "daily", name: "日常规划" }],
  tasks: [],
  longPlans: [],
  resources: [],
  drafts: {},
});
const clone = (x) => structuredClone(x);
const fail = (s) => {
  throw Error(s);
};
const text = (s, max = 120) =>
  typeof s === "string" && s.length > 0 && s.length <= max;
const id = (s) =>
  text(s) && !["__proto__", "constructor", "prototype"].includes(s);
const date = (s) =>
  s === null || (typeof s === "string" && Number.isFinite(Date.parse(s)));
// A compact change fingerprint, not an authorization credential. Native writes
// also compare the store/queue revision; cloud writes retain server CAS.
function changeToken(value) {
  let a = 2166136261,
    b = 2654435769;
  for (const c of JSON.stringify(value)) {
    const n = c.codePointAt(0);
    a = Math.imul(a ^ n, 16777619) >>> 0;
    b = Math.imul(b ^ n, 2246822519) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export function validateBoard(s) {
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.plans) ||
    !s.plans.length ||
    s.plans.length > 100 ||
    !Array.isArray(s.tasks) ||
    s.tasks.length > 2000 ||
    !Array.isArray(s.longPlans) ||
    s.longPlans.length > 500 ||
    !Array.isArray(s.resources) ||
    s.resources.length > 20
  )
    fail("看板结构无效或超过容量（100份规划、2000事项、20份资料）");
  for (const rows of [s.plans, s.tasks, s.longPlans, s.resources])
    if (
      new Set(rows.map((x) => x?.id)).size !== rows.length ||
      rows.some((x) => !id(x?.id))
    )
      fail("看板标识重复或无效");
  const plans = new Set(s.plans.map((p) => p.id));
  if (!plans.has(s.activePlanId) || s.plans.some((p) => !text(p.name, 100)))
    fail("规划名称或当前规划无效");
  if (
    s.tasks.some(
      (t) =>
        !plans.has(t.planningId) ||
        !text(t.title, 500) ||
        !["manual", "source", "step"].includes(t.origin) ||
        !date(t.completedAt) ||
        !date(t.dueAt) ||
        typeof t.archived !== "boolean" ||
        !["explicit", "inferred"].includes(t.timePrecision) ||
        (t.deletedAt !== undefined && !date(t.deletedAt)) ||
        (t.origin === "source" && !text(t.sourceId, 500)),
    )
  )
    fail("看板事项无效");
  for (const p of s.longPlans) {
    if (
      !plans.has(p.planningId) ||
      !text(p.title, 500) ||
      !date(p.completedAt) ||
      (p.deletedAt !== undefined && !date(p.deletedAt)) ||
      !Array.isArray(p.stepIds) ||
      new Set(p.stepIds).size !== p.stepIds.length
    )
      fail("长期计划无效");
    for (const taskId of p.stepIds)
      if (
        !s.tasks.some(
          (t) =>
            t.id === taskId &&
            t.parentId === p.id &&
            t.origin === "step" &&
            t.planningId === p.planningId,
        )
      )
        fail("子事项关联无效");
  }
  for (const t of s.tasks)
    if (
      t.origin === "step" &&
      !s.longPlans.some(
        (p) =>
          p.id === t.parentId &&
          p.stepIds.includes(t.id) &&
          p.planningId === t.planningId,
      )
    )
      fail("子事项缺少父计划");
  const links = s.tasks
    .filter((t) => t.origin === "source")
    .map((t) => t.planningId + "#" + t.sourceId);
  if (new Set(links).size !== links.length)
    fail("同一规划不能重复选入同一来源");
  for (const r of s.resources)
    if (
      !plans.has(r.planningId) ||
      !text(r.name, 255) ||
      !["image", "file"].includes(r.kind) ||
      !date(r.createdAt) ||
      !id(r.attachmentId) ||
      (r.longPlanId !== undefined &&
        !s.longPlans.some(
          (p) => p.id === r.longPlanId && p.planningId === r.planningId,
        )) ||
      (r.deletedAt !== undefined && !date(r.deletedAt))
    )
      fail("资料引用无效");
  if (
    s.drafts &&
    (typeof s.drafts !== "object" ||
      Array.isArray(s.drafts) ||
      Object.entries(s.drafts).some(
        ([k, v]) => !id(k) || typeof v !== "string" || v.length > 2000,
      ))
  )
    fail("看板输入草稿无效");
  if (new TextEncoder().encode(JSON.stringify(s)).byteLength > 600000)
    fail("看板内容较多，请先整理规划后重试");
  return s;
}
export function sourceRows(packets) {
  return packets
    .filter((p) => !isBoardRecord(p) && !p.deletedAt && p.status === "ready")
    .flatMap((p) =>
      (p.result?.items || []).flatMap((raw, index) => {
        const itemId = p.itemIds?.[index] || `${p.id}:${index}`,
          meta = p.itemState?.[itemId] || {};
        if (meta.deletedAt || meta.purgedAt || meta.mergedInto) return [];
        const item = absoluteItem(raw, p.captureDate, p.sources, meta.chat),
          clock = itemDeadlineTime(item, p.sources, meta.chat);
        const dueAt = item.due?.date
          ? new Date(
              `${item.due.date}T${clock.time || "23:59"}:00+08:00`,
            ).toISOString()
          : null;
        const completedAt =
          meta.status === "done" || p.doneIds.includes(index)
            ? meta.completedAt || p.updatedAt
            : null;
        return [
          {
            id: JSON.stringify([p.id, itemId]),
            packet: p,
            index,
            itemId,
            item,
            title: item.title,
            completedAt,
            dueAt,
            timePrecision: clock.timeInferred ? "inferred" : "explicit",
            sourceLabel: "主程序",
            dueLabel: item.due
              ? `${item.due.startDate ? item.due.startDate + " " + (item.due.startTime || "") + " 至 " : ""}${item.due.date} ${clock.time || "23:59"}${clock.timeReason ? " · " + clock.timeReason : ""}`
              : "",
            token: changeToken([
              p.syncVersion || 0,
              p.updatedAt,
              raw,
              meta,
              p.doneIds,
            ]),
          },
        ];
      }),
    );
}
export function boardView(record, packets) {
  const board = clone(record?.board || emptyBoard());
  validateBoard(board);
  const rows = sourceRows(packets),
    map = new Map(rows.map((r) => [r.id, r]));
  const snapshot = {
    ...board,
    sourceTasks: rows.map(
      ({ id, title, completedAt, dueAt, timePrecision, sourceLabel }) => ({
        id,
        title,
        completedAt,
        dueAt,
        timePrecision,
        sourceLabel,
      }),
    ),
    deadlines: rows
      .filter((r) => r.dueAt)
      .map((r) => ({
        id: r.id,
        title: r.title,
        dueAt: r.dueAt,
        timePrecision: r.timePrecision,
        completedAt: r.completedAt,
        sourceLabel: r.sourceLabel,
        sourceTaskId: r.id,
        dueLabel: r.dueLabel,
      })),
    tasks: board.tasks.map((t) => {
      if (t.origin !== "source") return t;
      const r = map.get(t.sourceId);
      return r
        ? {
            ...t,
            title: r.title,
            completedAt: r.completedAt,
            dueAt: r.dueAt,
            timePrecision: r.timePrecision,
            sourceUnavailable: false,
          }
        : {
            ...t,
            title: "来源不可用",
            dueAt: null,
            completedAt: null,
            sourceUnavailable: true,
          };
    }),
  };
  snapshot.resources = snapshot.resources
    .filter(
      (r) =>
        !r.deletedAt ||
        record?.attachments.some((a) => a.id === r.attachmentId),
    )
    .map((r) => ({
      ...r,
      planLabel: [
        board.plans.find((p) => p.id === r.planningId)?.name,
        ...board.longPlans
          .filter((p) => p.id === r.longPlanId)
          .map((p) => p.title + (p.deletedAt ? "（已删除，可恢复）" : "")),
      ]
        .filter(Boolean)
        .join(" / "),
    }));
  return {
    snapshot,
    stamp: record?.boardStamp || "",
    sourceTokens: Object.fromEntries(rows.map((r) => [r.id, r.token])),
    syncConflict: !!record?.syncConflict,
  };
}
export function storedBoard(snapshot) {
  const { sourceTasks, deadlines, ...value } = clone(snapshot);
  value.resources = value.resources.map(
    ({ url, preview, temporary, ...r }) => r,
  );
  value.tasks = value.tasks.map(({ sourceUnavailable, ...t }) =>
    t.origin === "source"
      ? { ...t, title: "关联来源事项", dueAt: null, completedAt: null }
      : t,
  );
  return validateBoard(value);
}
export function sourceEdits(before, next) {
  const edits = new Map();
  for (const t of next.tasks.filter((t) => t.origin === "source")) {
    const old = before.tasks.find((p) => p.id === t.id);
    if (!old) continue;
    const patch = {};
    for (const k of ["title", "dueAt", "completedAt"])
      if (t[k] !== old[k]) patch[k] = t[k];
    if (Object.keys(patch).length) {
      const prior = edits.get(t.sourceId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(patch))
        fail("同一来源有不一致的修改，请重试");
      edits.set(t.sourceId, patch);
    }
  }
  return [...edits].map(([sourceId, patch]) => ({ sourceId, patch }));
}
export function applySourceEdits(
  packets,
  edits,
  tokens,
  now = new Date().toISOString(),
) {
  const rows = sourceRows(packets),
    changes = new Map();
  if (!Array.isArray(edits) || edits.length > 2000) fail("来源修改无效");
  for (const { sourceId, patch } of edits) {
    const row = rows.find((r) => r.id === sourceId);
    if (!row || row.packet.syncConflict)
      fail("来源已删除、移动或存在同步冲突，请刷新后再编辑");
    if (tokens[sourceId] !== row.token)
      fail("来源已有新修改，请重新读取后再编辑；输入仍保留");
    if (
      !patch ||
      Object.keys(patch).some(
        (k) => !["title", "dueAt", "completedAt"].includes(k),
      ) ||
      ("title" in patch && !text(patch.title, 500)) ||
      ("dueAt" in patch && !date(patch.dueAt)) ||
      ("completedAt" in patch && !date(patch.completedAt))
    )
      fail("来源修改无效");
    let p = changes.get(row.packet.id) || clone(row.packet);
    let item = p.result.items[row.index],
      meta = { ...p.itemState?.[row.itemId] };
    const history = [...(meta.history || [])];
    if ("title" in patch) {
      history.push({
        at: now,
        field: "title",
        before: item.title,
        after: patch.title,
        source: "看板人工编辑",
      });
      item = { ...item, title: patch.title };
    }
    if ("dueAt" in patch) {
      const d = patch.dueAt
        ? new Date(new Date(patch.dueAt).getTime() + 8 * 3600000).toISOString()
        : null;
      const due = d
        ? {
            date: d.slice(0, 10),
            time: d.slice(11, 16),
            anchor: "看板人工确认",
            sourceId: "manual",
          }
        : null;
      history.push({
        at: now,
        field: "due",
        before: JSON.stringify(item.due),
        after: JSON.stringify(due),
        source: "看板人工编辑",
      });
      item = setDeadline(item, due, p.captureDate);
      meta.corrected = true;
    }
    if ("completedAt" in patch) {
      meta.status = patch.completedAt ? "done" : "active";
      meta.completedAt = patch.completedAt || "";
      p.doneIds = p.doneIds.filter((i) => i !== row.index);
      if (patch.completedAt) p.doneIds.push(row.index);
    }
    p.result.items[row.index] = item;
    p.itemState = { ...p.itemState, [row.itemId]: { ...meta, history } };
    p.updatedAt = now;
    changes.set(p.id, p);
  }
  return [...changes.values()];
}
export function boardPacket(
  board,
  previous,
  stamp,
  now = new Date().toISOString(),
) {
  return {
    ...(previous || {
      id: BOARD_ID,
      text: "",
      sources: [],
      attachments: [],
      capturedAt: now,
      captureDate: now.slice(0, 10),
      status: "ready",
      result: { summary: "", items: [], warnings: [] },
      doneIds: [],
      error: "",
    }),
    recordType: "board-workspace",
    board: storedBoard(board),
    boardStamp: stamp,
    updatedAt: now,
  };
}
