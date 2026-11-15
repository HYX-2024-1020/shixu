export type BoardMode = "strip" | "rail" | "panel" | "ddl";
export type PlanTab = "short" | "long";
export type TaskOrigin = "manual" | "source" | "step";
export type TimePrecision = "explicit" | "inferred";
export type ResourceKind = "image" | "file";
export type MockScenario = "default" | "empty" | "error";

export interface Planning {
  id: string;
  name: string;
}

export interface BoardTask {
  id: string;
  planningId: string;
  origin: TaskOrigin;
  title: string;
  parentId?: string;
  sourceId?: string;
  completedAt: string | null;
  dueAt: string | null;
  timePrecision: TimePrecision;
  archived: boolean;
  sourceUnavailable?: boolean;
  deletedAt?: string;
}

export interface LongPlan {
  deletedAt?: string;
  nextStepId?: string;
  id: string;
  planningId: string;
  title: string;
  stepIds: string[];
  completedAt: string | null;
}

export interface SourceTask {
  id: string;
  title: string;
  sourceLabel: string;
  completedAt?: string | null;
  dueAt?: string | null;
  timePrecision?: TimePrecision;
}

export interface Deadline {
  id: string;
  title: string;
  dueAt: string;
  timePrecision: TimePrecision;
  sourceLabel: string;
  sourceTaskId?: string;
  completedAt?: string | null;
  dueLabel?: string;
}

export interface ResourceItem {
  longPlanId?: string;
  id: string;
  planningId: string;
  name: string;
  kind: ResourceKind;
  fileType: string;
  planLabel: string;
  createdAt: string;
  sizeLabel: string;
  preview?: "math" | "english";
  url?: string;
  temporary?: boolean;
  attachmentId?: string;
  deletedAt?: string;
}

export interface BoardSnapshot {
  version: 1;
  activePlanId: string;
  plans: Planning[];
  tasks: BoardTask[];
  longPlans: LongPlan[];
  sourceTasks: SourceTask[];
  deadlines: Deadline[];
  resources: ResourceItem[];
  drafts?: Record<string, string>;
}

/**
 * 建议的前端接入边界，并非既有后端 API。
 * 日期由接入方解析为 ISO 字符串；视图不访问 IPC、网络或本地存储。
 */
export interface BoardAdapter {
  load(accept?: () => boolean): Promise<BoardSnapshot>;
  save(snapshot: BoardSnapshot): Promise<void>;
  openResource?(resource: ResourceItem): Promise<void>;
  openSource?(sourceId: string): Promise<void>;
  addResources?(files: File[], planningId: string): Promise<BoardSnapshot>;
  flush?(): Promise<void>;
  subscribe?(listener: () => void): () => void;
  statusMessage?(): string;
}

export interface SaveState {
  phase: "idle" | "saving" | "saved" | "error";
  message: string;
}
