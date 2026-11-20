import { useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import type { TimePrecision } from "../types/board";
import { deadlineLabel, formatDateTime, isOverdue } from "../utils/board";
import { useBoard } from "./BoardProvider";

type DdlFilter = "all" | "today" | "week" | "custom";

interface DdlItem {
  id: string;
  title: string;
  dueAt: string;
  timePrecision: TimePrecision;
  completedAt: string | null;
  dueLabel?: string;
}

export function DdlPanel() {
  const { snapshot, activePlan } = useBoard();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const [filter, setFilter] = useState<DdlFilter>("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const items = useMemo<DdlItem[]>(() => {
    const planningItems = snapshot.tasks
      .filter(
        (task) =>
          task.planningId === activePlan.id &&
          task.dueAt &&
          task.origin !== "source" &&
          !task.archived &&
          !task.deletedAt,
      )
      .map((task) => ({
        id: `planning-${task.id}`,
        title: task.title,
        dueAt: task.dueAt!,
        timePrecision: task.timePrecision,
        completedAt: task.completedAt,
      }));
    return [
      ...snapshot.deadlines.map((item) => ({
        ...item,
        completedAt: item.completedAt ?? null,
      })),
      ...planningItems,
    ].sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt));
  }, [snapshot.deadlines, snapshot.tasks, activePlan.id]);

  const visible = items.filter((item) => {
    if (filter === "all") return true;
    const due = new Date(item.dueAt);
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    if (filter === "today") {
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      return due >= dayStart && due < dayEnd;
    }
    if (filter === "week") {
      const weekEnd = new Date(dayStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return due >= dayStart && due < weekEnd;
    }
    if (!start || !end) return true;
    const rangeStart = new Date(`${start}T00:00:00`);
    const rangeEnd = new Date(`${end}T23:59:59`);
    return due >= rangeStart && due <= rangeEnd;
  });

  return (
    <div data-testid="ddl-panel">
      <section className="sx-ddl-window" aria-label="截止事项">
        <div className="sx-ddl-filters" aria-label="截止范围">
          {(["all", "today", "week", "custom"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "全部"
                : value === "today"
                  ? "今天"
                  : value === "week"
                    ? "未来七天"
                    : "自定义"}
            </button>
          ))}
        </div>
        {filter === "custom" ? (
          <div className="sx-date-range">
            <label>
              <span>开始日期</span>
              <input
                type="date"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <span aria-hidden="true">→</span>
            <label>
              <span>结束日期</span>
              <input
                type="date"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        <div className="sx-ddl-list">
          {visible.length ? (
            visible.map((item) => {
              const overdue = !item.completedAt && isOverdue(item.dueAt);
              return (
                <article
                  className={`sx-ddl-item ${overdue ? "sx-ddl-overdue" : ""}`}
                  key={item.id}
                >
                  <div>
                    <h3>{item.title}</h3>
                    <span>
                      {item.dueLabel?.split(" · ")[0] ||
                        formatDateTime(item.dueAt)}
                    </span>
                    {item.timePrecision === "inferred" ? (
                      <small> · 推定</small>
                    ) : null}
                  </div>
                  <strong>
                    {item.completedAt ? "已完成" : deadlineLabel(item.dueAt)}
                  </strong>
                </article>
              );
            })
          ) : (
            <div className="sx-empty">
              <CalendarRange size={24} />
              <strong>这个范围没有截止事项</strong>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
