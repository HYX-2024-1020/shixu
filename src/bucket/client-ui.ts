import type { BucketKind } from "./types";

export const categories: Record<BucketKind, string> = {
  task: "任务",
  event: "日程 / 活动",
  idea: "灵感",
  habit: "习惯",
  notice: "通知",
  note: "资料 / 笔记",
  other: "其他",
};
export const SKIN_INTERACTION = {
  greetingMs: 3200,
  feedingMs: 2800,
  volume: 0.5,
} as const;
