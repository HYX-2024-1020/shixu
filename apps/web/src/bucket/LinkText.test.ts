import { expect, it } from "vitest";
import { textLinks, safeWebUrl } from "./LinkText";
it("links plain and Markdown web addresses from extracted text while retaining punctuation", () => {
  const parts = textLinks(
    "提交 https://example.com/form?id=3，参考 [要求](https://example.org/help)。或 www.example.net.",
  );
  expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual([
    "https://example.com/form?id=3",
    "https://example.org/help",
    "https://www.example.net/",
  ]);
  expect(parts.map((p) => p.text).join("")).toContain("www.example.net.");
});
it("does not turn executable or local URLs into links", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/test",
    "data:text/html,test",
    "https://name:secret@example.com",
  ])
    expect(safeWebUrl(url)).toBe("");
  expect(
    textLinks("javascript:alert(1) file:///test").some((p) => p.href),
  ).toBe(false);
});
