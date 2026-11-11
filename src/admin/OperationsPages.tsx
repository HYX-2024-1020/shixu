import { useEffect, useState } from "react";
import type { AdminApi } from "./api";
import { formatBeijingTime, newOperationId } from "./format";
import { Button, ConfirmDialog, ErrorState, Field, useAsyncData } from "./ui";

const mb = (n: number) => (n / 1048576).toFixed(2) + " MiB";
const labels: Record<string, string> = {
  backup: "立即备份",
  restore: "恢复所选备份",
  cleanup: "清理已到期资料 / 回收空闲页",
  restart: "重启拾序服务",
  rollback: "切换所选兼容发布",
  resume: "恢复上传与 AI 的维护权限",
};
const states: Record<string, string> = {
  queued: "等待后台执行",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
};

export function OperationsPanel({
  api,
  storage = false,
}: {
  api: AdminApi;
  storage?: boolean;
}) {
  const { state, retry } = useAsyncData(
    () =>
      api.getOperations
        ? api.getOperations()
        : Promise.reject(
            Error("当前为演示模式，请连接真实管理服务查看运维状态"),
          ),
    [api],
    true,
  );
  const [selectedSnapshot, setSnapshot] = useState(""),
    [selectedRelease, setRelease] = useState(""),
    [reason, setReason] = useState("");
  const [pending, setPending] = useState<{
      kind: string;
      id: string;
      target?: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [submitted, setSubmitted] = useState("");
  useEffect(() => {
    const timer = setInterval(retry, 5000);
    return () => clearInterval(timer);
  }, [retry]);
  const begin = (kind: string, target?: string) => {
    setPending({ kind, id: newOperationId(), target });
    setReason("");
    setError("");
    setSubmitted("");
  };
  return (
    <section className="panel">
      <h2>{storage ? "备份与恢复" : "服务运维"}</h2>
      {state.phase === "loading" && <p role="status">正在读取维护状态…</p>}
      {state.phase === "error" && (
        <ErrorState error={state.error} onRetry={retry} />
      )}
      {state.phase === "ready" && (
        <>
          <p>
            {state.data.maintenance.paused
              ? "新增上传 / AI 已因维护暂停"
              : "维护门禁开放"}{" "}
            · {state.data.maintenance.reason || "无维护原因"}
          </p>
          {!state.data.inventory ? (
            <p role="alert">
              尚未取得运维执行器回执，不能据此认定定时备份和部署管理已就绪。
            </p>
          ) : (
            <>
              <p>
                实际云发布：<code>{state.data.inventory.releaseId}</code> ·
                采集于 {formatBeijingTime(state.data.inventory.sampledAt)}
              </p>
              {storage ? (
                <>
                  <p>
                    每天北京时间04:00一致备份，最近2份成功备份，每份最长7天；同机保存，不下载到本机。恢复保留当前可信账号、费用、安全链和审计，旧资料不复活已删内容或旧凭据。无法可靠核对则拒绝恢复。
                  </p>
                  <Button onClick={() => begin("backup")}>
                    {labels.backup}
                  </Button>{" "}
                  <Button onClick={() => begin("cleanup")}>
                    {labels.cleanup}
                  </Button>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>备份</th>
                          <th>创建 / 到期（北京时间）</th>
                          <th>验证</th>
                          <th>规模</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.data.inventory.snapshots.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <code>{s.id}</code>
                            </td>
                            <td>
                              {s.createdAt
                                ? formatBeijingTime(s.createdAt)
                                : "待核对"}
                              <br />
                              {s.expiresAt
                                ? formatBeijingTime(s.expiresAt)
                                : "待核对"}
                            </td>
                            <td>
                              {s.available
                                ? "创建时校验通过；恢复前复核"
                                : s.code || "不可恢复 / 已到期"}
                            </td>
                            <td>
                              {s.databases ?? "待核对"} 库 ·{" "}
                              {s.bytes === undefined ? "待核对" : mb(s.bytes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {state.data.inventory.snapshots.some((s) => s.available) ? (
                    <div className="toolbar">
                      <select
                        aria-label="恢复备份"
                        value={selectedSnapshot}
                        onChange={(e) => setSnapshot(e.target.value)}
                      >
                        <option value="">选择备份</option>
                        {state.data.inventory.snapshots
                          .filter((s) => s.available)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id}
                            </option>
                          ))}
                      </select>
                      <Button
                        disabled={!selectedSnapshot}
                        onClick={() => begin("restore", selectedSnapshot)}
                      >
                        {labels.restore}
                      </Button>
                    </div>
                  ) : (
                    <p>当前没有通过验证且未到期的备份。</p>
                  )}
                </>
              ) : (
                <>
                  <p>
                    仅管理拾序应用服务及经过校验的发布。阿里云实例开关机、重装、续费及购买仍使用阿里云官方控制台。
                  </p>
                  <Button onClick={() => begin("restart")}>
                    {labels.restart}
                  </Button>{" "}
                  {state.data.maintenance.paused && (
                    <Button onClick={() => begin("resume")}>
                      {labels.resume}
                    </Button>
                  )}
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>已安装发布</th>
                          <th>来源</th>
                          <th>兼容性</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.data.inventory.releases.map((r) => (
                          <tr key={r.id}>
                            <td>{r.id}</td>
                            <td>
                              <code>{r.source}</code>
                            </td>
                            <td>
                              {r.ledgerCoreVersion >= 8
                                ? "支持当前账本门禁"
                                : "未通过当前成品或账本门禁，不允许切换"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {state.data.inventory.releases.some(
                    (r) =>
                      r.ledgerCoreVersion >= 8 &&
                      r.id !== state.data.inventory!.releaseId,
                  ) ? (
                    <div className="toolbar">
                      <select
                        aria-label="切换发布"
                        value={selectedRelease}
                        onChange={(e) => setRelease(e.target.value)}
                      >
                        <option value="">选择兼容发布</option>
                        {state.data.inventory.releases
                          .filter(
                            (r) =>
                              r.ledgerCoreVersion >= 8 &&
                              r.id !== state.data.inventory!.releaseId,
                          )
                          .map((r) => (
                            <option key={r.id}>{r.id}</option>
                          ))}
                      </select>
                      <Button
                        disabled={!selectedRelease}
                        onClick={() => begin("rollback", selectedRelease)}
                      >
                        {labels.rollback}
                      </Button>
                    </div>
                  ) : (
                    <p>
                      没有其他兼容发布。部署工具会校验固定包、保留当前发布，并在启动验证失败时尝试恢复原兼容程序；费用和安全记录不回滚。
                    </p>
                  )}
                </>
              )}
            </>
          )}
          <h3>维护执行记录</h3>
          <p>
            提交只表示进入维护队列；以下执行回执决定是否完成。失败后保留维护原因，可核对后手动恢复。
          </p>
          {state.data.jobs
            .filter((j) =>
              storage
                ? ["backup", "restore", "cleanup"].includes(j.kind)
                : true,
            )
            .map((j) => (
              <article className="audit-row" key={j.id}>
                <strong>
                  {labels[j.kind] || j.kind} · {states[j.state] || j.state}
                </strong>
                <p>
                  {j.code} · {j.actor} · {formatBeijingTime(j.updatedAt)}
                </p>
                <code>{j.id}</code>
              </article>
            ))}
        </>
      )}
      {submitted && <p role="status">{submitted}</p>}
      <ConfirmDialog
        inline
        open={!!pending}
        title={pending ? labels[pending.kind] : ""}
        subject={pending?.target || "当前拾序云服务"}
        impact={
          pending?.kind === "resume"
            ? "重新开放维护权限；费用、账号暂停和安全门禁仍独立生效。"
            : "暂停新的上传与AI，服务可能暂时中断；已发请求按可信结果结算。"
        }
        consequence={
          pending?.kind === "restore"
            ? "恢复备份所含账号的业务资料，备份后的正文和事项编辑可能回退；保留当前可信账号及独立账本/安全链，不在快照中的后建账号保留现有资料。更换资料代次并要求重新同步，证据不足保持关闭。"
            : pending?.kind === "cleanup"
              ? "只按既定期限清理已到期资料和备份，回收可复用页；不提前删除未到期原件，不删除安全审计。"
              : "保留用户资料、账本和审计；旧任务仍需用户主动继续。失败保持上传/AI暂停并展示原因。"
        }
        busy={busy}
        error={error}
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending || !reason.trim()) {
            setError("请填写操作原因");
            return;
          }
          setBusy(true);
          try {
            const result = await api.requestOperation!(
              pending.kind,
              {
                reason: reason.trim(),
                ...(pending.kind === "restore"
                  ? { snapshotId: pending.target }
                  : {}),
                ...(pending.kind === "rollback"
                  ? { releaseId: pending.target }
                  : {}),
              },
              pending.id,
            );
            setSubmitted(
              `维护请求 ${result.id} 已提交，当前状态：${states[result.state] || result.state}。`,
            );
            setPending(null);
            retry();
          } catch (e) {
            setError(e instanceof Error ? e.message : "提交失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="操作原因（不含密码或资料正文）">
          <input
            maxLength={200}
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              if (pending) setPending({ ...pending, id: newOperationId() });
            }}
          />
        </Field>
      </ConfirmDialog>
    </section>
  );
}

export function StoragePage({ api }: { api: AdminApi }) {
  const { state, retry } = useAsyncData(
    () =>
      api.getStorage
        ? api.getStorage()
        : Promise.reject(Error("演示模式不提供真实存储统计")),
    [api],
  );
  return (
    <>
      <section className="panel">
        <h1>存储与备份</h1>
        <p>
          逻辑原件额度、空闲页和物理磁盘占用分别统计。管理端不展示用户正文、文件名或下载入口。
        </p>
        <Button onClick={retry}>刷新存储</Button>
        {state.phase === "loading" && <p>正在读取存储…</p>}
        {state.phase === "error" && (
          <ErrorState error={state.error} onRetry={retry} />
        )}
        {state.phase === "ready" && (
          <>
            <p>
              云端逻辑原件 {mb(state.data.usedBytes)} · 账号数据库及WAL{" "}
              {mb(state.data.physicalBytes)} · 可复用空闲页{" "}
              {mb(state.data.freePageBytes)}
            </p>
            <p>采样：{formatBeijingTime(state.data.sampledAt)}</p>
            {state.data.categories && (
              <p>
                资料目录（含待退役副本）{" "}
                {mb(state.data.categories.dataTreeBytes)} · 独立账本 / 审计{" "}
                {mb(state.data.categories.authorityBytes)} · 备份{" "}
                {mb(state.data.categories.backupBytes)} · 读取临时目录{" "}
                {mb(state.data.categories.temporaryBytes)} · 主机系统日志{" "}
                {mb(state.data.categories.systemJournalBytes)}
                。目录统计与表内逻辑额度不可相加。
              </p>
            )}
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>逻辑原件 / 上传预留</th>
                    <th>物理 / 空闲页</th>
                    <th>生命周期统计</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.users.map((u) => (
                    <tr key={u.accountId}>
                      <td>{u.username}</td>
                      <td>
                        {mb(u.usedBytes)} / {mb(u.reservedBytes)}
                      </td>
                      <td>
                        {mb(u.physicalBytes)} / {mb(u.freePageBytes)}
                        <br />
                        {u.autoVacuum === 2
                          ? "增量页回收"
                          : "维护时按空间检查启用页回收"}
                      </td>
                      <td>
                        {u.available
                          ? u.originals.map((o) => (
                              <p key={o.state}>
                                {o.state} · {o.count}份 · {mb(o.bytes)}
                              </p>
                            ))
                          : "尚无资料库"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <OperationsPanel api={api} storage />
    </>
  );
}
