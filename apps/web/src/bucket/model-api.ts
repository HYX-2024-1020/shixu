import { serviceRequest, type Health } from "./service";
export const KNOWN_MODELS = ["deepseek-flash", "deepseek-v4-pro"];
export const modelLabel = (id: string) =>
  ({
    "deepseek-flash": "DeepSeek Flash",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
  })[id] || id;
async function direct(path: string, key: string) {
  if (!key.trim()) throw new Error("请先填写 DeepSeek 密钥");
  const r = await fetch("https://api.deepseek.com/" + path, {
    headers: { Authorization: `Bearer ${key.trim()}` },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!r.ok)
    throw new Error(
      r.status === 401
        ? "DeepSeek 密钥不正确"
        : "暂时无法读取 DeepSeek 信息，请检查网络后重试",
    );
  return r.json();
}
export async function getModels(
  key: string,
  health: Health | null,
): Promise<string[]> {
  const data = health
    ? await serviceRequest(
        "models",
        key.trim()
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ apiKey: key.trim() }),
            }
          : {},
      )
    : await direct("models", key);
  const ids = Array.isArray(data.data)
    ? data.data
        .map((m: { id: unknown }) => m?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.length > 0 && id.length <= 100,
        )
    : [];
  if (!ids.length) throw new Error("接口没有返回可用模型");
  return [...new Set<string>(ids)];
}
export interface Balance {
  currency: string;
  total: string;
}
export async function getBalance(
  key: string,
  health: Health | null,
): Promise<Balance[]> {
  const data = health
    ? await serviceRequest("balance")
    : await direct("user/balance", key);
  const rows = Array.isArray(data.balance_infos)
    ? data.balance_infos
        .filter(
          (r: { currency: unknown; total_balance: unknown }) =>
            ["CNY", "USD"].includes(String(r.currency)) &&
            typeof r.total_balance === "string" &&
            r.total_balance.trim() &&
            Number.isFinite(Number(r.total_balance)) &&
            Number(r.total_balance) >= 0,
        )
        .map((r: { currency: string; total_balance: string }) => ({
          currency: r.currency,
          total: r.total_balance,
        }))
    : [];
  if (!rows.length) throw new Error("接口没有返回可显示的余额");
  return rows;
}
