// Numeric, server-owned cursor only. No member path or executable crosses the
// broker interface; every invocation repeats the entire archive preflight.
export const FIRST_ARCHIVE_WINDOW = Object.freeze({
  entry: 0,
  page: 1,
  offset: 0,
  base: 0,
  expanded: 0,
});
export function validateArchiveWindow(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    !["base,entry,expanded,offset,page","base,entry,expanded,offset,page,tile,visual"].includes(Object.keys(value).sort().join(",")) ||
    Object.values(value).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    (value.visual !== undefined && (value.visual!==1 || value.tile<1 || value.tile>64)) ||
    value.entry >= 1000 ||
    value.page < 1 ||
    value.page > 2147483647 ||
    value.base > value.offset ||
    value.offset > Number.MAX_SAFE_INTEGER - 8 * 1024 * 1024 ||
    value.expanded > 64 * 1024 * 1024 ||
    (value.page === 1 && (value.tile||1) === 1 && value.base !== value.offset) ||
    (value.entry === 0 &&
      value.page === 1 && (value.tile||1) === 1 &&
      (value.offset !== 0 || value.expanded !== 0))
  )
    throw Error("INVALID_ARCHIVE_WINDOW");
  return {
    entry: value.entry,
    page: value.page,
    offset: value.offset,
    base: value.base,
    expanded: value.expanded,
    ...(value.visual ? {tile:value.tile,visual:1} : {}),
  };
}
