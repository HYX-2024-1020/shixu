import { describe, expect, it } from "vitest";
import { cardCopy } from "./card-copy";

describe("card overview copy", () => {
  it("leaves demo markers searchable in storage but gives the heading the action", () => {
    const item = {
      title: "[演示] 提交实验报告",
      summary: "根据原文，提交 PDF，附上实验数据。",
      facts: ["提交 PDF", "附上实验数据"],
    };
    expect(cardCopy(item)).toEqual({
      title: "提交实验报告",
      summary: "提交 PDF，附上实验数据。",
    });
    expect(item.title).toBe("[演示] 提交实验报告");
  });
  it("uses an actual requirement rather than repeating the headline", () => {
    expect(
      cardCopy({
        title: "提交实验报告",
        summary: "提交实验报告。",
        facts: ["提交实验报告", "PDF 格式，包含原始数据"],
      }).summary,
    ).toBe("PDF 格式，包含原始数据");
  });
  it("does not invent supporting text when no additional facts exist", () => {
    expect(
      cardCopy({ title: "阅读", summary: "阅读", facts: [] }).summary,
    ).toBe("");
  });
  it("keeps an uncertain date out of the overview without filling it in", () => {
    const item = {
      title: "[演示] 提交实验小结（具体日期待确认）",
      summary: "老师要求下次课提交实验小结；具体日期没有公布。",
      facts: [],
    };
    expect(cardCopy(item)).toEqual({
      title: "提交实验小结",
      summary: "老师要求下次课提交实验小结；",
    });
    expect(item.summary).toContain("具体日期没有公布");
  });
});
