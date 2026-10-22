import { useState, useEffect, useRef } from "react";
import {
  usageTotals,
  money,
  PRICE_DATE,
  PRICE_URL,
  type UsageRecord,
} from "../../shared/usage.mjs";
import { getBalance, modelLabel, type Balance } from "./model-api";
import type { Health } from "./service";
export default function UsagePanel({
  records,
  apiKey,
  health,
  notify,
}: {
  records: UsageRecord[];
  apiKey: string;
  health: Health | null;
  notify: (s: string) => void;
}) {
  const total = usageTotals(records),
    [balance, setBalance] = useState<Balance[] | null>(null),
    [busy, setBusy] = useState(false);
  const currentKey = useRef(apiKey);
  currentKey.current = apiKey;
  useEffect(() => {
    setBalance(null);
  }, [apiKey]);
  const recent = [...records]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 8);
  return (
    <section className="bucket-usage" aria-label="用量与费用">
      <div className="usage-heading">
        <h3>{health ? "个人服务累计" : "本机累计"}</h3>
        <span>人民币估算</span>
      </div>
      <p className="usage-amount">
        {!total.calls
          ? "尚无用量记录"
          : total.unpriced === total.calls
            ? "费用待核对"
            : `¥${money(total.min)} – ${money(total.max)}`}
      </p>
      <p className="usage-tokens">
        {total.calls} 次调用 · 输入 {total.prompt.toLocaleString()} / 输出{" "}
        {total.completion.toLocaleString()} Tokens
      </p>
      {total.unpriced > 0 && (
        <p className="usage-incomplete">
          {total.unpriced}{" "}
          次调用待回报或无法估价，未计入金额，实际花费可能更高。
        </p>
      )}
      <p className="usage-scope">
        从用量统计功能上线开始记录，包含分段、跨次关联、合并与修复。历史消耗无法补齐；仅统计此
        {health ? "个人服务" : "浏览器"}的调用，包含在此使用的不同密钥。
      </p>
      <details>
        <summary>计费依据与最近调用</summary>
        <p>
          Token 来自接口实际回报。金额按 {PRICE_DATE}{" "}
          核对的官方人民币价格，显示空闲至高峰时段区间，包含缓存折扣；缓存明细缺失时扩大估算范围。实际扣费以官方账单为准，价格变动可能使估算失准。
        </p>
        <a href={PRICE_URL} target="_blank" rel="noreferrer">
          核对官方价格 ↗
        </a>
        {recent.map((r) => (
          <div className="usage-call" key={r.id}>
            <span>
              {modelLabel(r.model)}
              <small>{new Date(r.startedAt).toLocaleString("zh-CN")}</small>
            </span>
            <span>
              {r.cost
                ? `¥${money(r.cost.min)} – ${money(r.cost.max)}`
                : r.state === "pending"
                  ? "待回报 / 可能中断"
                  : "未取得用量或价格"}
              <small>
                {r.usage
                  ? `${r.usage.total.toLocaleString()} Tokens`
                  : "未按零费用处理"}
              </small>
            </span>
          </div>
        ))}
      </details>
      <div className="usage-balance">
        <span>
          {balance
            ? balance.map((b) => `${b.currency} ${b.total}`).join(" · ")
            : "账户余额未查询"}
        </span>
        <button
          disabled={busy || (health ? !health.authenticated : !apiKey.trim())}
          onClick={async () => {
            setBusy(true);
            try {
              const rows = await getBalance(apiKey, health);
              if (currentKey.current === apiKey) setBalance(rows);
            } catch (error) {
              notify(error instanceof Error ? error.message : "读取余额失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "读取中…" : "刷新余额"}
        </button>
      </div>
      <p className="usage-scope">
        余额来自 DeepSeek
        账户，会受其他应用调用、充值和赠送额度影响，不等于本站累计消费。
      </p>
    </section>
  );
}
