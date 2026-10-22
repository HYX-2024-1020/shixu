import { describe, expect, it } from "vitest";
import {
  classify,
  extractDate,
  localDate,
  organize,
  validDate,
} from "./organize";
import { decryptBackup, encryptBackup, validateBackup } from "./storage";
import { DEFAULT_PREFS, type Entry, type Snapshot } from "./types";
import { checkCloud } from "./cloud";
const now = new Date("2026-10-22T12:00:00");
describe("Chinese capture", () => {
  it("extracts relative date and afternoon time without timezone drift", () => {
    expect(extractDate("明天下午 3 点交作业", now)).toMatchObject({
      due: "2026-10-23",
      time: "15:00",
    });
    expect(localDate(now)).toBe("2026-10-22");
  });
  it("understands next Wednesday and invalid calendar dates", () => {
    expect(extractDate("下周三15:30开会", now)).toMatchObject({
      due: "2026-10-28",
      time: "15:30",
    });
    expect(extractDate("2026年2月30日截止", now).due).toBe("");
    expect(validDate("2028-02-29")).toBe(true);
  });
  it("does not invent a date for an ambiguous deadline", () => {
    expect(extractDate("月底前交作业", now).due).toBe("");
    expect(extractDate("本周末开会", now).dateHint).toContain("手动");
  });
  it("splits large paragraphs into independent entries and keeps tags", () => {
    const result = organize(
      "明天交数学作业 #学习。通知：周五图书馆讲座；每天阅读20分钟\n灵感：旧书地图",
      now,
    );
    expect(result.map((e) => e.kind)).toEqual([
      "task",
      "notice",
      "habit",
      "idea",
    ]);
    expect(result[0].tags).toEqual(["学习"]);
    expect(result[0].confirmedDate).toBe(false);
  });
  it("prioritizes required action inside a notice", () => {
    expect(classify("通知：请提交作业")).toBe("task");
  });
});
const entry: Entry = {
  id: "fixture",
  title: "虚构测试",
  content: "没有个人信息",
  kind: "task",
  priority: "normal",
  due: "",
  time: "",
  dateHint: "",
  confirmedDate: true,
  tags: [],
  project: "",
  status: "active",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  checkins: [],
};
const snapshot: Snapshot = {
  version: 1,
  exportedAt: now.toISOString(),
  entries: [entry],
  preferences: DEFAULT_PREFS,
};
describe("backups and cloud boundary", () => {
  it("round trips encrypted backups and rejects wrong passwords", async () => {
    const encrypted = JSON.parse(
      await encryptBackup(snapshot, "test-password-123"),
    );
    expect(encrypted.data).not.toContain("虚构测试");
    expect(
      (await decryptBackup(encrypted, "test-password-123")).entries,
    ).toEqual([entry]);
    await expect(decryptBackup(encrypted, "wrong-password")).rejects.toThrow(
      "密码",
    );
  });
  it("rejects malformed entries before any writes", () => {
    expect(() =>
      validateBackup({
        ...snapshot,
        entries: [{ ...entry, due: "2026-02-30" }],
      }),
    ).toThrow("日期");
    expect(() =>
      validateBackup({ ...snapshot, entries: [entry, entry] }),
    ).toThrow("重复");
  });
  it("does not import remote endpoint settings from backup", () => {
    expect(
      validateBackup({
        ...snapshot,
        preferences: {
          ...DEFAULT_PREFS,
          aiEndpoint: "https://untrusted.example",
        },
      }).preferences.aiEndpoint,
    ).toBe("");
  });
  it("rejects unsafe backend configuration", () => {
    expect(() =>
      checkCloud({ url: "http://example.test", anonKey: "x" }),
    ).toThrow("HTTPS");
    expect(() =>
      checkCloud({
        url: "https://test.supabase.co",
        anonKey: "sb_secret_FAKE",
      }),
    ).toThrow("secret");
  });
});
