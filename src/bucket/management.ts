export function habitCheckin(meta: { checkins?: string[] }, day: string) {
  const days = new Set(meta.checkins || []);
  if (days.has(day)) days.delete(day);
  else days.add(day);
  return { status: "active" as const, completedAt: "", checkins: [...days] };
}

export interface RankedItem {
  id: string;
  date?: string;
  importance: number;
  pinned: boolean;
  createdAt: string;
  order: number;
}
export function compareItems(
  a: RankedItem,
  b: RankedItem,
  sort: string,
  day: string,
) {
  if (sort === "custom") return a.order - b.order || a.id.localeCompare(b.id);
  if (sort === "created")
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  if (sort === "importance")
    return b.importance - a.importance || a.id.localeCompare(b.id);
  if (sort === "priority") {
    if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
    const urgent = (item: RankedItem) =>
      !!item.date && Date.parse(item.date) - Date.parse(day) <= 7 * 86400000;
    if (urgent(a) !== urgent(b)) return Number(urgent(b)) - Number(urgent(a));
    if (!urgent(a) && a.importance !== b.importance)
      return b.importance - a.importance;
  }
  return (
    (a.date || "9999").localeCompare(b.date || "9999") ||
    b.importance - a.importance ||
    a.id.localeCompare(b.id)
  );
}
