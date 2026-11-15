import { useEffect, useMemo, useRef, useState } from "react";
import { RealBoardAdapter } from "./adapter";
import { BoardProvider, useBoard } from "./components/BoardProvider";
import { StripBoard } from "./components/StripBoard";
import { RailBoard } from "./components/RailBoard";
import { LibraryPanel } from "./components/LibraryPanel";
import { DdlPanel } from "./components/DdlPanel";
import { PlanningManager } from "./components/PlanningManager";
import { BoardTrash } from "./components/BoardTrash";
import type { BoardMode } from "./types/board";
import "./styles/board.css";
import "./host.css";
const entries = [
  ["strip", "小条"],
  ["rail", "窄栏"],
  ["panel", "面板"],
  ["ddl", "DDL"],
] as const;
function Contents({ floating }: { floating: boolean }) {
  const { snapshot, saveState, retrySave, reload } = useBoard();
  const host = window.boardHost || window.desktop?.board;
  const [mode, setMode] = useState<BoardMode>("rail");
  const [settings, setSettings] = useState({
    locked: false,
    top: true,
    density: "compact",
    opacity: 1,
    restore: false,
  });
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host) return;
    const refresh = () =>
      void host
        .invoke("windowState")
        .then((v) => {
          setSettings(v);
          setMode(v.mode);
        })
        .catch((e) => setError(e.message));
    refresh();
    return host.onChanged(refresh);
  }, [host]);
  const configure = async (value: Record<string, unknown>) => {
    try {
      const v = await host!.invoke("configureWindow", value);
      setSettings(v);
      setMode(v.mode);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "窗口设置失败");
    }
  };
  useEffect(() => {
    if (!floating || !root.current || mode !== "strip" || !host) return;
    const observer = new ResizeObserver(() => {
      const h = Math.ceil(root.current!.scrollHeight);
      void host.invoke("stripHeight", { height: h }).catch(() => {});
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [floating, host, mode]);
  const exportUnsaved = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "拾序看板未保存副本.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return (
    <div
      ref={root}
      className={`sx-board sx-host ${floating ? "sx-floating" : ""} sx-density-${settings.density} sx-mode-${mode}`}
    >
      <div
        className="sx-host-controls"
        hidden={floating && mode === "strip" && !menu}
      >
        <nav aria-label="看板四入口">
          {entries.map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={mode === id}
              onClick={() => {
                setMode(id);
                if (host) void configure({ mode: id });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <details className="sx-host-options">
          <summary>窗口与规划</summary>
          <PlanningManager />
          <BoardTrash />
          {host ? (
            <>
              {!floating ? (
                <button
                  type="button"
                  onClick={() =>
                    void host.invoke("show").catch((e) => setError(e.message))
                  }
                >
                  继续上次 / 打开悬浮看板
                </button>
              ) : (
                <button type="button" onClick={() => void host.invoke("hide")}>
                  隐藏看板
                </button>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={settings.top}
                  onChange={(e) => void configure({ top: e.target.checked })}
                />
                置顶
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.locked}
                  onChange={(e) => void configure({ locked: e.target.checked })}
                />
                锁定位置与尺寸
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.restore}
                  onChange={(e) =>
                    void configure({ restore: e.target.checked })
                  }
                />
                启动时恢复看板
              </label>
              <label>
                密度
                <select
                  value={settings.density}
                  onChange={(e) => void configure({ density: e.target.value })}
                >
                  <option value="compact">紧凑</option>
                  <option value="comfortable">舒适</option>
                </select>
              </label>
              <label>
                纸面透明度
                <input
                  type="range"
                  min="0.65"
                  max="1"
                  step="0.05"
                  value={settings.opacity}
                  onChange={(e) =>
                    void configure({ opacity: Number(e.target.value) })
                  }
                />
              </label>
              <small>
                Ctrl+Alt+B
                显示或隐藏；标题条可拖动，屏幕边缘可停靠。文字始终不透明。
              </small>
              {'shortcutAvailable' in settings && settings.shortcutAvailable===false?<small role="status">快捷键被其他程序占用，请通过主程序打开看板。</small>:null}
            </>
          ) : (
            <small>浏览器使用本机保存；悬浮窗口请在 Windows 客户端打开。</small>
          )}
        </details>
      </div>
      {error ? <div role="alert">{error}</div> : null}
      <div
        className="sx-host-status"
        hidden={
          floating && mode === "strip" && !menu && saveState.phase !== "error"
        }
        role="status"
      >
        {saveState.message}
        {saveState.phase === "error" ? (
          <>
            <button type="button" onClick={retrySave}>
              重试保存
            </button>
            <button type="button" onClick={exportUnsaved}>
              导出未保存副本
            </button>
            <button
              type="button"
              onClick={() => {
                exportUnsaved();
                reload();
              }}
            >
              保留副本并重新读取
            </button>
          </>
        ) : null}
      </div>
      <div
        style={
          { "--sx-surface-opacity": settings.opacity } as React.CSSProperties
        }
      >
        <div hidden={mode !== "strip"}>
          <StripBoard onMenu={floating ? () => setMenu(!menu) : undefined} />
        </div>
        <div hidden={mode !== "rail"}>
          <RailBoard />
        </div>
        <div hidden={mode !== "panel"}>
          <LibraryPanel />
        </div>
        <div hidden={mode !== "ddl"}>
          <DdlPanel />
        </div>
      </div>
    </div>
  );
}
export default function BoardApp({
  onSource,
}: {
  onSource?: (id: string) => void;
}) {
  const [resource, setResource] = useState<{
    name: string;
    type: string;
    bytes: ArrayBuffer;
  } | null>(null);
  const adapter = useMemo(
    () => new RealBoardAdapter((id) => onSource?.(id), setResource),
    [onSource],
  );
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!resource) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(
      new Blob([resource.bytes], { type: resource.type }),
    );
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [resource]);
  return (
    <>
      <BoardProvider adapter={adapter}>
        <Contents floating={!!window.boardHost} />
      </BoardProvider>
      {resource ? (
        <section className="sx-file-view" aria-label="看板原件预览">
          <header>
            <strong>{resource.name}</strong>
            <button type="button" onClick={() => setResource(null)}>
              关闭预览
            </button>
          </header>
          {/^image\/(png|jpeg|webp|gif)$/.test(resource.type) ? (
            <img src={url} alt={resource.name} />
          ) : resource.type === "application/pdf" ? (
            <iframe sandbox="" src={url} title={resource.name} />
          ) : (
            <p>此格式不内嵌执行，可另存原件后用受信任的应用打开。</p>
          )}
          <a href={url} download={resource.name}>
            另存原件
          </a>
        </section>
      ) : null}
    </>
  );
}
