import type { BucketItem, Source } from "./bucket-engine.mjs";
export function validTime(time: unknown): boolean;
export function groundedTime(text: string): string;
export function resolveDeadlineTime(
  due: NonNullable<BucketItem["due"]>,
  evidence?: BucketItem["evidence"],
  sources?: Source[],
): NonNullable<BucketItem["due"]>;

export function itemDeadlineTime(
  item: BucketItem,
  sources?: Source[],
  chat?: { role: string; text: string }[],
): NonNullable<BucketItem["due"]>;
