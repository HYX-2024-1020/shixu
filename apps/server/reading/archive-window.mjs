// Numeric, server-owned cursors; exact package paths never cross the broker.
export const FIRST_ARCHIVE_WINDOW = Object.freeze({
  entry: 0,
  page: 1,
  offset: 0,
  base: 0,
  expanded: 0,
});
export function validateArchiveWindow(value) {
  if (value === undefined) return undefined;
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw Error("INVALID_ARCHIVE_WINDOW");
  const keys = ["base", "entry", "expanded", "offset", "page"];
  if (value.visual !== undefined) keys.push("visual");
  if (value.office !== undefined) keys.push("office", "image", "text");
  if (value.visual !== undefined || value.office !== undefined)
    keys.push("tile");
  if (
    Object.keys(value).sort().join() !== keys.sort().join() ||
    Object.values(value).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    (value.visual !== undefined && value.visual !== 1) ||
    (value.office !== undefined &&
      (value.office !== 1 ||
        value.image >= 1000 ||
        ![0, 1].includes(value.text) ||
        (value.text && value.image !== 0))) ||
    ((value.visual || value.office) && (value.tile < 1 || value.tile > 64)) ||
    value.entry >= 1000 ||
    value.page < 1 ||
    value.page > 2147483647 ||
    value.base > value.offset ||
    value.offset > Number.MAX_SAFE_INTEGER - 8 * 1024 * 1024 ||
    value.expanded > 64 * 1024 * 1024 ||
    (!value.office &&
      value.page === 1 &&
      (value.tile || 1) === 1 &&
      value.base !== value.offset) ||
    (!value.office &&
      value.entry === 0 &&
      value.page === 1 &&
      (value.tile || 1) === 1 &&
      (value.offset !== 0 || value.expanded !== 0))
  )
    throw Error("INVALID_ARCHIVE_WINDOW");
  return {
    entry: value.entry,
    page: value.page,
    offset: value.offset,
    base: value.base,
    expanded: value.expanded,
    ...(value.visual || value.office ? { tile: value.tile } : {}),
    ...(value.visual ? { visual: 1 } : {}),
    ...(value.office
      ? { office: 1, image: value.image, text: value.text }
      : {}),
  };
}
