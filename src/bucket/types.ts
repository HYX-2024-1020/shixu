import type { Source, BucketResult } from "../../shared/bucket-engine.mjs";
export type {
  Source,
  BucketResult,
  BucketItem,
  BucketKind,
} from "../../shared/bucket-engine.mjs";
export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  blob?: Blob;
}
export interface Packet {
  id: string;
  text: string;
  sources: Source[];
  attachments: Attachment[];
  capturedAt: string;
  captureDate: string;
  status: "pending" | "processing" | "ready" | "error";
  result: BucketResult | null;
  error: string;
  doneIds: number[];
  updatedAt: string;
  remote?: boolean;
  remoteDirty?: boolean;
  deletedAt?: string;
}
export interface BucketConfig {
  model: string;
  serviceUrl: string;
  rememberKey: boolean;
}
