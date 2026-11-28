import { AdminApiError, type AdminApi } from "./client";
import type {
  AdminDevice,
  AdminSession,
  AdminTask,
  AdminUserDetail,
  AuditEntry,
  Overview,
  PasswordResetResult,
  TaskAction,
  TaskListQuery,
  TaskListResult,
  TopupResult,
  UserListQuery,
  UserListResult,
} from "./types";

/**
 * 合成数据适配层（演示用）。
 *
 * - 数据完全为虚构合成材料，不含任何真实用户资料。
 * - 模拟网络延迟、失败、超时与会话过期，供界面状态验收。
 * - 写操作按 operationId 幂等：同一 operationId 重复提交返回首次结果，不重复生效。
 * - 后端 /admin/v1 就绪后，由 http.ts 真实适配层替换，界面无需改动。
 */

export interface SyntheticControls {
  /** 读操作持续失败（取消勾选后恢复，模拟服务异常期间） */
  failReads: boolean;
  /** 下一次写操作抛错 */
  failWrites: boolean;
  /** 所有请求超时（12 秒才失败） */
  timeoutAll: boolean;
  /** 模拟会话已过期 */
  sessionExpired: boolean;
  /** 请求延迟毫秒数 */
  latencyMs: number;
}

const controls: SyntheticControls = {
  failReads: false,
  failWrites: false,
  timeoutAll: false,
  sessionExpired: false,
  latencyMs: 450,
};

export function getSyntheticControls(): SyntheticControls {
  return controls;
}

const HOUR = 3_600_000;
const MIN = 60_000;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const yuan = (n: number) => Math.round(n * 1_000_000);

interface SyntheticState {
  session: AdminSession | null;
  users: AdminUserDetail[];
  tasks: AdminTask[];
  /** operationId → 已生效结果（幂等回放） */
  operations: Map<string, unknown>;
  auditSeq: number;
  backup: Overview["backup"];
}

function seedUsers(): AdminUserDetail[] {
  const names = [
    "chen.li", "wang.fang", "liu.yang", "zhang.wei", "zhao.min", "sun.qian",
    "zhou.jie", "wu.tong", "zheng.hao", "feng.xue", "chu.yun", "wei.lan",
  ];
  return names.map((username, i) => {
    const granted = yuan([50, 30, 80, 20, 45, 60, 15, 35, 25, 40, 55, 30][i]);
    const spent = yuan([12.4, 27.8, 63.1, 3.2, 41.6, 22.9, 14.8, 9.5, 24.3, 38.2, 50.7, 6.1][i]);
    const reserved = yuan([1.2, 0, 4.5, 0, 0.8, 2.1, 0, 0, 0.4, 1.6, 0, 0][i]);
    const paused = i === 5 || i === 10;
    const disabled = i === 11;
    const devices: AdminDevice[] = [
      { id: `dev-${i}-1`, name: "Windows 台式机", platform: "windows", lastActiveAt: iso(-2 * HOUR * (i + 1)) },
      ...(i % 3 === 0
        ? [{ id: `dev-${i}-2`, name: "微信小程序", platform: "wechat" as const, lastActiveAt: iso(-30 * HOUR) }]
        : []),
    ];
    return {
      id: `u-${1000 + i}`,
      username,
      status: disabled ? "disabled" : paused ? "ai-paused" : "active",
      deviceCount: devices.length,
      grantedMicro: granted,
      spentMicro: spent,
      reservedMicro: reserved,
      availableMicro: granted - spent - reserved,
      aiPausedReason: paused ? "余额长期不足，自动暂停" : null,
      createdAt: iso(-80 * 24 * HOUR + i * 3 * 24 * HOUR),
      updatedAt: iso(-i * 5 * HOUR),
      devices,
      recentAudit: [],
    };
  });
}

