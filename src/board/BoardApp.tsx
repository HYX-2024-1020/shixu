import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Pin, X, PanelsTopLeft } from "lucide-react";
import { RealBoardAdapter } from "./adapter";
import {
  BoardProvider,
  useBoard,
  useBoardDraft,
} from "./components/BoardProvider";
import { StripBoard, StripSettings } from "./components/StripBoard";
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
  const [expanded, setExpanded] = useBoardDraft("strip-expanded", "false");
  const [settings, setSettings] = useState({
    locked: false,
    top: true,
    density: "compact",
    opacity: 1,
    restore: false,
    fontSize: 14,
    zoom: 1,
    shortcutAvailable: true,
  });
  const [error, setError] = useState("");
  const stripNeedsSpace =
    expanded === "true" || Boolean(error) || saveState.phase === "error";
  const [windowMode, setWindowMode] = useState<BoardMode>("rail");
  useEffect(() => {
    if (!host) return;
    let active = true;
    let initialized = false;
    const refresh = () =>
      void host
        .invoke("windowState")
        .then((value) => {
          if (!active) return;
          setSettings(value);
          setWindowMode(value.mode);
          if (!initialized && !floating) setMode(value.mode);
          initialized = true;
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    refresh();
    const unsubscribe = host.onChanged(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [host, floating]);
  const view = floating ? windowMode : mode;
  const act = (action: string, value?: unknown) =>
    host?.invoke(action, value).catch((e) => setError(e.message));
  const configure = async (value: Record<string, unknown>) => {
    try {
      const v = await host!.invoke("configureWindow", value);
      setSettings(v);

      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "窗口设置失败");
    }
  };
  useEffect(() => {
    if (!floating) return;
    document.documentElement.classList.add("sx-board-window");
    return () => document.documentElement.classList.remove("sx-board-window");
  }, [floating]);
  useEffect(() => {
    if (floating && view === "strip") {
      void host
        ?.invoke("stripExpanded", { expanded: stripNeedsSpace })
        .catch((e) => setError(e.message));
    }
  }, [floating, host, view, stripNeedsSpace]);
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
  const content = (
    <div
      className={`sx-board sx-host ${floating ? "sx-floating" : ""} sx-density-${settings.density} sx-mode-${view}`}
      style={
        {
          "--sx-surface-opacity": settings.opacity,
          "--sx-zoom": floating ? settings.zoom : 1,
          "--sx-content-font": `${settings.fontSize}px`,
        } as React.CSSProperties
      }
    >
      {floating ? (
        <header className="sx-float-bar">
          {view === "strip" ? (
            <button
              type="button"
              aria-expanded={expanded === "true"}
              aria-label={expanded === "true" ? "收起小条" : "展开小条"}
              onClick={() =>
                setExpanded(expanded === "true" ? "false" : "true")
              }
            >
              {expanded === "true" ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </button>
          ) : (
            <span className="sx-brand-mark" aria-hidden="true">
              序
            </span>
          )}
          <strong>
            {view === "panel"
              ? "资料库"
              : entries.find(([id]) => id === view)?.[1]}
          </strong>
          {view === "strip" && expanded !== "true" ? (
            <StripBoard floating />
          ) : null}
          <button
            type="button"
            aria-label="置顶"
            title="置顶"
            aria-pressed={settings.top}
            onClick={() => void configure({ top: !settings.top })}
          >
            <Pin size={15} />
          </button>
          <button
            type="button"
            aria-label="关闭悬浮看板"
            title="关闭悬浮看板"
            onClick={() => void act("hide")}
          >
            <X size={17} />
          </button>
        </header>
      ) : (
        <header className="sx-host-controls">
          <h1>看板</h1>
          <select
            aria-label="看板视图"
            value={mode}
            onChange={(e) => setMode(e.target.value as BoardMode)}
          >
            {entries.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {host ? (
            <button
              className="sx-open-board"
              type="button"
              onClick={async () => {
                try {
                  await window.flushBoardDraft?.();
                  await act("show", { mode });
                } catch (e) {
                  setError(e instanceof Error ? e.message : "无法打开悬浮看板");
                }
              }}
            >
              <PanelsTopLeft size={17} /> 打开悬浮看板
            </button>
          ) : null}
        </header>
      )}
      {error ? <div role="alert">{error}</div> : null}
      <div
        className="sx-host-status"
        hidden={floating ? saveState.phase !== "error" : false}
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
      <div className="sx-host-layout">
        <div className="sx-board-content">
          <div hidden={view !== "strip" || (floating && expanded !== "true")}>
            {!floating || expanded === "true" ? (
              <StripBoard floating={floating} />
            ) : null}
          </div>
          <div hidden={view !== "rail"}>
            <RailBoard floating={floating} />
          </div>
          <div hidden={view !== "panel"}>
            <LibraryPanel floating={floating} />
          </div>
          <div hidden={view !== "ddl"}>
            <DdlPanel />
          </div>
        </div>
        {!floating ? (
          <aside className="sx-board-sidebar" aria-label="看板设置">
            <span className="sx-trial-label">试用布局</span>
            <PlanningManager />
            <BoardTrash />
            {mode === "strip" ? <StripSettings /> : null}
            {host ? (
              <details className="sx-host-options">
                <summary>悬浮窗口设置</summary>
                <label>
                  界面缩放
                  <select
                    value={settings.zoom}
                    onChange={(e) =>
                      void configure({ zoom: Number(e.target.value) })
                    }
                  >
                    {[0.65, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map(
                      (value) => (
                        <option key={value} value={value}>
                          {Math.round(value * 100)}%
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  内容字号
                  <select
                    value={settings.fontSize}
                    onChange={(e) =>
                      void configure({ fontSize: Number(e.target.value) })
                    }
                  >
                    {[11, 12, 14, 16, 18, 20, 24].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
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
                    onChange={(e) =>
                      void configure({ locked: e.target.checked })
                    }
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
                    onChange={(e) =>
                      void configure({ density: e.target.value })
                    }
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
                {!settings.shortcutAvailable ? (
                  <small role="status">
                    Ctrl+Alt+B 已被占用，可通过主程序打开看板。
                  </small>
                ) : null}
              </details>
            ) : null}
          </aside>
        ) : null}
      </div>
      {floating && !settings.locked
        ? (view === "strip" && !stripNeedsSpace
            ? ["w", "e"]
            : ["n", "s", "w", "e", "nw", "ne", "sw", "se"]
          ).map((edge) => (
            <div
              key={edge}
              className={`sx-resize sx-resize-${edge}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                void act("resizeStart", { edge });
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  void act("resizeMove");
              }}
              onLostPointerCapture={() => void act("resizeEnd")}
            />
          ))
        : null}
    </div>
  );
  return floating ? <div className="sx-float-frame">{content}</div> : content;
}
export default function BoardApp({
  onSource,
}: {
  onSource?: (id: string) => void;
}) {
  const adapter = useMemo(
    () => new RealBoardAdapter((id) => onSource?.(id)),
    [onSource],
  );
  return (
    <BoardProvider adapter={adapter}>
      <Contents floating={!!window.boardHost} />
    </BoardProvider>
  );
}
