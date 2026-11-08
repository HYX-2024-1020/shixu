import { AdminApiError, type AdminApi } from "./client";
import type {
  AdminSession,
  AdminUserDetail,
  Overview,
  PasswordResetResult,
  TaskListQuery,
  TaskListResult,
  TopupResult,
  UserListQuery,
  UserListResult,
} from "./types";

/** 同源管理接口。会话签发操作凭据，所有写操作携带 CSRF token。 */
const BASE = "/admin/v1";
const TIMEOUT_MS = 10_000;
const invalidResponse = () => new AdminApiError({
  error: "管理服务响应无效，请重试", code: "INVALID_RESPONSE", retryable: true,
});

export function createHttpApi(): AdminApi {
  let csrfToken = "";
  let sessionRevision = 0;

  function rememberSession(session: AdminSession | null) {
    if (session === null) {
      csrfToken = "";
      return;
    }
    if (!session || typeof session.username !== "string" || typeof session.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(session.expiresAt)) ||
        typeof session.csrfToken !== "string" || !/^[\w-]{32,128}$/.test(session.csrfToken))
      throw invalidResponse();
    csrfToken = session.csrfToken;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const revision = sessionRevision;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (init.method === "POST" && path !== "/login" && csrfToken)
      headers.set("X-CSRF-Token", csrfToken);
    try {
      const response = await fetch(`${BASE}${path}`, {
        ...init, headers, credentials: "same-origin", redirect: "error", signal: controller.signal,
      });
      if (response.status === 401 && path !== "/login") {
        if (revision !== sessionRevision)
          throw new AdminApiError({ error: "请求所属会话已变化", code: "STALE_SESSION", retryable: false }, 401);
        csrfToken = "";
        throw AdminApiError.sessionExpired();
      }
      if (!response.ok) {
        let body = { error: "服务异常", code: "INTERNAL", retryable: response.status >= 500 };
        try {
          const value = await response.json();
          if (typeof value.error === "string" && typeof value.code === "string" && typeof value.retryable === "boolean")
            body = { error: value.error, code: value.code, retryable: value.retryable };
        } catch {
          if (controller.signal.aborted) throw AdminApiError.timeout();
        }
        throw new AdminApiError(body, response.status);
      }
      if (response.status === 204) return undefined as T;
      try {
        return await response.json() as T;
      } catch {
        if (controller.signal.aborted) throw AdminApiError.timeout();
        throw invalidResponse();
      }
    } catch (error) {
      if (error instanceof AdminApiError) throw error;
      if (controller.signal.aborted) throw AdminApiError.timeout();
      throw AdminApiError.network();
    } finally {
      clearTimeout(timer);
    }
  }

  const post = (path: string, body: unknown, operationId?: string) => request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: operationId ? { "X-Operation-Id": operationId } : undefined,
  });

  return {
    getAlerts: () => request('/alerts'),
    readAlert: (id,operationId) => post(`/alerts/${encodeURIComponent(id)}/read`,{},operationId) as Promise<import('./types').AlertItem>,
    getAudit: () => request('/audit'),
    setSitePaused: (paused, operationId) => post(`/site/${paused?'ai-pause':'ai-resume'}`, {}, operationId) as Promise<{paused:boolean;safetyPaused:boolean}>,
    source: "http",
    login: async (username, password) => {
      sessionRevision += 1;
      const session = await post("/login", { username, password }) as AdminSession;
      if (!session) throw invalidResponse();
      rememberSession(session);
      return session;
    },
    logout: async () => {
      await post("/logout", {});
      sessionRevision += 1;
      csrfToken = "";
    },
    getSession: async () => {
      const revision = sessionRevision;
      const session = await request<AdminSession | null>("/session");
      if (revision === sessionRevision) rememberSession(session);
      return session;
    },
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
