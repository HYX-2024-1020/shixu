import type { BucketItem, Source } from "./bucket-engine.mjs";
export function absoluteText(text: string, day: string): string;
export function absoluteItem<T extends BucketItem>(
  item: T,
  day: string,
  sources?: Source[],
  chat?: { role: string; text: string }[],
): T;
export function parseDeadline(
  text: string,
  day: string,
  time?: string,
): NonNullable<BucketItem["due"]>;
export function setDeadline<T extends BucketItem>(
  item: T,
  due: BucketItem["due"],
  captureDay: string,
): T;
export interface DeadlineRow {
  id: string;
  date: string;
  time: string;
  kind: string;
  done: boolean;
  deleted?: unknown;
  meta?: { purgedAt?: string };
}
export function deadlineSections<T extends DeadlineRow>(
  rows: T[],
  day: string,
  nowTime: string,
  days?: number,
): Record<"overdue" | "today" | "soon" | "later" | "unsure" | "done", T[]>;
