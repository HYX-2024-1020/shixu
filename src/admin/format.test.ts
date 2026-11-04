import { describe, expect, it } from "vitest";
import { formatBeijingTime, formatMicroYuan, formatWaitSeconds } from "./format";

describe("formatMicroYuan", () => {
  it("将整数微元换算为人民币", () => {
    expect(formatMicroYuan(1_234_500)).toBe("¥1.23");
    expect(formatMicroYuan(0)).toBe("¥0.00");
    expect(formatMicroYuan(57_420_000)).toBe("¥57.42");
  });
});

describe("formatBeijingTime", () => {
  it("按 Asia/Shanghai 输出并标注无效输入", () => {
    expect(formatBeijingTime("2026-11-04T07:47:00.000Z")).toBe("2026-11-04 15:47");
    expect(formatBeijingTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatWaitSeconds", () => {
  it("按量级输出等待时长", () => {
    expect(formatWaitSeconds(45)).toBe("45 秒");
    expect(formatWaitSeconds(640)).toBe("10 分 40 秒");
    expect(formatWaitSeconds(3600)).toBe("1 小时");
  });
});
