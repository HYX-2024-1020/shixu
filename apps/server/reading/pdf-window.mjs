export const PDF_WINDOW_PAGES = 8;
export function validatePdfWindow(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "offset,page" ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    value.page > 2147483647 ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    value.offset > Number.MAX_SAFE_INTEGER - 8 * 1024 * 1024
  )
    throw Error("INVALID_PDF_WINDOW");
  return { page: value.page, offset: value.offset };
}
