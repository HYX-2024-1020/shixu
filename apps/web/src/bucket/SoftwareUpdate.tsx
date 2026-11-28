import { useEffect, useState } from "react";

export default function SoftwareUpdate() {
  const [status, setStatus] = useState<DesktopUpdateStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const update = window.desktop?.update;

  useEffect(() => {
    if (!update) return;
    let active = true;
    const read = () =>
      void update("status").then(
        (result) => {
          if (active) setStatus(result);
        },
        () => {
          if (active) setError("暂时无法读取更新状态");
        },
      );
    read();
    const waiting =
      status?.phase === "checking" ||
      status?.phase === "downloading" ||
      status?.phase === "installing";
    const timer =
      pending || waiting ? window.setInterval(read, 500) : undefined;
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [update, pending, status?.phase]);

  async function run(action: "check" | "download" | "install") {
    if (!update || pending) return;
    setError("");
    setPending(true);
    try {
      setStatus(await update(action));
    } catch {
      setError("更新操作未完成，请重试");
    } finally {
      setPending(false);
    }
  }

  const phase = status?.phase;
  const progress = status?.progress ?? 0;
  return (
    <section className="connection-data" aria-label="软件更新">
      <h3>软件更新</h3>
      {status && <p>当前版本 {status.version}</p>}
      <div role="status">
        {(error || status?.error) && <p>{error || status?.error}</p>}
        {phase === "unavailable" && <p>Windows x64 安装版支持软件内更新。</p>}
        {phase === "current" && <p>已是最新版本。</p>}
        {phase === "checking" && <p>正在检查更新…</p>}
        {phase === "available" && <p>发现新版本 {status?.available}</p>}
        {phase === "downloading" && (
          <p>
            正在下载 {status?.available}
            {progress > 0 && ` · ${progress}%`}
          </p>
        )}
        {phase === "ready" && (
          <p>
            版本 {status?.available} 已下载并校验。安装前会保存草稿并退出拾序。
          </p>
        )}
        {phase === "installing" && <p>正在打开安装程序…</p>}
      </div>
      {(phase === "idle" || phase === "current" || (!phase && error)) && (
        <button disabled={pending} onClick={() => void run("check")}>
          检查更新
        </button>
      )}
      {phase === "available" && (
        <button disabled={pending} onClick={() => void run("download")}>
          下载更新
        </button>
      )}
      {phase === "ready" && (
        <button disabled={pending} onClick={() => void run("install")}>
          退出并安装
        </button>
      )}
    </section>
  );
}
