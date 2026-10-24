/** Replace only visible slots, so a filtered drag never moves hidden cards. */
export function mergeCardOrder(
  all: string[],
  visible: string[],
  reordered: string[],
) {
  const slots = new Set(visible);
  const known = new Set(all);
  const valid =
    known.size === all.length &&
    visible.every((id) => known.has(id)) &&
    visible.length === reordered.length &&
    new Set(reordered).size === visible.length &&
    reordered.every((id) => slots.has(id));
  if (!valid) throw new Error("卡片顺序已改变，请重新拖动");
  let index = 0;
  return all.map((id) => (slots.has(id) ? reordered[index++] : id));
}
