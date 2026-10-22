import { type Entry } from "./types";
export interface CloudConfig {
  url: string;
  anonKey: string;
}
export interface CloudSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}
export function checkCloud(config: CloudConfig): CloudConfig {
  const url = new URL(config.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("请输入 Supabase 项目的 HTTPS 根地址");
  if (!config.anonKey.trim())
    throw new Error("请填写 publishable 或 anon 公钥");
  if (config.anonKey.startsWith("sb_secret_"))
    throw new Error(
      "不能使用 secret 或 service_role 密钥，请使用 publishable 公钥",
    );
  try {
    const payload = JSON.parse(atob(config.anonKey.split(".")[1]));
    if (payload.role && payload.role !== "anon")
      throw new Error("不能使用 service_role 密钥");
  } catch (e) {
    if (e instanceof Error && e.message.includes("service_role")) throw e;
  }
  return { url: url.origin, anonKey: config.anonKey.trim() };
}
export async function cloudAuth(
  config: CloudConfig,
  email: string,
  password: string,
  signup = false,
): Promise<CloudSession | null> {
  const response = await fetch(
    `${config.url}/auth/v1/${signup ? "signup" : "token?grant_type=password"}`,
    {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.msg || result.error_description || result.message || "登录失败",
    );
  return result.access_token
    ? {
        ...result,
        expires_at:
          result.expires_at ||
          Math.floor(Date.now() / 1000) + result.expires_in,
      }
    : null;
}
export async function refreshCloud(
  config: CloudConfig,
  session: CloudSession,
): Promise<CloudSession> {
  if (session.expires_at > Date.now() / 1000 + 90) return session;
  const response = await fetch(
    `${config.url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error("登录已过期，请重新登录");
  const result = await response.json();
  return {
    ...result,
    expires_at:
      result.expires_at || Math.floor(Date.now() / 1000) + result.expires_in,
  };
}
export async function syncCloud(
  config: CloudConfig,
  session: CloudSession,
  entries: Entry[],
): Promise<Entry[]> {
  const response = await fetch(`${config.url}/rest/v1/rpc/sync_entries`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ incoming: entries }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "云端未初始化，请先执行设置中的 SQL"
        : `同步失败（${response.status}），请检查网络和数据库设置`,
    );
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("同步返回格式不正确");
  return data.map((row) => row.payload as Entry);
}