function seedTasks(): AdminTask[] {
  const stages: Array<[string, string]> = [
    ["read", "读取材料"],
    ["organize", "整理分类"],
    ["name", "AI 命名"],
  ];
  const statuses: AdminTask["status"][] = ["running", "queued", "queued", "failed", "paused", "running", "queued", "done"];
  const owners = ["chen.li", "wang.fang", "liu.yang", "zhao.min", "sun.qian", "zhou.jie", "feng.xue", "chu.yun"];
  return statuses.map((status, i) => {
    const [stage, stageLabel] = stages[i % stages.length];
    const failed = status === "failed";
    return {
      id: `t-${5000 + i}`,
      username: owners[i],
      stage,
      stageLabel,
      progress: status === "done" ? 100 : [62, 0, 0, 45, 30, 88, 0, 100][i],
      status,
      errorCode: failed ? "READING_PARTIAL_FAILED" : null,
      costMicro: status === "queued" ? null : yuan([0.42, 0, 0, 0.18, 0.07, 0.55, 0, 0.31][i]),
      updatedAt: iso(-i * 12 * MIN),
      actions:
        status === "failed"
          ? ["retry", "stop"]
          : status === "running"
            ? ["pause", "stop"]
            : status === "paused"
              ? ["stop"]
              : status === "queued"
                ? ["stop"]
                : [],
    };
  });
}

function seedState(): SyntheticState {
  return {
    session: null,
    users: seedUsers(),
    tasks: seedTasks(),
    operations: new Map(),
    auditSeq: 1,
    backup: {
      lastSuccessAt: iso(-9 * HOUR),
      lastFailureAt: iso(-33 * HOUR),
      retainedCount: 2,
      retentionDays: 7,
      nextExpireAt: iso(6 * 24 * HOUR),
      maintenanceReason: null,
      uploadsPaused: false,
      aiPaused: false,
    },
  };
}

let state = seedState();

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, controls.latencyMs));
}

async function simulate(kind: "read" | "write"): Promise<void> {
  if (controls.timeoutAll) {
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    throw AdminApiError.timeout();
  }
  await delay();
  if (kind === "read" && controls.failReads) {
    throw new AdminApiError({ error: "管理服务暂时不可用（演示模拟失败）", code: "MAINTENANCE", retryable: true }, 503);
  }
  if (kind === "write" && controls.failWrites) {
    controls.failWrites = false;
    throw new AdminApiError({ error: "操作未能提交（演示模拟失败），未产生任何变更", code: "INTERNAL", retryable: true }, 500);
  }
}

function requireSession(): AdminSession {
  if (controls.sessionExpired) {
    throw AdminApiError.sessionExpired();
  }
  if (!state.session) {
    throw new AdminApiError({ error: "未登录", code: "UNAUTHORIZED", retryable: false }, 401);
  }
  if (Date.parse(state.session.expiresAt) < Date.now()) {
    state.session = null;
    throw AdminApiError.sessionExpired();
  }
  return state.session;
}

function pushAudit(user: AdminUserDetail, action: string, detail: string, operationId: string): void {
  const entry: AuditEntry = {
    id: `a-${state.auditSeq++}`,
    at: new Date().toISOString(),
    actor: state.session?.username ?? "admin",
    action,
    detail,
    operationId,
  };
  user.recentAudit = [entry, ...user.recentAudit].slice(0, 10);
}

function replay<T>(operationId: string): T | null {
  return state.operations.has(operationId) ? (state.operations.get(operationId) as T) : null;
}

function record(operationId: string, result: unknown): void {
  state.operations.set(operationId, result);
}

