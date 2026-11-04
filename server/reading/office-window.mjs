export const FIRST_OFFICE_WINDOW = Object.freeze({
  text: 1,
  image: 0,
  tile: 1,
  offset: 0,
});
export function validateOfficeWindow(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "image,offset,text,tile" ||
    !Object.values(value).every((n) => Number.isSafeInteger(n) && n >= 0) ||
    ![0, 1].includes(value.text) ||
    value.image >= 1000 ||
    value.tile < 1 ||
    value.tile > 64 ||
    value.offset > Number.MAX_SAFE_INTEGER - 120000 ||
    (value.text && (value.image !== 0 || value.tile !== 1))
  )
    throw Error("INVALID_OFFICE_WINDOW");
  return {
    text: value.text,
    image: value.image,
    tile: value.tile,
    offset: value.offset,
  };
}
