export type Kind = "task" | "notice" | "project" | "idea" | "habit";
export type Priority = "high" | "normal" | "low";
export interface Entry {
  id: string;
  title: string;
  content: string;
  kind: Kind;
  priority: Priority;
  due: string;
  time: string;
  dateHint: string;
  confirmedDate: boolean;
  tags: string[];
  project: string;
  status: "inbox" | "active" | "done" | "archived";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  deletedAt?: string;
  checkins: string[];
}
export interface Draft
  extends Omit<
    Entry,
    "id" | "createdAt" | "updatedAt" | "status" | "checkins"
  > {}
export interface Preferences {
  name: string;
  dailyGoal: number;
  theme: "light" | "dark" | "system";
  aiEndpoint: string;
  aiModel: string;
}
export interface Snapshot {
  version: 1;
  exportedAt: string;
  entries: Entry[];
  preferences: Preferences;
}
export const KIND_LABEL: Record<Kind, string> = {
  task: "待办",
  notice: "通知",
  project: "项目",
  idea: "灵感",
  habit: "习惯",
};
export const DEFAULT_PREFS: Preferences = {
  name: "同学",
  dailyGoal: 3,
  theme: "light",
  aiEndpoint: "",
  aiModel: "",
};
