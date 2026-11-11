import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError, type AdminApi } from "./api";
import {
  formatBeijingTime,
  formatMicroYuan,
  formatRelative,
  newOperationId,
} from "./format";
import type { AdminUser, AdminUserDetail, AdminUserStatus } from "./api/types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Skeleton,
  StatusBadge,
  reportSessionExpired,
  useToast,
  type BadgeTone,
} from "./ui";

const USER_BADGE: Record<AdminUserStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: "ok", label: "正常" },
  "ai-paused": { tone: "warn", label: "AI 已暂停" },
  disabled: { tone: "muted", label: "已停用" },
};

type PendingAction =
  | { kind: "enabled"; user: AdminUserDetail; enabled: boolean }
  | { kind: "topup"; user: AdminUserDetail }
  | { kind: "ai"; user: AdminUserDetail; pause: boolean }
  | {
      kind: "revoke";
      user: AdminUserDetail;
      deviceId: string;
      deviceName: string;
    }
  | { kind: "reset"; user: AdminUserDetail };

/** 用户管理：列表 + 详情抽屉 + 四类敏感操作（追加额度/暂停恢复 AI/撤销设备/重置密码）。 */
export function UsersPage({ api }: { api: AdminApi }) {
  const toast = useToast();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<AdminUserStatus | "all">("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [list, setList] = useState<{
    items: AdminUser[];
    total: number;
  } | null>(null);
  const [listPhase, setListPhase] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [listError, setListError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailPhase, setDetailPhase] = useState<"closed" | "loading" | "error" | "ready">("closed");
  const [detailError, setDetailError] = useState<unknown>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const detailRequest = useRef(0);

  const [action, setAction] = useState<PendingAction | null>(null);
  const [actionOpId, setActionOpId] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [topupYuan, setTopupYuan] = useState("10");
  const [topupNote, setTopupNote] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [resetResult, setResetResult] = useState<{
    password: string;
    note: string;
  } | null>(null);

  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;

  const loadList = useCallback(async () => {
    setListPhase("loading");
    try {
      const result = await api.listUsers({
        keyword: keywordRef.current,
        status,
        page,
        pageSize,
      });
      setList({ items: result.items, total: result.total });
      setListPhase("ready");
    } catch (err) {
      reportSessionExpired(err);
      setListError(err);
      setListPhase("error");
    }
  }, [api, status, page, pageSize]);

  useEffect(() => {
    void loadList();
  }, [loadList, tick]);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setTick((x) => x + 1);
    }, 350);
    return () => clearTimeout(t);
  }, [keyword]);

  async function openDetail(user: AdminUser) {
    const requestId = ++detailRequest.current;
    setSelectedUser(user);
    setResetResult(null);
    setDetail(null);
    setDetailPhase("loading");
    try {
      const d = await api.getUserDetail(user.id);
      if (requestId !== detailRequest.current) return;
      setDetail(d);
      setDetailPhase("ready");
    } catch (err) {
      if (requestId !== detailRequest.current) return;
      reportSessionExpired(err);
      setDetailError(err);
      setDetailPhase("error");
    }
  }

  function closeDetail() {
    detailRequest.current += 1;
    setSelectedUser(null);
    setDetailPhase("closed");
    setDetail(null);
    setResetResult(null);
  }

  function beginAction(next: PendingAction) {
    setAction(next);
    setActionOpId(newOperationId()); // 同一对话框内重试复用，保证幂等
    setActionError(null);
    setTopupYuan("10");
    setTopupNote("");
    setPauseReason("");
  }

  function cancelAction() {
    if (actionBusy) return;
    setAction(null);
  }

  function applyDetail(next: AdminUserDetail) {
    setDetail(next);
    setList((l) =>
      l
        ? {
            ...l,
            items: l.items.map((u) =>
              u.id === next.id ? { ...u, ...next } : u,
            ),
          }
        : l,
    );
  }

  async function confirmAction() {
    if (!action || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (action.kind === "topup") {
        const yuan = Number(topupYuan);
        if (!Number.isFinite(yuan) || yuan <= 0) {
          setActionError("请输入大于 0 的金额（元）");
          setActionBusy(false);
          return;
        }
        const micro = Math.round(yuan * 1_000_000);
        const result = await api.topupQuota(
          action.user.id,
          micro,
          topupNote.trim(),
          actionOpId,
        );
        const refreshed = await api.getUserDetail(action.user.id);
        applyDetail(refreshed);
        toast(
          "ok",
          `已为 ${action.user.username} 追加额度 ${formatMicroYuan(micro)}，当前余额 ${formatMicroYuan(result.availableMicro)}`,
        );
      } else if (action.kind === "enabled") {
        if (!pauseReason.trim()) {
          setActionError("请填写账号状态调整原因");
          return;
        }
        const next = await api.setAccountEnabled!(
          action.user.id,
          action.enabled,
          pauseReason.trim(),
          actionOpId,
        );
        applyDetail(next);
        toast(
          "ok",
          next.status === "disabled" ? "账号当前已停用" : "账号当前已启用",
        );
      } else if (action.kind === "ai") {
        const next = await api.setAiPaused(
          action.user.id,
          action.pause,
          actionOpId,
          pauseReason.trim() || undefined,
        );
        applyDetail(next);
        toast(
          "ok",
          action.pause
            ? `已暂停 ${action.user.username} 的 AI（进度保留）`
            : `已恢复 ${action.user.username} 的 AI`,
        );
      } else if (action.kind === "revoke") {
        const next = await api.revokeDevice(
          action.user.id,
          action.deviceId,
          actionOpId,
        );
        applyDetail(next);
        toast("ok", `已撤销设备「${action.deviceName}」的登录态`);
      } else {
        const result = await api.resetPassword(action.user.id, actionOpId);
        if (result.temporaryPassword) {
          setResetResult({
            password: result.temporaryPassword,
            note: result.note,
          });
        }
        const refreshed = await api.getUserDetail(action.user.id);
        applyDetail(refreshed);
        toast("ok", `已重置 ${action.user.username} 的密码`);
      }
      setAction(null);
    } catch (err) {
      // 失败保留在对话框内，可用同一 operationId 安全重试
      reportSessionExpired(err);
      setActionError(
        err instanceof AdminApiError
          ? `${err.error}（${err.code}${err.retryable ? "，可重试" : "，请勿重复提交，先核实状态"}）`
          : "操作失败，请稍后重试",
      );
    } finally {
      setActionBusy(false);
    }
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / pageSize)) : 1;

  return (
    <>
      <header className="page-head">
        <h1>用户管理</h1>
        <p>额度以拾序平台账本为准；追加额度与供应商账户充值无关。</p>
      </header>

      <div className="toolbar" role="search">
        <input
          type="search"
          placeholder="按账号搜索…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="按账号搜索"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as AdminUserStatus | "all");
            setPage(1);
          }}
          aria-label="按状态筛选"
        >
          <option value="all">全部状态</option>
          <option value="active">正常</option>
          <option value="ai-paused">AI 已暂停</option>
          <option value="disabled">已停用</option>
        </select>
        {list && (
          <span className="sub" style={{ alignSelf: "center" }}>
            共 {list.total} 个账号
          </span>
        )}
      </div>

      {listPhase === "loading" && <Skeleton rows={6} height={26} />}
      {listPhase === "error" && (
        <ErrorState error={listError} onRetry={() => setTick((t) => t + 1)} />
      )}
      {listPhase === "ready" && list && list.items.length === 0 && (
        <EmptyState title="没有符合条件的账号" hint="调整搜索关键词或状态筛选后再试。" />
      )}
      {listPhase === "ready" && list && list.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>状态</th>
                  <th className="num">累计额度</th>
                  <th className="num">已消费</th>
                  <th className="num">预留中</th>
                  <th className="num">余额</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((u) => {
                  const badge = USER_BADGE[u.status];
                  return (
                    <tr
                      key={u.id}
                      tabIndex={0}
                      onClick={() => openDetail(u)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetail(u);
                        }
                      }}
                      aria-label={`查看 ${u.username} 详情`}
                    >
                      <td>
                        <span className="money-strong" style={{ fontFamily: "var(--font-num)" }}>
                          {u.username}
                        </span>
                        <span className="sub">{u.deviceCount} 台设备</span>
                      </td>
                      <td>
                        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                      </td>
                      <td className="num">{formatMicroYuan(u.grantedMicro)}</td>
                      <td className="num">{formatMicroYuan(u.spentMicro)}</td>
                      <td className="num">
                        {formatMicroYuan(u.reservedMicro)}
                      </td>
                      <td className="num money-strong">
                        {formatMicroYuan(u.availableMicro)}
                      </td>
                      <td
                        className="num"
                        style={{
                          fontFamily: "var(--font-body)",
                          color: "var(--muted)",
                          fontSize: 13,
                        }}
                      >
                        {formatRelative(u.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <span className="sub" style={{ alignSelf: "center" }}>
                {page} / {totalPages} 页
              </span>
              <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          )}
        </>
      )}

      {detailPhase !== "closed" && (
        <>
          <div className="drawer-backdrop" onClick={closeDetail} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="用户详情">
            {detailPhase === "loading" && (
              <>
                <Button variant="ghost" onClick={closeDetail}>关闭</Button>
                <Skeleton rows={6} height={24} />
              </>
            )}
            {detailPhase === "error" && (
              <>
                <ErrorState error={detailError} onRetry={() => selectedUser && openDetail(selectedUser)} />
                <Button variant="ghost" onClick={closeDetail}>
                  关闭
                </Button>
              </>
            )}
            {detailPhase === "ready" && detail && (
              <>
                <div className="drawer-head">
                  <div>
                    <h2>{detail.username}</h2>
                    <StatusBadge tone={USER_BADGE[detail.status].tone}>
                      {USER_BADGE[detail.status].label}
                    </StatusBadge>
                    {detail.aiPausedReason && (
                      <p className="sub">暂停原因:{detail.aiPausedReason}</p>
                    )}
                    <p className="sub">
                      注册于 {formatBeijingTime(detail.createdAt)}（北京时间）
                    </p>
                  </div>
                  <Button variant="ghost" onClick={closeDetail}>
                    关闭
                  </Button>
                </div>

                <h3 className="section-title">额度账本</h3>
                <div className="wallet-grid">
                  <div className="wallet-cell">
                    <span className="k">累计额度</span>
                    <div className="v">{formatMicroYuan(detail.grantedMicro)}</div>
                  </div>
                  <div className="wallet-cell">
                    <span className="k">已消费</span>
                    <div className="v">{formatMicroYuan(detail.spentMicro)}</div>
                  </div>
                  <div className="wallet-cell">
                    <span className="k">预留中（在途冻结）</span>
                    <div className="v">{formatMicroYuan(detail.reservedMicro)}</div>
                  </div>
                  <div className="wallet-cell">
                    <span className="k">可用余额</span>
                    <div className="v">{formatMicroYuan(detail.availableMicro)}</div>
                  </div>
                </div>
                <p className="wallet-note">费用不明风险预留：{formatMicroYuan(detail.unknownRiskMicro || 0)}。余额 = 累计额度 − 已消费 − 在途预留 − 费用不明风险。</p>

                {resetResult && (
                  <p className="login-notice" role="status">
                    临时密码：<code style={{ fontFamily: "var(--font-num)" }}>{resetResult.password}</code>
                    <br />
                    {resetResult.note}
                  </p>
                )}

                <h3 className="section-title">管理操作</h3>
                <div className="action-row">
                  {api.setAccountEnabled && (
                    <Button
                      onClick={() =>
                        beginAction({
                          kind: "enabled",
                          user: detail,
                          enabled: detail.status === "disabled",
                        })
                      }
                    >
                      {detail.status === "disabled" ? "启用账号" : "停用账号"}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => beginAction({ kind: "topup", user: detail })}
                  >
                    追加额度
                  </Button>
                  {(detail.personalAiPaused ?? detail.status === "ai-paused") ? (
                    <Button variant="ghost" onClick={() => beginAction({ kind: "ai", user: detail, pause: false })}>
                      恢复 AI
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={detail.status === "disabled"}
                      onClick={() => beginAction({ kind: "ai", user: detail, pause: true })}
                    >
                      暂停 AI
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => beginAction({ kind: "reset", user: detail })}
                  >
                    重置密码
                  </Button>
                </div>

                <ConfirmDialog
                  inline
                  open={action?.kind === "ai"}
                  title={
                    action?.kind === "ai" && action.pause
                      ? "暂停 AI"
                      : "恢复 AI"
                  }
                  subject={`账号 ${action?.kind === "ai" ? action.user.username : ""}`}
                  impact={
                    action?.kind === "ai" && action.pause
                      ? "阻止该账号后续新的付费模型派发，已发请求仍可能产生费用。"
                      : "恢复该账号的人工 AI 使用权限；其他暂停与安全门禁仍生效。"
                  }
                  consequence={
                    action?.kind === "ai" && action.pause
                      ? "暂停保留全部进度，可随时恢复；不影响其他账号。"
                      : "旧任务由用户主动继续；保留已消费记录和费用不明预留。"
                  }
                  confirmLabel={
                    action?.kind === "ai" && action.pause
                      ? "确认暂停"
                      : "确认恢复"
                  }
                  danger={action?.kind === "ai" && action.pause}
                  busy={actionBusy}
                  error={actionError}
                  onConfirm={confirmAction}
                  onCancel={cancelAction}
                >
                  {action?.kind === "ai" && action.pause && (
                    <Field label="暂停原因（写入审计）">
                      <input
                        value={pauseReason}
                        onChange={(e) => setPauseReason(e.target.value)}
                        disabled={actionBusy}
                        placeholder="例如：异常消费待核查"
                      />
                    </Field>
                  )}
                </ConfirmDialog>
                {/* ---- 敏感操作确认 ---- */}
                <ConfirmDialog
                  inline
                  open={action?.kind === "topup"}
                  title="追加额度"
                  subject={`账号 ${action?.kind === "topup" ? action.user.username : ""}`}
                  impact="增加该账号的拾序平台可用额度，立即可用于 AI 任务扣费。"
                  consequence="追加不清除已消费记录；与 DeepSeek 供应商账户充值无关。操作将记入审计，不能通过回滚资料撤销费用。"
                  confirmLabel="确认追加"
                  busy={actionBusy}
                  error={actionError}
                  onConfirm={confirmAction}
                  onCancel={cancelAction}
                >
                  <Field
                    label="追加金额（元）"
                    hint="按元输入，内部以整数微元记账。"
                  >
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={topupYuan}
                      onChange={(e) => setTopupYuan(e.target.value)}
                      disabled={actionBusy}
                    />
                  </Field>
                  <Field
                    label="备注（可选）"
                    hint="写入审计记录，便于日后核对。"
                  >
                    <input
                      value={topupNote}
                      onChange={(e) => setTopupNote(e.target.value)}
                      disabled={actionBusy}
                      placeholder="例如：用户反馈补发"
                    />
                  </Field>
                </ConfirmDialog>

                <ConfirmDialog
                  inline
                  open={action?.kind === "revoke"}
                  title="撤销设备登录"
                  subject={`账号 ${action?.kind === "revoke" ? action.user.username : ""} 的设备「${action?.kind === "revoke" ? action.deviceName : ""}」`}
                  impact="该设备的登录态立即失效，需重新登录才能继续同步。"
                  consequence="设备本机已保存的资料副本保留，不会被远程删除；操作记入审计。适用于用户设备丢失等协助场景。"
                  confirmLabel="确认撤销"
                  danger
                  busy={actionBusy}
                  error={actionError}
                  onConfirm={confirmAction}
                  onCancel={cancelAction}
                />

                <ConfirmDialog
                  inline
                  open={action?.kind === "reset"}
                  title="重置密码"
                  subject={`账号 ${action?.kind === "reset" ? action.user.username : ""}`}
                  impact="签发一次性临时密码；旧密码与该账号全部登录会话立即失效。"
                  consequence="用户需使用临时密码登录并立即修改。临时密码仅显示一次，请通过安全渠道告知用户；操作记入审计。"
                  confirmLabel="确认重置"
                  danger
                  busy={actionBusy}
                  error={actionError}
                  onConfirm={confirmAction}
                  onCancel={cancelAction}
                />
                <ConfirmDialog
                  inline
                  open={action?.kind === "enabled"}
                  title={
                    action?.kind === "enabled" && action.enabled
                      ? "启用账号"
                      : "停用账号"
                  }
                  subject={`账号 ${detail.username}`}
                  impact={
                    action?.kind === "enabled" && action.enabled
                      ? "恢复账号的普通访问权限；仍受个人/全站AI及费用安全门禁限制。"
                      : "立即拒绝该账号的后续访问；保留资料和费用，在途请求可能仍产生费用。"
                  }
                  consequence="不删除本机副本、云资料、费用或安全审计；重新启用后旧AI任务仍需主动继续。"
                  busy={actionBusy}
                  error={actionError}
                  onCancel={cancelAction}
                  onConfirm={confirmAction}
                >
                  <Field label="调整原因">
                    <input
                      maxLength={200}
                      value={pauseReason}
                      disabled={actionBusy}
                      onChange={(e) => {
                        setPauseReason(e.target.value);
                        setActionOpId(newOperationId());
                      }}
                    />
                  </Field>
                </ConfirmDialog>
                <h3 className="section-title">设备（撤销协助）</h3>
                {detail.devices.length === 0 ? (
                  <EmptyState title="暂无已绑定设备" />
                ) : (
                  detail.devices.map((d) => (
                    <div key={d.id} className="device-row">
                      <div className="meta">
                        {d.name}
                        <span className="sub">
                          {d.platform === "windows"
                            ? "Windows"
                            : d.platform === "wechat"
                              ? "微信小程序"
                              : "其他"}{" "}
                          · 最近活跃{" "}
                          {d.lastActiveAt
                            ? formatRelative(d.lastActiveAt)
                            : "未采集"}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          beginAction({
                            kind: "revoke",
                            user: detail!,
                            deviceId: d.id,
                            deviceName: d.name,
                          })
                        }
                      >
                        撤销登录
                      </Button>
                    </div>
                  ))
                )}

                <h3 className="section-title">最近管理操作（审计，受保护不可删）</h3>
                {detail.recentAudit.length === 0 ? (
                  <EmptyState title="暂无该用户的管理操作记录" />
                ) : (
                  detail.recentAudit.map((a) => (
                    <div key={a.id} className="audit-row">
                      <div className="meta">
                        {a.action}
                        <span className="sub">{a.detail}</span>
                        <span className="op">
                          {formatBeijingTime(a.at)} · {a.actor} ·{" "}
                          {a.operationId}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </aside>
        </>
      )}
    </>
  );
}
