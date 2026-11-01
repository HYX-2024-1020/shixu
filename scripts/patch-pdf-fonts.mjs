// Local change to pinned PDF.js (Apache-2.0): use its own Dingbats Unicode
// table for a nonembedded Zapf default encoding; explicit ToUnicode wins.
export function patchPdfFontUnicode(source) {
  const before="    const glyphsUnicodeMap = getGlyphsUnicode();\n    for (const charcode in encoding) {";
  if (source.split(before).length !== 2) throw Error("PDF_FONT_UNICODE_PATCH_REVIEW_REQUIRED");
  return source.replace(before,"    const glyphsUnicodeMap = properties.defaultEncoding === ZapfDingbatsEncoding ? {...getGlyphsUnicode(), ...getDingbatsGlyphsUnicode()} : getGlyphsUnicode();\n    for (const charcode in encoding) {");
}
