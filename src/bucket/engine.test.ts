import { describe, expect, it, vi } from "vitest";
import {
  groundedDate,
  groundedTime,
  organizePacket,
  splitSources,
  validateResult,
  type Source,
} from "../../shared/bucket-engine.mjs";
const today = "2026-10-22";
const sources: Source[] = [
  {
    id: "input",
    name: "随手输入",
    text: "明天下午三点前交报告，详细要求在附件里。",
  },
  {
    id: "file-1",
    name: "课程要求.txt",
    text: "提交 PDF 报告与访谈记录，不少于 2000 字。",
  },
];
function result() {
  return {
    summary: "一份要完成的课程报告。",
    items: [
      {
        kind: "task",
        title: "提交课程报告",
        summary: "结合通知和附件准备报告。",
        facts: ["报告不少于2000字"],
        nextSteps: [],
        uncertainties: [],
        due: {
          date: "2026-10-23",
          time: "15:00",
          anchor: "明天下午三点前",
          sourceId: "input",
        },
        evidence: [
          { sourceId: "input", quote: "明天下午三点前交报告" },
          {
            sourceId: "file-1",
            quote: "提交 PDF 报告与访谈记录，不少于 2000 字。",
          },
        ],
      },
    ],
    warnings: [],
  };
}
function response(value: unknown, reason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [
        { finish_reason: reason, message: { content: JSON.stringify(value) } },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
describe("the bucket understands one complete packet", () => {
  it("keeps the notice and attachment together, with grounded date and file attribution", async () => {
    const requests: any[] = [];
    const fetcher = vi.fn(async (_url: any, init: any) => {
      requests.push(JSON.parse(init.body));
      return response(result());
    }) as unknown as typeof fetch;
    const out = await organizePacket(sources, {
      apiKey: "test-key-not-real",
      captureDate: today,
      fetcher,
    });
    expect(out.items[0].sourceIds).toEqual(["input", "file-1"]);
    expect(out.items[0].due).toMatchObject({
      date: "2026-10-23",
      time: "15:00",
    });
    expect(JSON.parse(requests[0].messages[1].content).sources).toEqual(
      sources,
    );
    expect(requests[0].messages[1].content).not.toContain("test-key-not-real");
  });
  it("rejects invented quotes and allows one repair, rather than saving a fabricated result", async () => {
    const wrong = result();
    wrong.items[0].evidence[1].quote = "根本不存在的提交要求";
    let calls = 0;
    const fetcher = vi.fn(async () =>
      response(calls++ === 0 ? wrong : result()),
    ) as unknown as typeof fetch;
    const out = await organizePacket(sources, {
      apiKey: "fixture",
      captureDate: today,
      fetcher,
    });
    expect(calls).toBe(2);
    expect(out.items[0].evidence[1].quote).toContain("PDF");
  });
  it("fails closed when a second response still invents evidence", async () => {
    const wrong = result();
    wrong.items[0].evidence[0].quote = "老师根本没有说的话";
    await expect(
      organizePacket(sources, {
        apiKey: "fixture",
        captureDate: today,
        fetcher: vi.fn(async () => response(wrong)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("引用不在原文");
  });
  it("does not guess vague dates or accept impossible calendar dates", () => {
    const input = [{ id: "input", name: "随手输入", text: "月底前交报告" }],
      value = result();
    value.items[0].evidence = [{ sourceId: "input", quote: "月底前交报告" }];
    value.items[0].due = {
      date: "2026-10-31",
      time: "",
      anchor: "月底前",
      sourceId: "input",
    };
    const out = validateResult(value, input, today);
    expect(out.items[0].due).toBeNull();
    expect(out.items[0].uncertainties[0]).toContain("月底前");
    expect(groundedDate("2026年2月30日", today)).toBe("");
    expect(groundedDate("2026 年 10 月 30 日", today)).toBe("2026-10-30");
  });
  it("parses Chinese clock times and weekdays deterministically", () => {
    expect(groundedTime("明天下午三点半前")).toBe("15:30");
    expect(groundedTime("下周三 23:59 前")).toBe("23:59");
    expect(groundedTime("明天三点前")).toBe("");
    expect(groundedDate("下周三", today)).toBe("2026-10-28");
    expect(groundedDate("2026年10月22日至10月30日", today)).toBe("");
  });
  it("does not silently truncate long files and does not duplicate a source id within a chunk", () => {
    const text = "甲".repeat(40000) + "\n最后一段也必须保留";
    const packs = splitSources([{ id: "long", name: "long.txt", text }]);
    expect(
      packs
        .flat()
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
    for (const pack of packs)
      expect(new Set(pack.map((s) => s.id)).size).toBe(pack.length);
  });
  it("does not save truncated model output or call an API when no key exists", async () => {
    await expect(
      organizePacket(sources, {
        apiKey: "fixture",
        captureDate: today,
        fetcher: vi.fn(async () =>
          response(result(), "length"),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("截断");
    const fn = vi.fn();
    await expect(
      organizePacket(sources, {
        apiKey: "",
        captureDate: today,
        fetcher: fn as unknown as typeof fetch,
      }),
    ).rejects.toThrow("连接");
    expect(fn).not.toHaveBeenCalled();
  });
  it("reports upstream failure without exposing response bodies or credentials", async () => {
    await expect(
      organizePacket(sources, {
        apiKey: "fixture",
        captureDate: today,
        fetcher: vi.fn(
          async () =>
            new Response("do not show upstream internals", { status: 402 }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("余额不足");
  });
});
