/**
 * 拾序管理台（E 阶段）前端类型定义。
 *
 * 约定（与 docs/stage-a/contracts.md 对齐）：
 * - 金额一律使用整数微元（1 元 = 1_000_000 微元），展示层统一换算为 ¥。
 * - 时间一律为 ISO 8601 字符串，展示层统一标注时区（北京时间 UTC+8）。
 * - 所有写操作携带 operationId（幂等键），同一对话框内重试复用同一 operationId。
 * - 管理接口只提供统计、元数据与错误码；不提供用户正文、原件下载或导出。
 */

/** 整数微元 */
export type MicroYuan = number;

export interface AdminSession {
  username: string;
  /** 独立管理服务签发的操作凭据；合成演示模式无需此字段。 */
  csrfToken?: string;
  /** 会话过期时间（ISO） */
  expiresAt: string;
}

export type ServiceStatus = "ok" | "degraded" | "down" | "maintenance";

export interface ServiceHealth {
  id: string;
  name: string;
  status: ServiceStatus;
  /** 状态补充说明，例如降级原因、维护原因 */
  detail: string | null;
  updatedAt: string;
}

export interface ResourceUsage {
  cpuPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  diskUsedGB: number;
  diskTotalGB: number;
  /** 磁盘占用达到该百分比时暂停新上传（方案 §10：80%） */
  diskPauseThresholdPercent: number;
  sampledAt: string;
}

export interface QueueStageStat {
  /** 阶段标识，例如 read / organize / name */
  stage: string;
  /** 阶段展示名 */
  label: string;
  pending: number;
  running: number;
  /** 等待用户处理（已暂停/待确认） */
  waitingUser: number;
  /** 最老排队任务已等待秒数；无排队时为 null */
  oldestPendingSeconds: number | null;
}

export interface CostSummary {
  currency: "CNY";
  todayMicro: MicroYuan;
  monthMicro: MicroYuan;
  /** 站点级月度预算上限 */
  siteBudgetMonthMicro: MicroYuan;
  /** 当前全体预留（未结算） */
  reservedMicro: MicroYuan;
  asOf: string;
}

export interface BackupStatus {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** 当前保留的成功备份份数（方案 §10：最近 2 份） */
  retainedCount: number;
  /** 每份最长保留天数（方案 §10：7 天） */
  retentionDays: number;
  /** 最早一份的到期时间 */
  nextExpireAt: string | null;
  /** 备份失败时的维护原因；非 null 表示已暂停新增上传/AI */
  maintenanceReason: string | null;
  uploadsPaused: boolean;
  aiPaused: boolean;
}

export type AlertSeverity = "critical" | "warning";

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  message: string;
  /** 下一步入口 */
  actionLabel: string;
  actionHref: string;
}

export interface Overview {
  services: ServiceHealth[];
  resources: ResourceUsage;
  queue: QueueStageStat[];
  costs: CostSummary;
  backup: BackupStatus;
  alerts: AlertItem[];
}

export type AdminUserStatus = "active" | "ai-paused" | "disabled";

export interface AdminUser {
  id: string;
  username: string;
  status: AdminUserStatus;
  deviceCount: number;
  /** 累计额度（历史上追加过的总额） */
  grantedMicro: MicroYuan;
  /** 已消费 */
  spentMicro: MicroYuan;
  /** 预留中（在途任务冻结，未结算） */
  reservedMicro: MicroYuan;
  /** 可用余额 = 累计额度 - 已消费 - 预留 */
  availableMicro: MicroYuan;
  aiPausedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDevice {
  id: string;
  name: string;
  platform: "windows" | "wechat" | "other";
  lastActiveAt: string;
}

export interface AdminUserDetail extends AdminUser {
  devices: AdminDevice[];
  /** 与该用户相关的最近管理操作记录（审计，受保护不可删） */
  recentAudit: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  at: string;
  /** 操作者（管理员账号或 system） */
  actor: string;
  action: string;
  detail: string;
  operationId: string;
}

export interface UserListQuery {
  keyword?: string;
  status?: AdminUserStatus | "all";
  page: number;
  pageSize: number;
}

export interface UserListResult {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "paused"
  | "failed"
  | "done"
  | "stopped";

export type TaskAction = "retry" | "pause" | "stop";

export interface AdminTask {
  id: string;
  /** 所属账号 */
  username: string;
  stage: string;
  stageLabel: string;
  /** 0-100 */
  progress: number;
  status: TaskStatus;
  errorCode: string | null;
  /** 该任务已产生费用；无费用为 null */
  costMicro: MicroYuan | null;
  updatedAt: string;
  actions: TaskAction[];
}

export interface TaskListQuery {
  keyword?: string;
  status?: TaskStatus | "all";
  page: number;
  pageSize: number;
}

export interface TaskListResult {
  items: AdminTask[];
  total: number;
  page: number;
  pageSize: number;
}

/** 密码重置结果：不返回明文密码时给出交付方式说明 */
export interface PasswordResetResult {
  method: "temporary-password" | "cli-required";
  temporaryPassword?: string;
  note: string;
}

/** 追加额度结果 */
export interface TopupResult {
  grantedMicro: MicroYuan;
  availableMicro: MicroYuan;
}

/** 接口错误模型（对齐 contracts.md：{ error, code, retryable }） */
export interface AdminApiErrorBody {
  error: string;
  code: string;
  retryable: boolean;
}
