import { useState } from "react";
import { useBoard } from "./BoardProvider";
import { LongPlans } from "./LongPlans";
import { ShortPlans } from "./ShortPlans";
import type { PlanTab } from "../types/board";

export function RailBoard({ floating = false }: { floating?: boolean } = {}) {
  const { activePlan } = useBoard();
  const [tab, setTab] = useState<PlanTab>("short");

  return (
    <div className="sx-rail-wrap" data-testid="rail-board">
      <section className="sx-rail" aria-label="窄栏看板">
        {!floating ? (
          <h2 className="sx-rail-title">{activePlan.name}</h2>
        ) : null}
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
            <ShortPlans floating={floating} />
          </div>
          <div hidden={tab !== "long"}>
            <LongPlans floating={floating} />
          </div>
        </div>
      </section>
    </div>
  );
}
