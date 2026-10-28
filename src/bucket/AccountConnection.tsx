import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { walletView } from "../../shared/reading-view.mjs";
type State = Awaited<ReturnType<NonNullable<Window["desktop"]>["cloud"]>>;
export default function AccountConnection({
  canSwitch,
  onClose,
  notify,
}: {
  canSwitch: () => boolean;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [invite, setInvite] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [deviceName, setDeviceName] = useState("这台 Windows"),
    [state, setState] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    void window
      .desktop!.cloud("capabilities")
      .then((value) => {
        setState(value);
        setUsername(value.account?.authentication?.username || "");
      })
      .catch((e) => setError(e.message));
    return () => ref.current?.close();
  }, []);
  async function action(name: string, value?: unknown, reload = false) {
    setBusy(true);
    setError("");
    try {
      if (reload) {
        if (!canSwitch()) throw Error("请等待当前投递或对话完成");
        await window.flushDesktopDraft?.();
      }
      setState(await window.desktop!.cloud(name, value));
      setInvite("");
      setPassword("");
      setNewPassword("");
      if (reload) location.reload();
    } catch (e) {
      setError((e as Error).message);
      setState(await window.desktop!.cloud("status"));
    } finally {
      setBusy(false);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const used =
    state?.account?.ai.usage.find((u) => u.day === today)?.requests || 0;
  return (
    <dialog
      ref={ref}
      className="bucket-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <div>
          <span className="dialog-kicker">拾序朋友内测</span>
          <h2>激活与设置</h2>
        </div>
        <button aria-label="关闭设置" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <section className="connection-data">
        <h3>账号激活</h3>
        <p>
          {state?.activation === "invalid"
            ? state?.capabilities?.features.registration
              ? "设备授权失效，本地缓存保留；请使用账号密码重新登录。"
              : "设备授权失效，本地缓存保留；请联系管理员恢复。"
            : state?.base
              ? "此设备凭证已保存，日常使用无需再次输入邀请码。"
              : "当前使用本机资料；无需激活也能记录、查看和手动管理事项。"}
        </p>
        {state?.capabilities?.features.registration ? (
          <div>
            <label>
              账号名称
              <input
                aria-label="账号名称"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={20}
                autoComplete="username"
              />
            </label>
            <label>
              登录密码
              <input
                aria-label="登录密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label>
              注册邀请码
              <input
                aria-label="注册邀请码"
                type="password"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              disabled={busy || !username || password.length < 8 || !invite}
              onClick={() =>
                void action(
                  "register",
                  { username, password, invite, deviceName },
                  true,
                )
              }
            >
              注册新账号
            </button>
            <button
              disabled={busy || !username || !password}
              onClick={() =>
                void action("login", { username, password, deviceName }, true)
              }
            >
              账号登录
            </button>
            {state.account?.authentication?.claimed === false && (
              <button
                disabled={busy || !username || password.length < 8}
                onClick={() => void action("claim", { username, password })}
              >
                为旧账号补设账号密码
              </button>
            )}
            {state.loginDevices?.map((device) => (
              <div key={device.id}>
                <p>
                  {device.name} · {device.kind} · 槽位 {device.slot} · 最近活跃{" "}
                  {new Date(device.lastSeen).toLocaleString()}
                </p>
                <button
                  disabled={busy || !password}
                  onClick={() => {
                    if (
                      confirm(
                        "替换后这台旧设备将立即失去云端访问权限，本地副本保留。继续？",
                      )
                    )
                      void action(
                        "login",
                        {
                          username,
                          password,
                          deviceName,
                          replaceBindingId: device.id,
                        },
                        true,
                      );
                  }}
                >
                  替换这台设备并登录
                </button>
              </div>
            ))}
            <label>
              设备名称
              <input
                aria-label="设备名称"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                maxLength={80}
              />
            </label>
            <p>邀请码仅用于首次注册；同一账号最多3台Windows和1个微信身份。</p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action("activate", { invite }, true);
            }}
          >
            <label>
              邀请码
              <input
                aria-label="邀请码"
                type="password"
                autoComplete="off"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <button
              className="bucket-primary"
              disabled={busy || !invite.trim()}
            >
              激活此设备
            </button>
          </form>
        )}
        {!state?.base && (
          <button
            disabled={busy}
            onClick={() => void action("resume", undefined, true)}
          >
            返回已激活账号
          </button>
        )}
        {!state?.capabilities?.features.registration && (
          <p>
            一个邀请码绑定一台 Windows
            安装和一个微信身份。换机或重装后丢失凭证，请联系管理员重置。
          </p>
        )}
      </section>
      {!!state?.account?.authentication?.claimed && (
        <section className="connection-data">
          <h3>设备与密码</h3>
          {state.devices?.map((device) => (
            <div key={device.id}>
              <p>
                {device.name} · {device.kind} · 槽位 {device.slot} · 最近活跃{" "}
                {new Date(device.lastSeen).toLocaleString()}
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "撤销后该设备不能继续访问云端，本地副本保留。继续？",
                    )
                  )
                    void action("revokeDevice", { id: device.id });
                }}
              >
                撤销设备
              </button>
            </div>
          ))}
          <label>
            新密码
            <input
              aria-label="新密码"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <p>上方“登录密码”填写当前密码。</p>
          <button
            disabled={busy || !password || newPassword.length < 8}
            onClick={() =>
              void action("password", {
                oldPassword: password,
                newPassword,
                revokeAll: true,
              })
            }
          >
            修改密码并撤销全部设备
          </button>
        </section>
      )}
      <section className="connection-data">
        <h3>同步</h3>
        <p>
          {state?.base
            ? `${state.pending} 个操作待同步${state.error ? " · 暂时未连接，队列保留" : " · 云空间已打开"}`
            : "本机空间，不自动上传"}
        </p>
        {state?.base && (
          <>
            <button disabled={busy} onClick={() => void action("sync")}>
              立即同步
            </button>
            <button
              disabled={busy}
              onClick={() => void action("local", undefined, true)}
            >
              切回本机资料
            </button>
          </>
        )}
        <p>
          激活会打开独立账号空间；原本机投递和草稿保留。同步会将云空间的原文、事项和原件上传到我们的服务器。
        </p>
        {state?.conflicts.map((c) => (
          <div key={c.id}>
            <p>同步冲突：{c.text.slice(0, 80)}</p>
            <button
              disabled={busy}
              onClick={() => void action("resolve", { id: c.id, keep: true })}
            >
              另存本机副本
            </button>
            <button
              disabled={busy}
              onClick={() => void action("resolve", { id: c.id, keep: false })}
            >
              采用云端版本
            </button>
          </div>
        ))}
      </section>
      <section className="connection-data">
        <h3>服务端 AI</h3>
        <p>
          {state?.account?.reading
            ? walletView(state.account.wallet)
            : !state?.base
              ? "未激活"
              : !state.account
                ? "状态尚未刷新"
                : !state.account.ai.enabled
                  ? "服务端暂未启用"
                  : used >= state.account.ai.dailyLimit
                    ? "今日额度已用完；记录和同步仍可用"
                    : `今日 ${used} / ${state.account.ai.dailyLimit} 次（UTC 零点重置）`}
        </p>
        <p>
          密钥和模型由服务端管理。使用 AI 时，相关文字及支持读取的 UTF-8
          原件会发送给模型服务商；图片、PDF 等原件尚不支持 AI
          读取。资料经过服务器和服务商，统一密钥不代表没有隐私风险。
        </p>
      </section>
      {!!state?.account?.reading && (
        <section className="connection-data">
          <h3>整理任务</h3>
          <p>
            停止保留有效付费块；继续需原件一致。清除任务不会退回已消费额度。
          </p>
          {state.jobs?.map((task) => (
            <div key={task.id}>
              <p>
                {(
                  {
                    queued: "排队中",
                    running: "处理中",
                    applying: "发布中",
                    paused: "已暂停",
                    cancelled: "已停止",
                    interrupted: "已中断",
                    done: "已发布",
                    partial: "已收下部分",
                    purged: "已清除",
                  } as Record<string, string>
                )[task.state] || "需核对"}{" "}
                · 已调用 {task.calls || 0} 次 {task.error}
              </p>
              {task.actions
                ?.filter((a) => a !== "purge")
                .map((a) => (
                  <button
                    key={a}
                    disabled={busy}
                    onClick={() =>
                      void action("taskAction", { id: task.id, action: a })
                    }
                  >
                    {a === "stop"
                      ? "停止"
                      : a === "accept-partial"
                        ? "收下有效部分"
                        : "继续"}
                  </button>
                ))}
              {task.actions?.includes("purge") && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "清除任务将丢弃可复用块，已发布事项和已消费额度保留。继续？",
                      )
                    )
                      void action("taskAction", {
                        id: task.id,
                        action: "purge",
                      });
                  }}
                >
                  清除任务
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="connection-data">
        <h3>本机备份</h3>
        <button
          disabled={busy || !!state?.base}
          onClick={async () => {
            try {
              await window.flushDesktopDraft?.();
              notify(await window.desktop!.backup("export"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          备份全部资料（含草稿、最近删除与原件）
        </button>
        <button
          disabled={busy || !!state?.base}
          onClick={async () => {
            try {
              const result = await window.desktop!.backup("import");
              notify(result);
              if (result.startsWith("恢复完成")) location.reload();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          从备份恢复
        </button>
        <p>切回本机空间后可备份或恢复本机资料；账号服务器由管理员独立备份。</p>
      </section>
      {(error || state?.error) && (
        <p role="alert">{error || state?.error}；本地资料与待同步操作保留。</p>
      )}
    </dialog>
  );
}
