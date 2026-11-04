import { AdminApiError, type AdminApi } from "./client";
import type {
  AdminSession,
  AdminUserDetail,
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
 * 真实后端适配层（/admin/v1，回环监听，HttpOnly 会话）。
 *
 * 后端尚未实现（E 阶段由后端 agent 接续），本适配层给出完整请求形状，
 * 路由与 contracts.md §95 对齐。就绪后通过 VITE_ADMIN_API=http 启用。
 * 所有写操作带 X-Operation-Id 幂等头；401 统一映射为会话失效。
 */

const BASE = "/admin/v1";
const TIMEOUT_MS = 10_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
      ...init,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw AdminApiError.timeout();
    throw AdminApiError.network();
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw AdminApiError.sessionExpired();
  if (!res.ok) {
    let body = { error: "服务异常", code: "INTERNAL", retryable: res.status >= 500 };
    try {
      body = { ...body, ...(await res.json()) };
    } catch {
      /* 保留默认错误体 */
    }
    throw new AdminApiError(body, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = (path: string, body: unknown, operationId?: string) =>
  request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: operationId ? { "X-Operation-Id": operationId } : undefined,
  });

export function createHttpApi(): AdminApi {
  return {
    source: "http",
    login: (username, password) => post("/login", { username, password }) as Promise<AdminSession>,
    logout: () => post("/logout", {}) as Promise<void>,
    getSession: () => request<AdminSession | null>("/session"),
    getOverview: () => request<Overview>("/overview"),
    listUsers: (query: UserListQuery) => {
      const params = new URLSearchParams();
      if (query.keyword) params.set("keyword", query.keyword);
      if (query.status && query.status !== "all") params.set("status", query.status);
      params.set("page", String(query.page));
      params.set("pageSize", String(query.pageSize));
      return request<UserListResult>(`/users?${params.toString()}`);
    },
    getUserDetail: (id: string) => request<AdminUserDetail>(`/users/${encodeURIComponent(id)}`),
    topupQuota: (userId, amountMicro, note, operationId) =>
      post(`/users/${encodeURIComponent(userId)}/topup`, { amountMicro, note }, operationId) as Promise<TopupResult>,
    setAiPaused: (userId, paused, operationId, reason) =>
      post(
        `/users/${encodeURIComponent(userId)}/${paused ? "ai-pause" : "ai-resume"}`,
        { reason },
        operationId,
      ) as Promise<AdminUserDetail>,
    revokeDevice: (userId, deviceId, operationId) =>
      post(
        `/users/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}/revoke`,
        {},
        operationId,
      ) as Promise<AdminUserDetail>,
    resetPassword: (userId, operationId) =>
      post(`/users/${encodeURIComponent(userId)}/password-reset`, {}, operationId) as Promise<PasswordResetResult>,
    listTasks: (query: TaskListQuery) => {
      const params = new URLSearchParams();
      if (query.keyword) params.set("keyword", query.keyword);
      if (query.status && query.status !== "all") params.set("status", query.status);
      params.set("page", String(query.page));
      params.set("pageSize", String(query.pageSize));
      return request<TaskListResult>(`/tasks?${params.toString()}`);
    },
    runTaskAction: (taskId, action, operationId) =>
      post(`/tasks/${encodeURIComponent(taskId)}/actions`, { action }, operationId) as Promise<void>,
  };
}
