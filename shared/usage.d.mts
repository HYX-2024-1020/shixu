export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  cacheHit: number | null;
  cacheMiss: number | null;
  reasoning: number | null;
}
export interface CostEstimate {
  currency: "CNY";
  priceDate: string;
  min: number;
  max: number;
  cacheKnown: boolean;
}
export interface UsageRecord {
  id: string;
  packetId: string;
  startedAt: string;
  finishedAt?: string;
  requestedModel: string;
  model: string;
  state: "pending" | "reported" | "unreported";
  usage: TokenUsage | null;
  cost: CostEstimate | null;
}
export const PRICE_DATE: string;
export const PRICE_URL: string;
export function rateFor(
  model: string,
): { hit: number; miss: number; output: number } | null;
export function normalizeUsage(raw: unknown): TokenUsage | null;
export function estimateCost(
  usage: TokenUsage | null,
  model: string,
): CostEstimate | null;
export function usageTotals(records: UsageRecord[]): {
  calls: number;
  reported: number;
  unpriced: number;
  prompt: number;
  completion: number;
  min: number;
  max: number;
};
export function money(value: number): string;
