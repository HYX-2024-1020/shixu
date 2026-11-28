import type { Source, BucketResult } from "../../../../packages/shared/bucket-engine.mjs";
import type { Association } from "../../../../packages/shared/relations.mjs";
export type {
  Source,
  BucketResult,
  BucketItem,
  BucketKind,
} from "../../../../packages/shared/bucket-engine.mjs";
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
  localVersion?:number|string;
  recordType?: 'board-workspace';
  defaultCardDisposition?: { choice: "kept" | "deleted"; at: string };
  worldLayout?: {
    groups: { id: string; name: string }[];
    hiddenKinds: string[];
  };
  syncVersion?: number;
  syncConflict?: boolean;
  syncAutoOrganize?: boolean;
  receipt?: {
    created: number;
    updated: number;
    merged: number;
    lastAction?: string;
  };
  proposedItems?: import("../../../../packages/shared/bucket-engine.mjs").BucketItem[];
  retryUnread?: boolean;
  organizedSourceIds?: string[];
  coverage?: import("./ingest").Coverage[];
  readingCoverage?: import("../../../../packages/shared/reading-view.mjs").ReadingCoverage[];
  processingCoverage?: import("../../../../packages/shared/reading-view.mjs").ProcessingCoverage;
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
  chatCreations?: {
    mode: "create" | "split";
    packetId: string;
    itemId: string;
    patches: Record<string, unknown>[];
    beforeItem: import("../../../../packages/shared/bucket-engine.mjs").BucketItem;
    beforeState: Record<string, unknown>;
    id: string;
  } | null;
  chatMerge?: {
    title: string;
    targets: {
      packetId: string;
      itemId: string;
      title: string;
      beforeItem: import("../../../../packages/shared/bucket-engine.mjs").BucketItem;
    }[];
  } | null;
  mergedInto?: { packetId: string; itemId: string } | null;
  deletedByMerge?: string | null;
  mergedCard?: {
    sources: { packetId: string; itemId: string; title: string }[];
    initialItem: import("../../../../packages/shared/bucket-engine.mjs").BucketItem;
    initialState: string;
  } | null;
  defaultDecision?: "pending" | "kept" | "deleted";
  groupIds?: string[];
  groupOrder?: Record<string, number>;
  chatProposals?: {
    id: string;
    items: {
      packetId: string;
      itemId: string;
      title: string;
      baseVersion: number;
      patch: Record<string, unknown>;
      beforeItem: import("../../../../packages/shared/bucket-engine.mjs").BucketItem;
      beforeState: Record<string, unknown>;
    }[];
  } | null;
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
