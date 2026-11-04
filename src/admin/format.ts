/** 展示格式化工具：金额统一 ¥，时间统一标注时区。 */

const CNY = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 微元 → ¥ 字符串，例如 1_234_500 → "¥1.23"（四舍五入到分） */
export function formatMicroYuan(micro: number): string {
  return CNY.format(micro / 1_000_000);
}

const dateTimeFmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO → "2026-11-04 15:47"（北京时间）；无效输入原样返回 */
export function formatBeijingTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return dateTimeFmt.format(new Date(t)).replace(/\//g, "-");
}

/** 相对时间（北京时间口径），超过 7 天回退到绝对时间 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = now - t;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "前" : "后";
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (abs < MIN) return "刚刚";
  if (abs < HOUR) return `${Math.round(abs / MIN)} 分钟${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)} 小时${suffix}`;
  if (abs < 7 * DAY) return `${Math.round(abs / DAY)} 天${suffix}`;
  return formatBeijingTime(iso);
}

/** 秒 → "10 分 40 秒" 风格的等待时长 */
export function formatWaitSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return seconds % 60 === 0 ? `${m} 分钟` : `${m} 分 ${seconds % 60} 秒`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} 小时` : `${h} 小时 ${m % 60} 分`;
}

/** 生成幂等键（同一确认对话框生命周期内复用） */
export function newOperationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
