import test from "node:test";
import assert from "node:assert/strict";
import { pdfSumPrecise } from "./pdf-number.mjs";
test("local PDF sum retains cancellation, exact subnormal units, ties-even and overflow without changing Math", () => {
  const original=Math.sumPrecise;
  for(const [values,expected] of [
    [[], -0], [[-0,-0], -0], [[-0,0], 0], [[1,-1],0],
    [[1e16,1,-1e16],1], [[1e308,1e308,-1e308],1e308],
    [[Number.MAX_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE],Number.MAX_VALUE],
    [[Number.MAX_VALUE,Number.MAX_VALUE],Infinity], [[-Number.MAX_VALUE,-Number.MAX_VALUE],-Infinity],
    [[Number.MIN_VALUE,Number.MIN_VALUE,-Number.MIN_VALUE],Number.MIN_VALUE],
    [[1,2**-53],1], [[1,2**-52,2**-53],1+2**-51],
    [[Infinity,-Infinity],NaN], [[NaN,1],NaN], [[-Infinity,1],-Infinity],
  ]) assert.ok(Object.is(pdfSumPrecise(values),expected),String(values));
  assert.throws(()=>pdfSumPrecise([NaN,"1"]),TypeError);
  assert.throws(()=>pdfSumPrecise([Infinity,1n]),TypeError);
  assert.equal(Math.sumPrecise,original);
});
