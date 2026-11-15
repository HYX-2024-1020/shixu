import { useState } from "react";
import { useBoard } from "./BoardProvider";
import { LongPlans } from "./LongPlans";
import { PlanningManager } from "./PlanningManager";
import { ShortPlans } from "./ShortPlans";
import { WindowFrame } from "./WindowFrame";
import type { PlanTab } from "../types/board";

export function RailBoard() {
  const { activePlan, saveState, retrySave } = useBoard();
  const [tab, setTab] = useState<PlanTab>("short");

  return (
    <div className="sx-rail-wrap" data-testid="rail-board">
      <WindowFrame
        title={activePlan.name}
        subtitle="看板"
        className="sx-rail"
        label="窄栏看板"
        footer={
          <>
            <span
              className={`sx-save-status sx-save-${saveState.phase}`}
              aria-live="polite"
            >
              {saveState.message}
              {saveState.phase === "error" ? (
                <button type="button" onClick={retrySave}>
                  重试
                </button>
              ) : null}
            </span>
            <span>内容仅属于本规划</span>
          </>
        }
      >
        <PlanningManager />
        <nav className="sx-plan-tabs" aria-label="计划分类">
          <button
            type="button"
            aria-pressed={tab === "short"}
            onClick={() => setTab("short")}
          >
            短期计划
          </button>
          <button
            type="button"
            aria-pressed={tab === "long"}
            onClick={() => setTab("long")}
          >
            长期计划
          </button>
        </nav>
        <div className="sx-rail-content">
          <div hidden={tab !== "short"}>
            <ShortPlans />
          </div>
          <div hidden={tab !== "long"}>
            <LongPlans />
          </div>
        </div>
      </WindowFrame>
    </div>
  );
}
