import { useEffect, useRef, useState } from "react";
import type { AdminApi } from "./api";
import type { AdminTask, TaskAction, TaskStatus } from "./api/types";
import { formatBeijingTime, formatMicroYuan, newOperationId } from "./format";
import { Button, ConfirmDialog, ErrorState, Field, useAsyncData } from "./ui";

const statusLabels: Record<string, string> = {
  queued: "排队",
  running: "处理中",
  applying: "发布中",
  paused: "已暂停",
  interrupted: "已中断",
  error: "处理失败",
  conflict: "有冲突",
  cancelled: "已停止",
  done: "已完成",
  partial: "已收下部分",
  failed: "失败",
  stopped: "已停止",
};
const actionLabels = {
  pause: "暂停任务",
  retry: "继续 / 重试",
  stop: "停止任务",
};
const stageLabels: Record<string, string> = {
  reading: "读取与整理材料", merging: "核对重复事项", associating: "关联已有事项", verifying: "核对图像依据", chat: "回答卡片问题",
};

export function TasksPage({ api }: { api: AdminApi }) {
  const detail = useRef<HTMLElement>(null);
  const [keyword, setKeyword] = useState(""),
    [status, setStatus] = useState<TaskStatus | "all">("all"),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminTask | null>(null),
    [pending, setPending] = useState<{
      task: AdminTask;
      action: TaskAction;
      operation: string;
    } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (selected) {
      detail.current?.scrollIntoView({ block: "start", behavior: "instant" });
      detail.current?.focus({ preventScroll: true });
    }
  }, [selected]);
  const [limit, setLimit] = useState<{
    id: string;
    minutes: string;
    reason: string;
  } | null>(null);
  const { state, retry } = useAsyncData(
    () => api.listTasks({ keyword, status, page, pageSize: 20 }),
    [api, keyword, status, page],
  );
  return (
    <section className="panel">
      <h1>任务管理</h1>
      <p>每次整理或卡片对话是一项任务。在这里定位失败、核对费用并按状态处置；不展示用户正文或原文件。</p>
      <p>暂停和失败的任务保留进度，等待主动继续，并不代表仍在排队。继续可能产生新费用，安全门禁仍生效。</p>
      <div className="toolbar">
        <input
          aria-label="搜索任务"
          placeholder="账号、任务编号或错误码"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="任务状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as TaskStatus | "all");
            setPage(1);
          }}
        >
          <option value="all">全部状态</option>
          {Object.entries(statusLabels)
            .filter(([k]) => !["failed", "stopped"].includes(k))
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
        <Button onClick={retry}>刷新任务</Button>
      </div>
      {state.phase === "loading" && <p role="status">正在读取任务…</p>}
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" && (
        <>
          <p>共 {state.data.total} 个任务</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>账号 / 任务</th>
                  <th>状态 / 阶段</th>
                  <th>已完成块</th>
                  <th>累计费用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.username}
                      <br />
                      <small>任务 {String(t.taskId || t.id).slice(0, 8)}</small>
                    </td>
                    <td>
                      {statusLabels[t.status] || t.status} · {stageLabels[t.stage] || t.stageLabel}
                      <br />
                      {t.errorCode}
                    </td>
                    <td>{t.completedBlocks ?? "未采集"}</td>
                    <td>
                      {t.costMicro === null
                        ? "未采集"
                        : formatMicroYuan(t.costMicro)}
                    </td>
                    <td>
                      <Button
                        onClick={() => {
                          setSelected(t);
                          setPending(null);
                          setLimit(null);
                          setError("");
                        }}
                      >
                        查看与处置
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.data.items.length === 0 && <p>没有符合条件的任务。</p>}
          <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>{" "}
          第 {page} 页{" "}
          <Button
            disabled={page * 20 >= state.data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </>
      )}
      {selected && (
        <article className="panel task-detail" ref={detail} tabIndex={-1} aria-label="任务详情">
          <h2>{selected.username} · 任务详情</h2>
          <Button onClick={() => setSelected(null)}>关闭详情</Button>
          <details><summary>技术编号</summary><p>
            <code>{selected.taskId || selected.id}</code>
          </p></details>
          <p>
            {statusLabels[selected.status]} · {stageLabels[selected.stage] || selected.stageLabel} ·{" "}
            {selected.errorCode || "无错误码"}
          </p>
          {selected.diagnostic && <section className="diagnostic-report">
            <h3>本次处理报告</h3>
            <p>报告 {selected.diagnostic.id} · {formatBeijingTime(new Date(selected.diagnostic.at).toISOString())}</p>
            <p>发生在{stageLabels[selected.diagnostic.phase] || selected.diagnostic.phase}。资料及已结算费用保留。核对失败需要修复处理规则；管理员不能通过解除费用或安全门禁强行发布结果。</p>
            <details><summary>诊断和调用费用</summary>
              <p>版本 {selected.diagnostic.version} · 错误 {selected.diagnostic.code} · 执行批次 {selected.diagnostic.generation}</p>
              {selected.diagnostic.calls.map(call => <p key={call.id}>{call.id} · {call.state} · {formatMicroYuan(call.actual ?? call.reserved)}{call.actual === null ? "（预留或待核对）" : "（已结算）"}</p>)}
            </details>
          </section>}
          <p>
            累计 {selected.calls ?? "未采集"} 次调用 · 活跃{" "}
            {selected.activeSeconds ?? "未采集"} 秒 / 上限{" "}
            {selected.limitSeconds ?? "未采集"} 秒 · 完成{" "}
            {selected.completedBlocks ?? "未采集"} 块 ·{" "}
            {selected.costMicro === null
              ? "未采集"
              : formatMicroYuan(selected.costMicro)}
          </p>
          {selected.limitReview && api.extendTaskLimit && (
            <Button
              onClick={() => {
                setError("");
                setPending(null);
                setLimit({
                  id: newOperationId(),
                  minutes: String(
                    Math.ceil((selected.limitSeconds || 1800) / 60) + 30,
                  ),
                  reason: "",
                });
              }}
            >
              核对并延长累计时限
            </Button>
          )}
          <ConfirmDialog
            inline
            open={!!limit}
            title="延长累计执行时限"
            subject={`账号 ${selected.username} 的当前任务`}
            impact="只延长这份投递的累计执行上限；可能允许用户随后主动继续付费处理。"
            consequence="不清累计调用、活跃时间、消费或unknown，不解除其他安全门禁，也不自动继续任务。"
            busy={busy}
            error={error}
            onCancel={() => setLimit(null)}
            onConfirm={async () => {
              if (!limit || !selected.limitReview) return;
              if (!limit.reason.trim()) {
                setError("请填写核对与调整原因");
                return;
              }
              const seconds = Number(limit.minutes) * 60;
              if (!Number.isSafeInteger(seconds) || seconds <= 0) {
                setError("请输入有效的累计分钟数");
                return;
              }
              setBusy(true);
              try {
                await api.extendTaskLimit!(
                  selected.id,
                  {
                    newLimitSeconds: seconds,
                    reason: limit.reason.trim(),
                    ...selected.limitReview,
                  },
                  limit.id,
                );
                setLimit(null);
                setSelected(null);
                retry();
              } catch (e) {
                setError(e instanceof Error ? e.message : "时限调整失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="新的累计上限（分钟，最多1440）">
              <input
                value={limit?.minutes || ""}
                disabled={busy}
                onChange={(e) =>
                  limit &&
                  setLimit({
                    ...limit,
                    id: newOperationId(),
                    minutes: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="核对与调整原因">
              <input
                maxLength={200}
                value={limit?.reason || ""}
                disabled={busy}
                onChange={(e) =>
                  limit &&
                  setLimit({
                    ...limit,
                    id: newOperationId(),
                    reason: e.target.value,
                  })
                }
              />
            </Field>
          </ConfirmDialog>
          <p>
            更新时间：
            {selected.updatedAt
              ? formatBeijingTime(selected.updatedAt)
              : "当前任务协议未采集，以上为本次查询状态"}
          </p>
          {selected.actions.map((a) => (
            <Button
              key={a}
              disabled={busy}
              onClick={() => {
                setError("");
                setLimit(null);
                setPending({
                  task: selected,
                  action: a,
                  operation: newOperationId(),
                });
              }}
            >
              {actionLabels[a]}
            </Button>
          ))}{" "}
          <Button
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setPending(null);
              setLimit(null);
            }}
          >
            关闭详情
          </Button>
          {selected.actions.length === 0 && (
            <p>当前状态没有可执行的管理操作。</p>
          )}
          <ConfirmDialog
            inline
            open={!!pending}
            title={pending ? actionLabels[pending.action] : ""}
            subject={`账号 ${selected.username} 的任务 ${selected.taskId || selected.id}`}
            impact={
              pending?.action === "retry"
                ? "按当前资料修订继续，可能派发新的付费请求。"
                : "阻止后续步骤，尽力中断当前步骤；已发请求可能仍产生费用。"
            }
            consequence={
              pending?.action === "stop"
                ? "丢弃未完成块和未发布展示草稿；有效已付费块及已收下事项、费用记录保留。"
                : "保留进度和费用，不能解除账号暂停、费用不明、资料与累计时间安全门禁。暂停后须主动继续。"
            }
            busy={busy}
            error={error}
            onCancel={() => setPending(null)}
            onConfirm={async () => {
              if (!pending) return;
              setBusy(true);
              try {
                await api.runTaskAction(
                  pending.task.id,
                  pending.action,
                  pending.operation,
                  {
                    generation: pending.task.generation,
                    revision: pending.task.revision,
                    maintenanceOperation: pending.task.maintenanceOperation,
                  },
                );
                setPending(null);
                setSelected(null);
                retry();
              } catch (e) {
                setError(e instanceof Error ? e.message : "操作失败");
              } finally {
                setBusy(false);
              }
            }}
          />
        </article>
      )}
    </section>
  );
}

export function BudgetPanel({ api }: { api: AdminApi }) {
  const { state, retry } = useAsyncData(() => api.getBudget!(), [api]);
  const [pending, setPending] = useState(""),
    [daily, setDaily] = useState("50"),
    [monthly, setMonthly] = useState(""),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!api.getBudget) return null;
  return (
    <section className="panel">
      <h2>全站预算</h2>
      {state.phase === "loading" && <p>正在读取预算…</p>}
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" && (
        <>
          <p>
            每日上限 {formatMicroYuan(state.data.dailyMicro)} · 月度上限{" "}
            {state.data.monthlyMicro === null
              ? "未设置（每日门禁仍生效）"
              : formatMicroYuan(state.data.monthlyMicro)}
          </p>
          <p>
            今日消费 {formatMicroYuan(state.data.daySpentMicro)} · 本月消费{" "}
            {formatMicroYuan(state.data.monthSpentMicro)} · 在途及费用不明风险{" "}
            {formatMicroYuan(state.data.riskMicro)}
          </p>
          <p>北京时间零点切换日/月；未核对风险跨期保留。账本金额为平台估算。</p>
          <Button
            onClick={() => {
              setDaily(String(state.data.dailyMicro / 1000000));
              setMonthly(
                state.data.monthlyMicro === null
                  ? ""
                  : String(state.data.monthlyMicro / 1000000),
              );
              setReason("");
              setError("");
              setPending(newOperationId());
            }}
          >
            调整预算
          </Button>
        </>
      )}
      <ConfirmDialog
        inline
        open={!!pending}
        title="调整全站预算"
        subject="全站账号的新付费派发"
        impact="立即按新上限校验后续调用；低于当前消费和风险时暂停新调用。"
        consequence="不撤销已发费用、不清消费和风险，不自动继续旧任务。追加用户额度仍受全站预算限制。"
        busy={busy}
        error={error}
        onCancel={() => setPending("")}
        onConfirm={async () => {
          const d = Number(daily) * 1000000,
            m = monthly.trim() ? Number(monthly) * 1000000 : null;
          if (
            !Number.isSafeInteger(d) ||
            d < 1 ||
            (m !== null && (!Number.isSafeInteger(m) || m < 1)) ||
            !reason.trim()
          ) {
            setError("请输入有效金额和调整原因");
            return;
          }
          setBusy(true);
          try {
            await api.changeBudget!(
              { dailyMicro: d, monthlyMicro: m, reason: reason.trim() },
              pending,
            );
            setPending("");
            retry();
          } catch (e) {
            setError(e instanceof Error ? e.message : "预算调整失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="每日上限（元）">
          <input
            value={daily}
            disabled={busy}
            onChange={(e) => {
              setDaily(e.target.value);
              setPending(newOperationId());
            }}
          />
        </Field>
        <Field label="月度上限（元，留空不设）">
          <input
            value={monthly}
            disabled={busy}
            onChange={(e) => {
              setMonthly(e.target.value);
              setPending(newOperationId());
            }}
          />
        </Field>
        <Field label="调整原因">
          <input
            value={reason}
            maxLength={200}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              setPending(newOperationId());
            }}
          />
        </Field>
      </ConfirmDialog>
    </section>
  );
}
