import type { Source, BucketResult } from "../../shared/bucket-engine.mjs";
import type { Association } from "../../shared/relations.mjs";
export type {
  Source,
  BucketResult,
  BucketItem,
  BucketKind,
} from "../../shared/bucket-engine.mjs";
export interface Attachment {
  hash?: string;
  deletedAt?: string;
  restoredAt?: string;
  id: string;
  name: string;
  size: number;
  type: string;
  blob?: Blob;
}
export interface Packet {
  syncVersion?: number;
  syncAutoOrganize?: boolean;
  receipt?: {
    created: number;
    updated: number;
    merged: number;
    lastAction?: string;
  };
  proposedItems?: import("../../shared/bucket-engine.mjs").BucketItem[];
  retryUnread?: boolean;
  organizedSourceIds?: string[];
  coverage?: import("./ingest").Coverage[];
  readingCoverage?: import("../../shared/reading-view.mjs").ReadingCoverage[];
  itemIds?: string[];
  itemState?: Record<string, ItemState>;
  id: string;
  text: string;
  sources: Source[];
  attachments: Attachment[];
  capturedAt: string;
  captureDate: string;
  captureTimezone?: string;
  status: "pending" | "processing" | "ready" | "error";
  result: BucketResult | null;
  error: string;
  doneIds: number[];
  updatedAt: string;
  remote?: boolean;
  remoteDirty?: boolean;
  deletedAt?: string;
  association?: Association;
}
export interface ItemState {
  chat?: { id: string; role: "user" | "assistant"; text: string; at: string }[];
  additions?: { id: string; text: string; at: string }[];
  history?: {
    at: string;
    field: string;
    before: string;
    after: string;
    source: string;
  }[];
  origin?: string;
  purgedAt?: string;
  status?: "active" | "progress" | "done";
  completedAt?: string;
  deletedAt?: string;
  starred?: boolean;
  pinned?: boolean;
  importance?: number;
  group?: string;
  order?: number;
  checkins?: string[];
  corrected?: boolean;
}
export interface BucketConfig {
  model: string;
  serviceUrl: string;
  rememberKey: boolean;
}
