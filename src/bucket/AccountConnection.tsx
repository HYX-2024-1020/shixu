import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
    [state, setState] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    void window
      .desktop!.cloud("status")
      .then(setState)
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
      if (reload) location.reload();
    } catch (e) {
      setError((e as Error).message);
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
            ? "设备授权失效，本地缓存保留；请联系管理员恢复。"
            : state?.base
              ? "此设备凭证已保存，日常使用无需再次输入邀请码。"
              : "当前使用本机资料；无需激活也能记录、查看和手动管理事项。"}
        </p>
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
          <button className="bucket-primary" disabled={busy || !invite.trim()}>
            激活此设备
          </button>
        </form>
        {!state?.base && (
          <button
            disabled={busy}
            onClick={() => void action("resume", undefined, true)}
          >
            返回已激活账号
          </button>
        )}
        <p>
          一个邀请码绑定一台 Windows
          安装和一个微信身份。换机或重装后丢失凭证，请联系管理员重置。
        </p>
      </section>
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
          {!state?.base
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
