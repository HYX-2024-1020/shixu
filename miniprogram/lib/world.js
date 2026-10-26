const {
  compareItems,
  absoluteItem,
  itemDeadlineTime,
  deadlineLabel,
  cardCopy,
  buildGroups,
  itemRef,
} = require("./generated/desktop");
const { categories: KINDS } = require("./generated/desktop");
const localDay = () => {
  const d = new Date(),
    pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function itemsFor(records) {
  const packets = records
    .filter((r) => !r.purged && r.data)
    .map((r) => ({ ...r.data, deletedAt: r.deletedAt || undefined }));
  const groups = buildGroups(packets);
  return records.flatMap((record) => {
    if (!record.data || record.purged) return [];
    const p = record.data;
    return (p.result && Array.isArray(p.result.items) ? p.result.items : [])
      .map((rawItem, index) => {
        const id = (p.itemIds || [])[index] || `${p.id}:${index}`;
        const meta = (p.itemState || {})[id] || {};
        const item = absoluteItem(rawItem, p.captureDate, p.sources, meta.chat);
        const copy = cardCopy({
          title: item.title || "",
          summary: item.summary || "",
          facts: item.facts || [],
        });
        const clockInfo = itemDeadlineTime(item, p.sources, meta.chat);
        return {
          clockInfo,
          timeLabel: deadlineLabel(item.due),
          startDate: item.due?.startDate || "",
          startTime: item.due?.startTime || "",
          id,
          packetId: p.id,
          cardFiles: (p.attachments || [])
            .filter((a) => !a.deletedAt)
            .map((a) => ({
              id: a.id,
              name: a.name,
              extension: a.name.includes(".")
                ? a.name.split(".").pop().slice(0, 5).toUpperCase()
                : "FILE",
            })),
          attachmentCount: (p.attachments || []).filter((a) => !a.deletedAt)
            .length,
          index,
          title: copy.title,
          summary: copy.summary,
          item,
          meta,
          kind: item.kind,
          kindLabel: KINDS[item.kind] || KINDS.other,
          done:
            item.kind !== "habit" &&
            (meta.status === "done" || (p.doneIds || []).includes(index)),
          checked: (meta.checkins || []).includes(localDay()),
          checkinCount: new Set(meta.checkins || []).size,
          deleted: !!(record.deletedAt || meta.deletedAt),
          packetDeleted: !!record.deletedAt,
          starred: !!meta.starred,
          pinned: !!meta.pinned,
          progress: meta.status === "progress",
          group:
            meta.group !== undefined
              ? meta.group
              : item.group ||
                (
                  groups.find((g) =>
                    g.refs.includes(
                      itemRef(p.id, (p.itemIds || [])[index] || index),
                    ),
                  ) || {}
                ).title ||
                "",
          date: (item.due || {}).date || "",
          time: clockInfo.time,
          importance:
            meta.importance !== undefined
              ? meta.importance
              : item.importance || 1,
          createdAt: p.capturedAt || "",
          order: meta.order === undefined ? index : meta.order,
          conflict: !!record.conflict,
          search: [
            item.title,
            item.summary,
            ...(item.facts || []),
            p.text,
            ...(p.sources || []).map((s) => s.name + " " + s.text),
            ...(meta.additions || []).map((a) => a.text),
          ]
            .join(" ")
            .toLowerCase(),
        };
      })
      .filter((r) => !r.meta.purgedAt);
  });
}
function worldView(records, options = {}) {
  const day = options.day || localDay(),
    scope = options.scope || "active";
  const all = itemsFor(records);
  const scoped = all.filter((r) =>
    scope === "trash"
      ? r.deleted
      : !r.deleted && (scope === "done" ? r.done : !r.done),
  );
  const categories = [
    { key: "all", label: "全部", count: scoped.length },
    ...Object.entries(KINDS)
      .filter(([key]) => scoped.some((r) => r.kind === key))
      .map(([key, label]) => ({
        key,
        label,
        count: scoped.filter((r) => r.kind === key).length,
      })),
  ];
  const filtered = all.filter(
    (r) =>
      (scope === "trash"
        ? r.deleted
        : !r.deleted && (scope === "done" ? r.done : !r.done)) &&
      (!options.query ||
        r.search.includes(options.query.trim().toLowerCase())) &&
      (!options.kind || options.kind === "all" || options.kind === r.kind) &&
      (!options.starOnly || r.starred) &&
      (!options.group || options.group === r.group) &&
      (!options.packetId || options.packetId === r.packetId) &&
      (!options.dateFilter ||
        options.dateFilter === "all" ||
        (r.date &&
          (options.dateFilter === "today"
            ? r.date === day
            : options.dateFilter === "overdue"
              ? r.date < day
              : r.date >= day &&
                Date.parse(r.date) - Date.parse(day) < 7 * 86400000))),
  );
  filtered.sort((a, b) => compareItems(a, b, options.sort || "priority", day));
  const limit = options.limit || 60;
  return {
    categories,
    items: filtered.slice(0, limit),
    matched: filtered.length,
    total: all.filter((r) => !r.deleted).length,
    active: all.filter((r) => !r.deleted && !r.done).length,
    done: all.filter((r) => !r.deleted && r.done).length,
    groups: [
      ...new Set(all.filter((r) => !r.deleted && r.group).map((r) => r.group)),
    ],
    sections: [
      ...new Set(filtered.slice(0, limit).map((r) => r.group || "未分组")),
    ].map((title) => ({
      title,
      items: filtered
        .slice(0, limit)
        .filter((r) => (r.group || "未分组") === title),
    })),
  };
}
function statePatch(packet, row, changes) {
  const done = new Set(packet.doneIds || []);
  if (changes.status === "done") done.add(row.index);
  else if (changes.status) done.delete(row.index);
  const id = /^[a-zA-Z0-9_-]{1,120}$/.test(row.id)
    ? row.id
    : `${packet.id.slice(0, 90)}_item_${row.index}`;
  const itemIds = (
    packet.itemIds || packet.result.items.map((_, i) => `${packet.id}:${i}`)
  ).slice();
  itemIds[row.index] = id;
  return {
    itemIds,
    itemState: { [id]: { ...row.meta, ...changes } },
    doneIds: [...done],
    updatedAt: new Date().toISOString(),
  };
}
module.exports = { KINDS, localDay, itemsFor, worldView, statePatch };