function findUser(userId: string): AdminUserDetail {
  const user = state.users.find((u) => u.id === userId);
  if (!user) {
    throw new AdminApiError({ error: "用户不存在", code: "NOT_FOUND", retryable: false }, 404);
  }
  return user;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildOverview(): Overview {
  const backupFailed = state.backup.maintenanceReason !== null;
  const disk = { used: 71.4, total: 118 };
  const diskPercent = (disk.used / disk.total) * 100;
  const services = [
    { id: "svc-main", name: "主服务", status: "ok" as const, detail: "回环 8787，运行 6 天", updatedAt: iso(-1 * MIN) },
    { id: "svc-sync", name: "同步服务", status: "ok" as const, detail: "v2 接口正常", updatedAt: iso(-1 * MIN) },
    {
      id: "svc-reading",
      name: "读取进程",
      status: "degraded" as const,
      detail: "内存接近限额，已降级为单任务串行",
      updatedAt: iso(-3 * MIN),
    },
    { id: "svc-provider", name: "AI 供应商", status: "ok" as const, detail: "DeepSeek 延迟正常", updatedAt: iso(-2 * MIN) },
    {
      id: "svc-backup",
      name: "备份",
      status: backupFailed ? ("down" as const) : ("ok" as const),
      detail: backupFailed ? state.backup.maintenanceReason : "每日 04:00（北京时间）一致性备份",
      updatedAt: iso(-1 * MIN),
    },
  ];
  const alerts: Overview["alerts"] = [];
  const failedTasks = state.tasks.filter((t) => t.status === "failed").length;
  if (failedTasks > 0) {
    alerts.push({
      id: "alert-failed-tasks",
      severity: "critical",
      message: `${failedTasks} 个任务失败待处理（最近为 READING_PARTIAL_FAILED）`,
      actionLabel: "去任务管理",
      actionHref: "#/tasks",
    });
  }
  if (diskPercent > 55) {
    alerts.push({
      id: "alert-disk",
      severity: diskPercent >= 80 ? "critical" : "warning",
      message: `磁盘占用 ${diskPercent.toFixed(0)}%（达到 80% 将自动暂停新上传）`,
      actionLabel: "查看存储与备份",
      actionHref: "#/storage",
    });
  }
  if (backupFailed) {
    alerts.push({
      id: "alert-backup",
      severity: "critical",
      message: `备份失败：${state.backup.maintenanceReason}`,
      actionLabel: "查看备份",
      actionHref: "#/storage",
    });
  }
  const pausedUsers = state.users.filter((u) => u.status === "ai-paused").length;
  if (pausedUsers > 0) {
    alerts.push({
      id: "alert-paused-users",
      severity: "warning",
      message: `${pausedUsers} 个账号的 AI 处于暂停状态`,
      actionLabel: "去用户管理",
      actionHref: "#/users",
    });
  }
  return {
    services,
    resources: {
      cpuPercent: 34,
      memoryUsedMB: 986,
      memoryTotalMB: 2048,
      diskUsedGB: disk.used,
      diskTotalGB: disk.total,
      diskPauseThresholdPercent: 80,
      sampledAt: iso(-30_000),
    },
    queue: [
      { stage: "read", label: "读取材料", pending: 2, running: 1, waitingUser: 0, oldestPendingSeconds: 640 },
      { stage: "organize", label: "整理分类", pending: 3, running: 1, waitingUser: 1, oldestPendingSeconds: 1730 },
      { stage: "name", label: "AI 命名", pending: 1, running: 0, waitingUser: 0, oldestPendingSeconds: 300 },
    ],
    costs: {
      currency: "CNY",
      todayMicro: yuan(3.86),
      monthMicro: yuan(57.42),
      siteBudgetMonthMicro: yuan(200),
      reservedMicro: yuan(12.6),
      asOf: iso(-45_000),
    },
    backup: state.backup,
    alerts,
  };
}

export function createSyntheticApi(): AdminApi {
  return {
    source: "synthetic",

    async login(username: string, password: string): Promise<AdminSession> {
      await simulate("write");
      if (!username.trim()) {
        throw new AdminApiError({ error: "请输入管理员账号", code: "INVALID_INPUT", retryable: false }, 422);
      }
      if (password !== "admin-demo") {
        throw new AdminApiError({ error: "账号或密码不正确", code: "UNAUTHORIZED", retryable: false }, 401);
      }
      controls.sessionExpired = false;
      state.session = { username, expiresAt: iso(30 * MIN) };
      return state.session;
    },

    async logout(): Promise<void> {
      await simulate("write");
      state.session = null;
    },

    async getSession(): Promise<AdminSession | null> {
      await simulate("read");
      if (controls.sessionExpired) return null;
      if (!state.session) return null;
      if (Date.parse(state.session.expiresAt) < Date.now()) {
        state.session = null;
        return null;
      }
      return state.session;
    },

    async getOverview(): Promise<Overview> {
      requireSession();
      await simulate("read");
      return clone(buildOverview());
    },

    async listUsers(query: UserListQuery): Promise<UserListResult> {
      requireSession();
      await simulate("read");
      const keyword = query.keyword?.trim().toLowerCase();
      let items = state.users;
      if (keyword) items = items.filter((u) => u.username.toLowerCase().includes(keyword));
      if (query.status && query.status !== "all") items = items.filter((u) => u.status === query.status);
      const start = (query.page - 1) * query.pageSize;
      return {
        items: clone(items.slice(start, start + query.pageSize)),
        total: items.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async getUserDetail(id: string): Promise<AdminUserDetail> {
      requireSession();
      await simulate("read");
      return clone(findUser(id));
    },

    async topupQuota(userId, amountMicro, note, operationId): Promise<TopupResult> {
      requireSession();
      await simulate("write");
      const hit = replay<TopupResult>(operationId);
      if (hit) return clone(hit);
      const user = findUser(userId);
      if (!Number.isInteger(amountMicro) || amountMicro <= 0) {
        throw new AdminApiError({ error: "追加金额必须为正数", code: "INVALID_INPUT", retryable: false }, 422);
      }
      user.grantedMicro += amountMicro;
      user.availableMicro += amountMicro;
      user.updatedAt = new Date().toISOString();
      const result: TopupResult = { grantedMicro: user.grantedMicro, availableMicro: user.availableMicro };
      pushAudit(user, "追加额度", `追加 ¥${(amountMicro / 1_000_000).toFixed(2)}（${note || "未填写备注"}），不清除已消费`, operationId);
      record(operationId, result);
      return clone(result);
    },

    async setAiPaused(userId, paused, operationId, reason): Promise<AdminUserDetail> {
      requireSession();
      await simulate("write");
      const hit = replay<AdminUserDetail>(operationId);
      if (hit) return clone(hit);
      const user = findUser(userId);
      if (user.status === "disabled") {
        throw new AdminApiError({ error: "账号已停用，无法调整 AI 状态", code: "CONFLICT", retryable: false }, 409);
      }
      user.status = paused ? "ai-paused" : "active";
      user.aiPausedReason = paused ? reason?.trim() || "管理员手动暂停" : null;
      user.updatedAt = new Date().toISOString();
      pushAudit(user, paused ? "暂停 AI" : "恢复 AI", paused ? `原因：${user.aiPausedReason}` : "恢复正常使用", operationId);
      record(operationId, user);
      return clone(user);
    },

    async revokeDevice(userId, deviceId, operationId): Promise<AdminUserDetail> {
      requireSession();
      await simulate("write");
      const hit = replay<AdminUserDetail>(operationId);
      if (hit) return clone(hit);
      const user = findUser(userId);
      const device = user.devices.find((d) => d.id === deviceId);
      if (!device) {
        throw new AdminApiError({ error: "设备不存在或已被撤销", code: "NOT_FOUND", retryable: false }, 404);
      }
      user.devices = user.devices.filter((d) => d.id !== deviceId);
      user.deviceCount = user.devices.length;
      user.updatedAt = new Date().toISOString();
      pushAudit(user, "撤销设备", `撤销「${device.name}」的登录态，本机资料副本保留`, operationId);
      record(operationId, user);
      return clone(user);
    },

    async resetPassword(userId, operationId): Promise<PasswordResetResult> {
      requireSession();
      await simulate("write");
      const hit = replay<PasswordResetResult>(operationId);
      if (hit) return clone(hit);
      const user = findUser(userId);
      const result: PasswordResetResult = {
        method: "temporary-password",
        temporaryPassword: `sx-${Math.random().toString(36).slice(2, 10)}`,
        note: "临时密码仅本次显示，用户首次登录后需自行修改；旧密码立即失效。",
      };
      pushAudit(user, "重置密码", "签发一次性临时密码，旧密码与全部会话失效", operationId);
      record(operationId, result);
      return clone(result);
    },

    async listTasks(query: TaskListQuery): Promise<TaskListResult> {
      requireSession();
      await simulate("read");
      let items = state.tasks;
      const keyword = query.keyword?.trim().toLowerCase();
      if (keyword) {
        items = items.filter((t) => t.username.toLowerCase().includes(keyword) || t.id.includes(keyword));
      }
      if (query.status && query.status !== "all") items = items.filter((t) => t.status === query.status);
      const start = (query.page - 1) * query.pageSize;
      return { items: clone(items.slice(start, start + query.pageSize)), total: items.length, page: query.page, pageSize: query.pageSize };
    },

    async runTaskAction(taskId: string, action: TaskAction, operationId: string): Promise<void> {
      requireSession();
      await simulate("write");
      if (replay(operationId)) return;
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) {
        throw new AdminApiError({ error: "任务不存在", code: "NOT_FOUND", retryable: false }, 404);
      }
      if (!task.actions.includes(action)) {
        throw new AdminApiError({ error: "当前状态不允许该操作", code: "CONFLICT", retryable: false }, 409);
      }
      if (action === "retry") {
        task.status = "queued";
        task.errorCode = null;
        task.actions = ["stop"];
      } else if (action === "pause") {
        task.status = "paused";
        task.actions = ["stop"];
      } else {
        task.status = "stopped";
        task.actions = [];
      }
      task.updatedAt = new Date().toISOString();
      record(operationId, { ok: true });
    },
  };
}

/** 仅供测试/演示重置 */
export function resetSyntheticState(): void {
  state = seedState();
}
