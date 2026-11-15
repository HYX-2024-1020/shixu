import { BoardProvider } from "./BoardProvider";
import { DdlPanel } from "./DdlPanel";
import { LibraryPanel } from "./LibraryPanel";
import { RailBoard } from "./RailBoard";
import { StripBoard } from "./StripBoard";
import type { BoardAdapter, BoardMode } from "../types/board";

interface BoardWorkspaceProps {
  adapter: BoardAdapter;
  mode: BoardMode;
  onModeChange?: (mode: BoardMode) => void;
  showEntrySwitcher?: boolean;
}

const entries: { id: BoardMode; label: string }[] = [
  { id: "strip", label: "小条" },
  { id: "rail", label: "窄栏" },
  { id: "panel", label: "面板" },
  { id: "ddl", label: "DDL" },
];

/** 独立看板入口；隐藏而非卸载其他视图，以保留未提交编辑。 */
export function BoardWorkspace({
  adapter,
  mode,
  onModeChange,
  showEntrySwitcher = false,
}: BoardWorkspaceProps) {
  return (
    <BoardProvider adapter={adapter}>
      <div className="sx-workspace">
        {showEntrySwitcher ? (
          <nav className="sx-entry-nav" aria-label="看板入口">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={mode === entry.id}
                onClick={() => onModeChange?.(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}
        <main className={`sx-stage sx-stage-${mode}`}>
          <div hidden={mode !== "strip"}>
            <StripBoard />
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
        </main>
      </div>
    </BoardProvider>
  );
}
