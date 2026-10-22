import type {
  BucketItem,
  BucketResult,
  RequestOptions,
  Source,
} from "./bucket-engine.mjs";
export interface RelationLink {
  id: string;
  from: string;
  target: string;
  relation: "same" | "related";
  title: string;
  confidence: number;
  contextRefs?: string[];
}
export interface Association {
  state: "pending" | "ready" | "error";
  links: RelationLink[];
  warnings: string[];
}
export interface RelationPacket {
  id: string;
  status: string;
  capturedAt: string;
  captureDate: string;
  result: BucketResult | null;
  doneIds: number[];
  sources: Source[];
  deletedAt?: string;
  association?: Association;
  updatedAt: string;
}
export interface ItemNode {
  ref: string;
  packet: RelationPacket;
  index: number;
  item: BucketItem;
  done: boolean;
}
export interface ItemGroup {
  id: string;
  refs: string[];
  title: string;
  kind: string;
  latestAt: string;
  packetIds: string[];
  units: {
    refs: string[];
    members: ItemNode[];
    item: BucketItem;
    done: boolean;
  }[];
}
export function itemRef(packetId: string, index: number): string;
export function itemMap(packets: RelationPacket[]): Map<string, ItemNode>;
export function buildGroups(packets: RelationPacket[]): ItemGroup[];
export function relationContext(
  packet: RelationPacket,
  history: RelationPacket[],
): {
  fresh: any[];
  batches: any[][];
  currentMap: Map<string, ItemNode>;
  previous: Map<string, ItemNode>;
  groups: ItemGroup[];
};
export function validateLinks(
  value: unknown,
  context: ReturnType<typeof relationContext>,
  batch: any[],
): RelationLink[];
export function associatePacket(
  packet: RelationPacket,
  history: RelationPacket[],
  options: RequestOptions,
): Promise<Association>;
export function filterLiveLinks(
  links: RelationLink[],
  packets: RelationPacket[],
): RelationLink[];
export function removeGroupLinks<T extends RelationPacket>(
  packets: T[],
  refs: string[],
): T[];
export function removePacketLinks<T extends RelationPacket>(
  packets: T[],
  id: string,
): T[];
