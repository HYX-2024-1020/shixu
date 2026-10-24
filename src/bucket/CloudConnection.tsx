import { useEffect, useState } from "react";

export default function CloudConnection({
  canSwitch,
}: {
  canSwitch: () => boolean;
}) {
  const [base, setBase] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Awaited<
    ReturnType<NonNullable<Window["desktop"]>["cloud"]>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.desktop
      ?.cloud("status")
      .then((s) => {
        setStatus(s);
        setBase(s.base);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (!window.desktop) return null;
  async function action(name: string, value?: unknown, reload = false) {
    setBusy(true);
    setError("");
    try {
      if (reload) {
        if (!canSwitch())
          throw Error("正在投递或整理，请等待完成后切换资料空间");
        await window.flushDesktopDraft?.();
      }
      setStatus(await window.desktop!.cloud(name, value));
      setPassword("");
      if (reload) location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="connection-data cloud-connection"
      aria-label="云同步设置"
    >
      <h3>云同步</h3>
      <p>
        {status?.base
          ? `云端资料 · ${status.base} · ${status.pending} 个待同步操作`
          : "正在使用本机资料"}
      </p>
      <p>
        连接后打开独立云端空间。本机投递和草稿保留，不会自动上传。两端使用同一个服务地址与访问口令。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action("connect", { base, password }, true);
        }}
      >
        <label>
          同步服务地址
          <input
            aria-label="同步服务地址"
            placeholder="https://你的同步域名"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            required
          />
        </label>
        <label>
          同步访问口令
          <input
            aria-label="同步访问口令"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button disabled={busy} type="submit">
          连接云端资料
        </button>
      </form>
      {status?.base && (
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
          <p>
            设备授权由 Windows
            加密保存。离线操作留在本机，恢复网络后重试；云端空间的本机备份与自动清理尚未开放。
          </p>
        </>
      )}
      {status?.conflicts.map((c) => (
        <div key={c.id}>
          <p>有同步冲突：{c.text.slice(0, 80)}</p>
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
      {(error || status?.error) && (
        <p role="alert">{error || status?.error}；未同步内容仍保留在本机。</p>
      )}
    </section>
  );
}
