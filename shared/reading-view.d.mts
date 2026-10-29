export interface ReadingRange {
  sourceId?: string;
  kind?: string;
  start?: number;
  end?: number;
  row?: number;
  rowEnd?: number;
  code?: string;
}
export interface ReadingCoverage {
  attachmentId: string;
  name: string;
  state: string;
  covered: ReadingRange[];
  uncovered: ReadingRange[];
  reasons: string[];
}
export function readingView(coverage?: ReadingCoverage[]): {
  id: string;
  name: string;
  state: string;
  label: string;
  covered: string;
  missing: string;
  reason: string;
}[];
export function sourceLocation(
  coverage: ReadingCoverage[] | undefined,
  sourceId: string,
): string;
export interface ProcessingCoverage {
  partial: boolean;
  processed: ReadingRange[];
  pending: ReadingRange[];
  unread?: ReadingRange[];
}
export function processingView(processing?: ProcessingCoverage): string;
export function reuseView(count?: number): string;
export function pdfProgressView(summary?: {name?:string;pdfPages?:{checked:number;total:number}}[]): string;
export function walletView(wallet?: {
  spent?: number;
  available?: number;
  lowBalance?: boolean;
  pausedReason?: string;
}): string;
