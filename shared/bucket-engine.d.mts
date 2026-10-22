export type BucketKind = "task" | "idea" | "habit" | "note";
export interface Source {
  id: string;
  name: string;
  text: string;
}
export interface BucketItem {
  kind: BucketKind;
  title: string;
  summary: string;
  facts: string[];
  nextSteps: string[];
  uncertainties: string[];
  evidence: { sourceId: string; quote: string }[];
  sourceIds: string[];
  due: null | { date: string; time: string; anchor: string; sourceId: string };
}
export interface BucketResult {
  summary: string;
  items: BucketItem[];
  warnings: string[];
}
export const DEEPSEEK_ORIGIN: string;
export const DEFAULT_MODEL: string;
export function checkSources(sources: Source[]): void;
export function groundedDate(anchor: string, today: string): string;
export function groundedTime(text: string): string;
export function validateResult(
  value: unknown,
  sources: Source[],
  today: string,
): BucketResult;
export function buildMessages(
  sources: Source[],
  captureDate: string,
  context?: string,
): { role: string; content: string }[];
export function splitSources(sources: Source[], limit?: number): Source[][];
export function organizePacket(
  sources: Source[],
  options: {
    apiKey: string;
    model?: string;
    captureDate: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  },
): Promise<BucketResult>;
