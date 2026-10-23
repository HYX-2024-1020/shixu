import { describe, it, expect } from "vitest";
import { validateChat } from "./item-chat";
describe("card conversation operations", () => {
  it("supports reclassification and independent grouping without changing source content", () => {
    expect(
      validateChat(
        { reply: "已改为通知", patch: { kind: "notice", group: "人工智能" } },
        "这应该是通知，分到人工智能",
        "2026-10-23",
      ).patch,
    ).toEqual({ kind: "notice", group: "人工智能" });
  });
  it("rejects destructive, foreign-card and invalid model fields as a whole", () => {
    for (const patch of [
      { kind: "notice", delete: true },
      { itemId: "other" },
      { kind: "urgent" },
      { starred: "false" },
    ])
      expect(() =>
        validateChat({ reply: "完成", patch }, "改成通知", "2026-10-23"),
      ).toThrow();
  });
  it("grounds relative dates against the conversation day and ignores invented model dates", () => {
    const result = validateChat(
      {
        reply: "已改时间",
        patch: { due: { anchor: "明天下午三点", date: "2099-01-01" } },
      },
      "改到明天下午三点",
      "2026-10-23",
    );
    expect(result.patch.due).toMatchObject({
      date: "2026-10-24",
      time: "15:00",
    });
    expect(() =>
      validateChat(
        { reply: "已改", patch: { due: { anchor: "2026-10-30" } } },
        "帮我看看",
        "2026-10-23",
      ),
    ).toThrow();
  });
  it("allows answers without editing and explicit clearing of dates and groups", () => {
    expect(
      validateChat(
        { reply: "这份通知说周一停课。", patch: {} },
        "这通知说什么",
        "2026-10-23",
      ).patch,
    ).toEqual({});
    expect(
      validateChat(
        { reply: "已移出分组并清除日期", patch: { due: null, group: "" } },
        "清除日期和分组",
        "2026-10-23",
      ).patch,
    ).toEqual({ due: null, group: "" });
  });
});
