import type { BoardSnapshot } from "../src/board/types/board";
import type { Packet } from "../src/bucket/types";
export const BOARD_ID: string;
export function isBoardRecord(p: unknown): boolean;
export function emptyBoard(): BoardSnapshot;
export function validateBoard(s: any): any;
export function storedBoard(s: BoardSnapshot): any;
export function boardView(
  record: any,
  packets: any[],
): {
  snapshot: BoardSnapshot;
  stamp: string;
  sourceTokens: Record<string, string>;
  syncConflict: boolean;
};
export function sourceRows(packets: Packet[]): any[];
export function sourceEdits(before: BoardSnapshot, next: BoardSnapshot): any[];
export function applySourceEdits(
  packets: any[],
  edits: any[],
  tokens: Record<string, string>,
  now?: string,
): any[];
export function boardPacket(
  board: any,
  previous: any,
  stamp: string,
  now?: string,
): any;
