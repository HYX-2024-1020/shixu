// Local, scoped Node 24 compatibility for the pinned PDF.js source.
export function patchPdfNodeCompatibility(source, numberModule) {
  source = source.replaceAll("Math.sumPrecise(", "shixuSumPrecise(");
  source = source.replace(
    /([\w.]+)\.toHex\(\)/g,
    "Array.from($1,b=>b.toString(16).padStart(2,'0')).join('')",
  );
  source = source.replace("map?.getOrInsertComputed(", "shixuOptionalMap(map,");
  source = source.replace(
    "(bCache ??= new Map()).getOrInsertComputed(",
    "shixuMap((bCache ??= new Map()),",
  );
  source = source.replace(/([\w.$#]+)\.getOrInsertComputed\(/g, "shixuMap($1,");
  source = source.replace(/([\w.$#]+)\.getOrInsert\(/g, "shixuMapValue($1,");
  if (/getOrInsertComputed|getOrInsert\(/.test(source))
    throw Error("PDF_NODE_COMPAT_REVIEW_REQUIRED");
  return (
    'import {pdfSumPrecise as shixuSumPrecise} from '+JSON.stringify(numberModule)+';\n' +
    "function shixuMap(m,k,f){if(m.has(k))return m.get(k);const v=f(k);m.set(k,v);return v;}\nfunction shixuOptionalMap(m,k,f){return m==null?undefined:shixuMap(m,k,f);}\nfunction shixuMapValue(m,k,v){if(m.has(k))return m.get(k);m.set(k,v);return v;}\n" +
    source
  );
}
