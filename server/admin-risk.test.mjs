import test from "node:test";
import assert from "node:assert/strict";
import { serviceFailureSignals } from "./admin-risk.mjs";
test("isolated content failures stay self-service; persistent multi-account service failures escalate once and recover", () => {
  const seen = new Map();
  assert.deepEqual(
    serviceFailureSignals(
      [{ account: "a", reason: "NO_READABLE_MATERIAL", count: 100 }],
      seen,
      0,
    ),
    [],
  );
  assert.deepEqual(
    serviceFailureSignals(
      [{ account: "a", reason: "READING_TASK_FAILED", count: 10 }],
      seen,
      0,
    ),
    [],
  );
  const many = ["a", "b", "c"].map((account) => ({
    account,
    reason: "READING_TASK_FAILED",
    count: 2,
  }));
  assert.deepEqual(serviceFailureSignals(many, seen, 1000), []);
  assert.deepEqual(serviceFailureSignals(many, seen, 120999), []);
  assert.equal(serviceFailureSignals(many, seen, 121000).length, 1);
  assert.equal(serviceFailureSignals(many, seen, 131000).length, 1);
  assert.deepEqual(serviceFailureSignals([], seen, 141000), []);
  assert.equal(seen.size, 0);
  assert.deepEqual(serviceFailureSignals(many, seen, 142000), []);
});
