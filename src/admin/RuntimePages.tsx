import { useState, useRef } from "react";
import type { AdminApi } from "./api";
import { formatBeijingTime, newOperationId } from "./format";
import { Button, ErrorState, useAsyncData } from "./ui";

export function SiteControl({
  api,
  control,
  onChange,
}: {
  api: AdminApi;
  control?: { paused: boolean; safetyPaused: boolean };
  onChange: () => void;
}) {
  const [pending, setPending] = useState<{
      paused: boolean;
      id: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!control || !api.setSitePaused) return null;
  return (
    <section className="panel">
      <h2>全站 AI 权限</h2>
      <p>
        {control.paused ? "人工暂停中" : "人工权限开放"}
        {control.safetyPaused ? " · 服务安全开关仍关闭" : ""}
      </p>
      {!pending ? (
        <Button
          onClick={() => {
            setError("");
            setPending({ paused: !control.paused, id: newOperationId() });
          }}
        >
          {control.paused ? "恢复全站 AI" : "暂停全站 AI"}
        </Button>
      ) : (
        <div className="inline-confirm">
          <p>
            对象：全部账号。
            {pending.paused
              ? "阻止后续新的付费派发；已发请求可能继续产生费用，进度保留。"
              : "重新开放权限；不解除个人暂停、账本及费用门禁，旧任务需用户主动继续。"}
          </p>
          {error && <p role="alert">{error}</p>}
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.setSitePaused!(pending.paused, pending.id);
                setPending(null);
                onChange();
              } catch (e) {
                setError(e instanceof Error ? e.message : "操作失败，请重试");
              } finally {
                setBusy(false);
              }
            }}
          >
            确认{pending.paused ? "暂停" : "恢复"}
          </Button>{" "}
          <Button disabled={busy} onClick={() => setPending(null)}>
            取消
          </Button>
        </div>
      )}
    </section>
  );
}

export function AlertsPage({ api }: { api: AdminApi }) {
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  const operations=useRef<Record<string,string>>({});
  const { state, retry } = useAsyncData(
    () => (api.getAlerts ? api.getAlerts() : Promise.resolve([])),
    [],
  );
  return (
    <section className="panel">
      <h1>告警中心</h1>
      <p>持续故障更新原记录，恢复保留历史。已读不代表故障解决。</p>
      <Button onClick={retry}>刷新告警</Button>
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" && state.data.length === 0 && (
        <p>当前没有告警记录。</p>
      )}
      {state.phase === "ready" &&
        state.data.map((a) => (
          <article className="alert-slip" key={a.id}>
            <div>
              <h2>
                {a.recoveredAt
                  ? "已恢复"
                  : a.severity === "critical"
                    ? "需处理"
                    : "留意"}{" "}
                · {a.object}
              </h2>
              <p>{a.message}</p>
              <p>
                发生：{a.firstAt && formatBeijingTime(a.firstAt)} · 最近检测：
                {a.lastAt && formatBeijingTime(a.lastAt)}
              </p>
              {a.recoveredAt && <p>恢复：{formatBeijingTime(a.recoveredAt)}</p>}
              <p>{a.suggestion}</p>
              <p>{a.readAt ? `已读 · ${formatBeijingTime(a.readAt)}` : '未读'}</p>
              {!a.readAt && api.readAlert && <Button busy={busy===a.id} disabled={!!busy} onClick={async()=>{
                operations.current[a.id] ||= newOperationId();setBusy(a.id);setError('');
                try{await api.readAlert!(a.id,operations.current[a.id]);retry();}catch(e){setError(e instanceof Error?e.message:'标记失败，请重试');}finally{setBusy('');}
              }}>标为已读</Button>}
              {error&&<p role="alert">{error}</p>}
              <a href={a.actionHref}>{a.actionLabel}</a>
            </div>
          </article>
        ))}
    </section>
  );
}

export function AuditPage({ api }: { api: AdminApi }) {
  const { state, retry } = useAsyncData(
    () => (api.getAudit ? api.getAudit() : Promise.resolve([])),
    [],
  );
  return (
    <section className="panel">
      <h1>运维与审计</h1>
      <p>
        管理控制审计只读，保留操作对象、时间和幂等编号。服务重启、备份恢复尚未开放。
      </p>
      <Button onClick={retry}>刷新审计</Button>
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" &&
        state.data.map((a) => (
          <div className="audit-row" key={a.id}>
            {formatBeijingTime(a.at)} · {a.actor} · {a.action} · {a.detail} ·{" "}
            {a.operationId}
          </div>
        ))}
    </section>
  );
}
