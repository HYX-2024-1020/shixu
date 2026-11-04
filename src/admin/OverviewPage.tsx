import type { AdminApi } from "./api";
import { formatBeijingTime, formatMicroYuan, formatRelative, formatWaitSeconds } from "./format";
import type { Overview, ServiceStatus } from "./api/types";
import { EmptyState, ErrorState, Skeleton, StatusBadge, useAsyncData, type BadgeTone } from "./ui";

const SERVICE_BADGE: Record<ServiceStatus, { tone: BadgeTone; label: string }> = {
  ok: { tone: "ok", label: "正常" },
  degraded: { tone: "warn", label: "降级" },
  down: { tone: "danger", label: "故障" },
  maintenance: { tone: "info", label: "维护中" },
};

function UsageBar({ percent }: { percent: number }) {
  return (
    <div className="bar" role="img" aria-label={`占用 ${percent.toFixed(0)}%`}>
      <i style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function OverviewBody({ data }: { data: Overview }) {
  const { resources: r, costs, backup } = data;
  const diskPercent = (r.diskUsedGB / r.diskTotalGB) * 100;
  const memPercent = (r.memoryUsedMB / r.memoryTotalMB) * 100;
  const budgetPercent = costs.siteBudgetMonthMicro > 0 ? (costs.monthMicro / costs.siteBudgetMonthMicro) * 100 : 0;

  return (
    <>
      {data.alerts.length > 0 ? (
        <section className="alert-rail" aria-label="需要处理的问题">
          {data.alerts.map((a) => (
            <div key={a.id} className={`alert-slip ${a.severity}`}>
              <span className="sev">{a.severity === "critical" ? "需处理" : "留意"}</span>
              <span className="msg">{a.message}</span>
              <a className="btn btn-sm" href={a.actionHref}>
                {a.actionLabel}
              </a>
            </div>
          ))}
        </section>
      ) : (
        <EmptyState title="当前没有需要处理的问题" hint="服务、队列与备份均在正常范围内。" />
      )}

      <section className="panel" aria-labelledby="ov-services">
        <h2 id="ov-services">服务状态</h2>
        <div className="svc-grid">
          {data.services.map((s) => {
            const badge = SERVICE_BADGE[s.status];
            return (
              <div key={s.id} className={`svc ${s.status}`}>
                <span className="name">{s.name}</span>
                <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                <span className="detail">{s.detail ?? "—"}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel" aria-labelledby="ov-resources">
        <h2 id="ov-resources">资源占用</h2>
        <div className="metrics">
          <div className={`metric ${r.cpuPercent >= 90 ? "exceed" : ""}`}>
            <span className="label">CPU</span>
            <div className="value">
              {r.cpuPercent}
              <small>%</small>
            </div>
            <UsageBar percent={r.cpuPercent} />
          </div>
          <div className={`metric ${memPercent >= 90 ? "exceed" : memPercent >= 75 ? "approach" : ""}`}>
            <span className="label">内存</span>
            <div className="value">
              {(r.memoryUsedMB / 1024).toFixed(1)}
              <small>/ {(r.memoryTotalMB / 1024).toFixed(0)} GB</small>
            </div>
            <UsageBar percent={memPercent} />
          </div>
          <div
            className={`metric ${diskPercent >= r.diskPauseThresholdPercent ? "exceed" : diskPercent >= 55 ? "approach" : ""}`}
          >
            <span className="label">磁盘（≥{r.diskPauseThresholdPercent}% 暂停新上传）</span>
            <div className="value">
              {diskPercent.toFixed(0)}
              <small>% · {r.diskUsedGB.toFixed(0)}/{r.diskTotalGB.toFixed(0)} GB</small>
            </div>
            <UsageBar percent={diskPercent} />
          </div>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          采样于 {formatBeijingTime(r.sampledAt)}（北京时间，UTC+8）
        </p>
      </section>

      <section className="panel" aria-labelledby="ov-queue">
        <h2 id="ov-queue">任务队列</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>阶段</th>
                <th className="num">排队中</th>
                <th className="num">执行中</th>
                <th className="num">等待用户</th>
                <th className="num">最老排队</th>
              </tr>
            </thead>
            <tbody>
              {data.queue.map((q) => (
                <tr key={q.stage} style={{ cursor: "default" }}>
                  <td>{q.label}</td>
                  <td className="num">{q.pending}</td>
                  <td className="num">{q.running}</td>
                  <td className="num">{q.waitingUser}</td>
                  <td className="num">
                    {q.oldestPendingSeconds === null ? "—" : formatWaitSeconds(q.oldestPendingSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="ov-costs">
        <h2 id="ov-costs">费用</h2>
        <div className="metrics">
          <div className="metric">
            <span className="label">今日消费</span>
            <div className="value">{formatMicroYuan(costs.todayMicro)}</div>
          </div>
          <div className={`metric ${budgetPercent >= 90 ? "exceed" : budgetPercent >= 70 ? "approach" : ""}`}>
            <span className="label">本月消费 / 站点预算</span>
            <div className="value">
              {formatMicroYuan(costs.monthMicro)}
              <small>/ {formatMicroYuan(costs.siteBudgetMonthMicro)}</small>
            </div>
            <UsageBar percent={budgetPercent} />
          </div>
          <div className="metric">
            <span className="label">全体预留中（未结算）</span>
            <div className="value">{formatMicroYuan(costs.reservedMicro)}</div>
          </div>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          统计截至 {formatBeijingTime(costs.asOf)}（北京时间，UTC+8）。此处为拾序平台消费，非供应商账户余额。
        </p>
      </section>

      <section className="panel" aria-labelledby="ov-backup">
        <h2 id="ov-backup">备份</h2>
        <div className="metrics">
          <div className={`metric ${backup.maintenanceReason ? "exceed" : ""}`}>
            <span className="label">最近成功</span>
            <div className="value" style={{ fontSize: 17 }}>
              {backup.lastSuccessAt ? formatRelative(backup.lastSuccessAt) : "从未成功"}
            </div>
            <span className="sub">{backup.lastSuccessAt ? formatBeijingTime(backup.lastSuccessAt) : ""}</span>
          </div>
          <div className={`metric ${backup.lastFailureAt && !backup.lastSuccessAt ? "exceed" : backup.lastFailureAt && Date.parse(backup.lastFailureAt) > Date.parse(backup.lastSuccessAt ?? "") ? "exceed" : ""}`}>
            <span className="label">最近失败</span>
            <div className="value" style={{ fontSize: 17 }}>
              {backup.lastFailureAt ? formatRelative(backup.lastFailureAt) : "无失败记录"}
            </div>
            <span className="sub">{backup.lastFailureAt ? formatBeijingTime(backup.lastFailureAt) : ""}</span>
          </div>
          <div className="metric">
            <span className="label">保留份数 / 单份期限</span>
            <div className="value">
              {backup.retainedCount}
              <small>份 · {backup.retentionDays} 天</small>
            </div>
            <span className="sub">
              {backup.nextExpireAt ? `最早一份 ${formatBeijingTime(backup.nextExpireAt)} 到期` : "暂无到期"}
            </span>
          </div>
        </div>
        {backup.maintenanceReason && (
          <p className="dialog-error" role="alert" style={{ marginTop: 12 }}>
            维护原因：{backup.maintenanceReason}
            {backup.uploadsPaused && "（已暂停新增上传）"}
            {backup.aiPaused && "（已暂停 AI 任务）"}
          </p>
        )}
      </section>
    </>
  );
}

/** 服务总览：服务/资源/队列/费用/备份，需要处理的问题置顶。 */
export function OverviewPage({ api }: { api: AdminApi }) {
  const { state, retry } = useAsyncData(() => api.getOverview(), []);
  return (
    <>
      <header className="page-head">
        <h1>服务总览</h1>
        <p>需要处理的问题置顶；各区块可独立核对。</p>
      </header>
      {state.phase === "loading" && (
        <>
          <Skeleton rows={2} height={44} />
          <Skeleton rows={4} height={22} />
        </>
      )}
      {state.phase === "error" && <ErrorState error={state.error} onRetry={retry} />}
      {state.phase === "ready" && <OverviewBody data={state.data} />}
    </>
  );
}
