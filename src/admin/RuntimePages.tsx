import { useEffect, useState, useRef } from "react";
import type { AdminApi } from "./api";
import { formatBeijingTime, newOperationId } from "./format";
import { Button, ErrorState, useAsyncData } from "./ui";
import { BudgetPanel } from "./ManagementPages";
import { OperationsPanel } from "./OperationsPages";

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
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const operations = useRef<Record<string, string>>({});
  const [receipt, setReceipt] = useState("");
  const [history, setHistory] = useState(false);
  const [followup, setFollowup] = useState<{
    id: string;
    state: string;
    note: string;
    operation: string;
  } | null>(null);
  const followLabels: Record<string, string> = {
    following: "跟进中",
    developer: "待开发修复",
    "user-action": "待用户主动继续",
    reviewed: "恢复已核实",
  };
  const { state, retry } = useAsyncData(
    () => (api.getAlerts ? api.getAlerts() : Promise.resolve([])),
    [],
  );
  useEffect(() => {
    const timer = setInterval(retry, 15000);
    return () => clearInterval(timer);
  }, [retry]);
  return (
    <section className="panel">
      <h1>告警中心</h1>
      <p>持续故障更新原记录，恢复保留历史。已读不代表故障解决。</p>
      <p>
        侧栏数字表示未恢复故障数，包含已读故障。跟进记录保留在审计中；只有实际检测恢复后才可核实收尾。
      </p>
      <Button onClick={retry}>刷新告警</Button>
      <Button onClick={() => setHistory(!history)}>
        {history ? "只看当前故障" : "查看恢复历史"}
      </Button>
      {receipt && <p role="status">{receipt}</p>}
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" && state.data.length === 0 && (
        <p>当前没有告警记录。</p>
      )}
      {state.phase === "ready" &&
        state.data
          .filter((a) => history || !a.recoveredAt)
          .sort((a, b) => Number(!!a.recoveredAt) - Number(!!b.recoveredAt))
          .map((a) => (
            <article
              className={`alert-slip ${a.recoveredAt ? "recovered" : a.severity}`}
              key={a.id}
            >
              <div>
                <h2>
                  {a.recoveredAt
                    ? "已恢复"
                    : a.severity === "critical"
                      ? "需处理"
                      : "留意"}{" "}
                  · {a.title || a.object}
                </h2>
                <p>{a.message}</p>
                <p>
                  发生：{a.firstAt && formatBeijingTime(a.firstAt)} · 最近检测：
                  {a.lastAt && formatBeijingTime(a.lastAt)}
                </p>
                {a.recoveredAt && (
                  <p>恢复：{formatBeijingTime(a.recoveredAt)}</p>
                )}
                <p>{a.suggestion}</p>
                {a.followup && (
                  <p>
                    处置进度：
                    {followLabels[a.followup.state] || a.followup.state} ·{" "}
                    {a.followup.note} · {formatBeijingTime(a.followup.at)}
                  </p>
                )}
                <p>
                  {a.readAt ? `已读 · ${formatBeijingTime(a.readAt)}` : "未读"}
                </p>
                {!a.readAt && api.readAlert && (
                  <Button
                    busy={busy === a.id}
                    disabled={!!busy}
                    onClick={async () => {
                      operations.current[a.id] ||= newOperationId();
                      setBusy(a.id);
                      setError("");
                      try {
                        await api.readAlert!(a.id, operations.current[a.id]);
                        setReceipt("已标为已读，故障恢复状态保持不变。");
                        retry();
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "标记失败，请重试",
                        );
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    标为已读
                  </Button>
                )}
                {error && <p role="alert">{error}</p>}
                <a href={a.actionHref}>{a.actionLabel}</a>
                {api.followAlert && (
                  <Button
                    onClick={() => {
                      setError("");
                      setFollowup({
                        id: a.id,
                        state: a.recoveredAt ? "reviewed" : "following",
                        note: "",
                        operation: newOperationId(),
                      });
                    }}
                  >
                    记录处置进展
                  </Button>
                )}
                {followup?.id === a.id && (
                  <div className="inline-confirm">
                    <label>
                      处置状态
                      <select
                        aria-label="处置状态"
                        value={followup.state}
                        onChange={(e) =>
                          setFollowup({
                            ...followup,
                            state: e.target.value,
                            operation: newOperationId(),
                          })
                        }
                      >
                        {Object.entries(followLabels)
                          .filter(
                            ([key]) => key !== "reviewed" || !!a.recoveredAt,
                          )
                          .map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      处置说明
                      <input
                        aria-label="处置说明"
                        maxLength={200}
                        value={followup.note}
                        onChange={(e) =>
                          setFollowup({
                            ...followup,
                            note: e.target.value,
                            operation: newOperationId(),
                          })
                        }
                      />
                    </label>
                    <p>
                      只记录实际跟进，不改变故障检测、任务或费用，不自动继续任务。
                    </p>
                    <Button
                      disabled={!followup.note.trim() || !!busy}
                      onClick={async () => {
                        setBusy(a.id);
                        setError("");
                        try {
                          await api.followAlert!(
                            a.id,
                            followup.state,
                            followup.note,
                            followup.operation,
                          );
                          setReceipt("处置进展已记入审计。");
                          setFollowup(null);
                          retry();
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : "记录失败，请重试",
                          );
                        } finally {
                          setBusy("");
                        }
                      }}
                    >
                      保存处置记录
                    </Button>
                    <Button onClick={() => setFollowup(null)}>取消</Button>
                  </div>
                )}
                <details>
                  <summary>技术信息</summary>
                  <p>
                    对象 {a.object} · 类型 {a.kind || "未提供"} · 记录 {a.id}
                  </p>
                  {a.technicalMessage !== a.message && <p>{a.technicalMessage}</p>}
                </details>
              </div>
            </article>
          ))}
      {state.phase === "ready" &&
        !history &&
        state.data.length > 0 &&
        state.data.every((a) => !!a.recoveredAt) && (
          <p>当前故障均已恢复，历史记录仍可查看。</p>
        )}
    </section>
  );
}

export function AuditPage({ api }: { api: AdminApi }) {
  const [keyword, setKeyword] = useState(""),
    [page, setPage] = useState(1);
  const { state, retry } = useAsyncData(
    () =>
      api.queryAudit
        ? api.queryAudit(keyword, page)
        : api.getAudit
          ? api.getAudit().then((items) => ({
              items,
              total: items.length,
              page: 1,
              pageSize: 200,
            }))
          : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 200 }),
    [api, keyword, page],
  );
  return (
    <section className="panel">
      {api.getBudget && <BudgetPanel api={api} />}
      <OperationsPanel api={api} />
      <h1>运维与审计</h1>
      <p>管理控制审计只读，保留操作对象、时间和幂等编号。</p>
      <div className="toolbar">
        <input
          aria-label="筛选审计"
          maxLength={200}
          placeholder="操作者、动作、对象或操作编号"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <Button onClick={retry}>刷新审计</Button>
      </div>
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" &&
        state.data.items.map((a) => (
          <div className="audit-row" key={a.id}>
            {formatBeijingTime(a.at)} · {a.actor} · {a.action} · {a.detail} ·{" "}
            {a.operationId}
          </div>
        ))}
      {state.phase === "ready" && (
        <p>
          共 {state.data.total} 条{" "}
          <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>{" "}
          第 {page} 页{" "}
          <Button
            disabled={page * state.data.pageSize >= state.data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </p>
      )}
    </section>
  );
}
