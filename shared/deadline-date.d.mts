import type { BucketItem } from "./bucket-engine.mjs";
export function validDate(value: string): boolean;
export function shiftDate(day: string, days: number): string;
export function normalizeDateText(value: string): string;
export function parseDateExpression(
  text: string,
  today: string,
): NonNullable<BucketItem["due"]> | null;
export function deadlineLabel(due: BucketItem["due"]): string;
