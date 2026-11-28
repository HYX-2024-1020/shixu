// Local change to pinned PDF.js (Apache-2.0): use its own Dingbats Unicode
// table for a nonembedded Zapf default encoding; explicit ToUnicode wins.
export function patchPdfFontUnicode(source) {
  const before="    const glyphsUnicodeMap = getGlyphsUnicode();\n    for (const charcode in encoding) {";
  if (source.split(before).length !== 2) throw Error("PDF_FONT_UNICODE_PATCH_REVIEW_REQUIRED");
  return source.replace(before,"    const glyphsUnicodeMap = properties.defaultEncoding === ZapfDingbatsEncoding ? {...getGlyphsUnicode(), ...getDingbatsGlyphsUnicode()} : getGlyphsUnicode();\n    for (const charcode in encoding) {");
}
// With complete encoding, the form path uses font metrics exclusively and
// never consults OffscreenCanvas. Keep the warning for actual encoding gaps;
// those need the unsupported FakeUnicodeFont path and must remain unread.
export function patchPdfFormAppearance(source) {
  const before='      if (!this._isOffscreenCanvasSupported) {\n        warn("_getAppearance: OffscreenCanvas is not supported, annotation may not render correctly.");';
  if(source.split(before).length!==2)throw Error('PDF_FORM_APPEARANCE_PATCH_REVIEW_REQUIRED');
  return source.replace(before,'      if (encodingError && !this._isOffscreenCanvasSupported) {\n        warn("_getAppearance: OffscreenCanvas is not supported, annotation may not render correctly.");');
}
