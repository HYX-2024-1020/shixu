import type {
  AdminApiErrorBody,
  AdminSession,
  AdminUserDetail,
  AdminUserStatus,
  Overview,
  PasswordResetResult,
  TaskAction,
  TaskListQuery,
  TaskListResult,
  TopupResult,
  UserListQuery,
  UserListResult,
} from "./types";

/** 统一接口错误。code 语义对齐 contracts.md 的错误码表。 */
export class AdminApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  /** 安全文案（对齐接口错误体的 error 字段） */
  readonly error: string;

  constructor(body: AdminApiErrorBody, httpStatus: number | null = null) {
    super(body.error);
    this.name = "AdminApiError";
    this.error = body.error;
    this.code = body.code;
    this.retryable = body.retryable;
    this.httpStatus = httpStatus;
  }

  static timeout(): AdminApiError {
    return new AdminApiError(
      { error: "请求超时，请稍后重试", code: "TIMEOUT", retryable: true },
      null,
    );
  }

  static network(): AdminApiError {
    return new AdminApiError(
      { error: "无法连接管理服务，请检查 SSH 隧道或服务状态", code: "NETWORK", retryable: true },
      null,
    );
  }

  static sessionExpired(): AdminApiError {
    return new AdminApiError(
      { error: "会话已过期，请重新登录", code: "SESSION_EXPIRED", retryable: false },
      401,
    );
  }
}

/**
 * 管理台数据适配层接口。
 *
 * 后端路由尚未实现（方案 §9 / contracts.md 规划为回环监听的 /admin/v1）。
 * 每个方法对应的拟定路由见 docs/e-admin-ui/api-contract-draft.md；
 * 语义不确定处在该文档中标记「待后端确认」。
 *
 * 写操作约定：
 * - operationId 由调用方在打开确认对话框时生成一次，重试复用，服务端幂等。
 * - 返回结果以后端为准；前端不做本地乐观推算金额。
 */
export interface AdminApi {
  /** 数据来源标识，用于界面标明演示状态 */
  readonly source: "synthetic" | "http";

  /** POST /admin/v1/login → 独立管理员会话（HttpOnly Cookie） */
  login(username: string, password: string): Promise<AdminSession>;
  /** POST /admin/v1/logout */
  logout(): Promise<void>;
  /** GET /admin/v1/session；未登录或已过期返回 null */
  getSession(): Promise<AdminSession | null>;

  /** GET /admin/v1/overview（服务/资源/队列/费用/备份聚合） */
  getOverview(): Promise<Overview>;

  /** GET /admin/v1/users */
  listUsers(query: UserListQuery): Promise<UserListResult>;
  /** GET /admin/v1/users/:id */
  getUserDetail(id: string): Promise<AdminUserDetail>;
  /**
   * POST /admin/v1/users/:id/topup { amountMicro, note, operationId }
   * 追加平台额度：不清零已消费，与供应商账户充值无关。
   */
  topupQuota(userId: string, amountMicro: number, note: string, operationId: string): Promise<TopupResult>;
  /** POST /admin/v1/users/:id/ai-pause | /ai-resume { operationId, reason? } */
  setAiPaused(userId: string, paused: boolean, operationId: string, reason?: string): Promise<AdminUserDetail>;
  /** POST /admin/v1/users/:id/devices/:deviceId/revoke { operationId }（设备撤销协助） */
  revokeDevice(userId: string, deviceId: string, operationId: string): Promise<AdminUserDetail>;
  /** POST /admin/v1/users/:id/password-reset { operationId } */
  resetPassword(userId: string, operationId: string): Promise<PasswordResetResult>;

  /** GET /admin/v1/tasks（本批前端先定义，页面属下一批） */
  listTasks(query: TaskListQuery): Promise<TaskListResult>;
  /** POST /admin/v1/tasks/:id/actions { action, operationId }（retry/pause/stop） */
  runTaskAction(taskId: string, action: TaskAction, operationId: string): Promise<void>;
}

export type { AdminUserStatus };
