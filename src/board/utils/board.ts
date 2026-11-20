import type { BoardSnapshot, BoardTask, LongPlan } from "../types/board";

export const createId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

export const clone = <T>(value: T): T => structuredClone(value);

export function formatDateTime(value: string | null) {
  if (!value) return "未设置日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期待接入";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

export function toDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDateTimeInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function getTask(taskId: string, tasks: BoardTask[]) {
  return tasks.find((task) => task.id === taskId);
}

export function getParent(parentId: string | undefined, parents: LongPlan[]) {
  return parents.find((parent) => parent.id === parentId);
}

export function deadlineLabel(value: string, now = new Date()) {
  const due = new Date(value);
  const diff = due.getTime() - now.getTime();
  const absolute = Math.abs(diff);
  const days = Math.floor(absolute / 86_400_000);
  const hours = Math.floor((absolute % 86_400_000) / 3_600_000);
  if (diff < 0 && absolute < 3_600_000)
    return `已逾期 ${Math.max(1, Math.floor(absolute / 60_000))} 分钟`;
  if (diff < 0) return `已逾期 ${days ? `${days} 天 ` : ""}${hours} 小时`;
  if (days >= 1) return `还有 ${days} 天 ${hours} 小时`;
  if (hours >= 1) return `还有 ${hours} 小时`;
  return `还有 ${Math.max(0, Math.floor(absolute / 60_000))} 分钟`;
}

export function isOverdue(value: string, now = new Date()) {
  return new Date(value).getTime() < now.getTime();
}

export function removeBoardTask(snapshot: BoardSnapshot, task: BoardTask) {
  if (task.origin === "source") {
    snapshot.tasks = snapshot.tasks.filter((row) => row.id !== task.id);
  } else {
    const row = snapshot.tasks.find((row) => row.id === task.id);
    if (row) row.deletedAt = new Date().toISOString();
  }
}
