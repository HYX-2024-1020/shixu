import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDateTime } from "../utils/board";
import { useBoard, useBoardDraft } from "./BoardProvider";
import { TaskRow } from "./TaskRow";

export function StripBoard({ onMenu }: { onMenu?: () => void } = {}) {
  const { snapshot, activePlan, commit } = useBoard();
  const [expandedValue, setExpanded] = useBoardDraft("strip-expanded", "false");
  const expanded = expandedValue === "true";
  const [display, setDisplay] = useBoardDraft("strip-display", "first");
  const [pinned, setPinned] = useBoardDraft("strip-pin", "");
  const tasks = snapshot.tasks.filter(
    (task) =>
      task.planningId === activePlan.id &&
      !task.archived &&
      !task.sourceUnavailable &&
      !task.deletedAt,
  );
  const pending = tasks.filter((task) => !task.completedAt);
  const nextDeadline = [
    ...snapshot.deadlines,
    ...tasks
      .filter((t) => t.origin !== "source" && t.dueAt)
      .map((t) => ({ ...t, dueAt: t.dueAt! })),
  ]
    .filter(
      (item) =>
        !item.completedAt && new Date(item.dueAt).getTime() >= Date.now(),
    )
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))[0];

  const toggle = (taskId: string, completed: boolean) => {
    commit(
      (draft) => {
        const task = draft.tasks.find((item) => item.id === taskId);
        if (task)
          task.completedAt = completed ? new Date().toISOString() : null;
      },
      completed ? "已完成事项" : "已撤销完成",
    );
  };

  const label =
    display === "count"
      ? `${tasks.length - pending.length} / ${tasks.length} 已完成`
      : display === "deadline"
        ? (nextDeadline?.title ?? "暂无截止事项")
        : (tasks.find((t) => t.id === pinned)?.title ??
          pending[0]?.title ??
          "当前计划已完成");
  return (
    <section
      className="sx-strip"
      aria-label="小条看板"
      data-testid="strip-board"
    >
      <div className="sx-strip-row">
        {onMenu ? (
          <button
            type="button"
            className="sx-brand-mark"
            onClick={onMenu}
            aria-label="看板菜单"
          >
            序
          </button>
        ) : (
          <span className="sx-brand-mark" aria-hidden="true">
            序
          </span>
        )}
        <span className="sx-strip-title" title={label}>
          {label}
        </span>
        <button
          className="sx-strip-toggle"
          type="button"
          onClick={() => setExpanded(expanded ? "false" : "true")}
          aria-expanded={expanded}
          aria-label={expanded ? "收起小条" : "展开小条"}
        >
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
      </div>
      {expanded ? (
        <div className="sx-strip-more">
          <div className="sx-strip-list">
            {pending.length ? (
              pending
                .slice(0, 3)
                .map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    compact
                    onToggle={(done) => toggle(task.id, done)}
                  />
                ))
            ) : (
              <p className="sx-empty-inline">没有待完成事项，可以安心收好。</p>
            )}
          </div>
          <label>
            小条显示
            <select
              aria-label="小条显示"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
            >
              <option value="first">固定或首件事项</option>
              <option value="deadline">最近截止</option>
              <option value="count">完成数量</option>
            </select>
          </label>
          {display === "first" ? (
            <select
              aria-label="固定事项"
              value={pinned}
              onChange={(e) => setPinned(e.target.value)}
            >
              <option value="">首件未完成</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          ) : null}
          <div className="sx-strip-foot">
            <span>{pending.length} 项待完成</span>
            <span>
              最近 DDL ·{" "}
              {nextDeadline ? formatDateTime(nextDeadline.dueAt) : "暂无"}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
