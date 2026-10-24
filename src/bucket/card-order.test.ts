import { it, expect } from "vitest";
import { mergeCardOrder } from "./card-order";
it("keeps filtered-out cards in their slots when visible cards move", () => {
  expect(
    mergeCardOrder(
      ["a", "hidden", "b", "other", "c"],
      ["a", "b", "c"],
      ["c", "a", "b"],
    ),
  ).toEqual(["c", "hidden", "a", "other", "b"]);
});
it("rejects a stale or duplicate drag rather than losing a card", () => {
  expect(() => mergeCardOrder(["a", "b"], ["a", "b"], ["b", "b"])).toThrow();
  expect(() =>
    mergeCardOrder(["a", "b"], ["a", "b"], ["a", "unknown"]),
  ).toThrow();
  expect(() => mergeCardOrder(["a", "b"], ["a", "b"], ["a"])).toThrow();
  expect(() => mergeCardOrder(["a"], ["a", "b"], ["b", "a"])).toThrow();
});
