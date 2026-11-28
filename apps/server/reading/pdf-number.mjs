// Local PDF.js compatibility for Node 24; never patch global Math/prototypes.
// Exact binary64 accumulation in units of 2^-1074, rounded once to nearest-even.
// Semantics: https://tc39.es/ecma262/#sec-math.sumprecise
export function pdfSumPrecise(values) {
  const view = new DataView(new ArrayBuffer(8));
  let total = 0n, negativeZero = true, plusInfinity = false, minusInfinity = false, nan = false, count = 0;
  for (const value of values) {
    if (++count > Number.MAX_SAFE_INTEGER) throw RangeError("PDF_SUM_COUNT");
    if (typeof value !== "number") throw TypeError("PDF_SUM_NUMBER");
    if (Number.isNaN(value)) { nan = true; continue; }
    if (value === Infinity) { plusInfinity = true; continue; }
    if (value === -Infinity) { minusInfinity = true; continue; }
    if (value !== 0 || !Object.is(value, -0)) negativeZero = false;
    if (value === 0) continue;
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    const fraction = bits & ((1n << 52n) - 1n);
    const units = (exponent ? (1n << 52n) | fraction : fraction) << BigInt(exponent ? exponent - 1 : 0);
    total += bits >> 63n ? -units : units;
  }
  if (nan || (plusInfinity && minusInfinity)) return NaN;
  if (plusInfinity || minusInfinity) return plusInfinity ? Infinity : -Infinity;
  if (total === 0n) return negativeZero ? -0 : 0;
  const negative = total < 0n;
  if (negative) total = -total;
  const length = total.toString(2).length;
  let result;
  if (length <= 53) result = Number(total) * Number.MIN_VALUE;
  else {
    let shift = length - 53, top = total >> BigInt(shift);
    const rest = total - (top << BigInt(shift)), half = 1n << BigInt(shift - 1);
    if (rest > half || (rest === half && (top & 1n))) top++;
    if (top === (1n << 53n)) { top >>= 1n; shift++; }
    result = Number(top) * 2 ** (shift - 1074);
  }
  return negative ? -result : result;
}
