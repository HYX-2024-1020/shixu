import { removeBoardTask } from "../utils/board";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useBoard, useBoardDraft } from "./BoardProvider";
import type { BoardTask } from "../types/board";
import { TaskRow } from "./TaskRow";

function useStrip() {
  const { snapshot, activePlan, commit } = useBoard();
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

  const remove = (task: BoardTask) => {
    commit(
      (draft) => removeBoardTask(draft, task),
      task.origin === "source"
        ? "已移出规划，来源事项未删除"
        : "已移到最近删除",
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
  return {
    tasks,
    toggle,
    remove,
    label,
    display,
    setDisplay,
    pinned,
    setPinned,
  };
}

export function StripSettings() {
  const { tasks, display, setDisplay, pinned, setPinned } = useStrip();
  return (
    <div className="sx-strip-settings">
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
    </div>
  );
}

export function StripBoard({
  floating = false,
  summary = false,
}: { floating?: boolean; summary?: boolean } = {}) {
  const [expandedValue, setExpanded] = useBoardDraft("strip-expanded", "false");
  const expanded = expandedValue === "true";
  const { tasks, label, toggle, remove } = useStrip();
  if (summary)
    return (
      <span className="sx-strip-title" title={label}>
        {label}
      </span>
    );
  return (
    <section
      className="sx-strip"
      aria-label="小条看板"
      data-testid="strip-board"
    >
      {!floating ? (
        <div className="sx-strip-row">
          <span className="sx-brand-mark" aria-hidden="true">
            序
          </span>
          <span className="sx-strip-title" title={label}>
            {label}
          </span>
          <button
            className="sx-strip-toggle"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "收起小条" : "展开小条"}
            onClick={() => setExpanded(expanded ? "false" : "true")}
          >
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
        </div>
      ) : null}
      <div
        className="sx-strip-reveal"
        data-expanded={expanded}
        inert={!expanded}
      >
        <div className="sx-strip-list">
          {tasks.length ? (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                compact
                menu
                onRemove={() => remove(task)}
                removeLabel={task.origin === "source" ? "移出规划" : "删除"}
                onToggle={(done) => toggle(task.id, done)}
              />
            ))
          ) : (
            <p className="sx-empty-inline">暂无事项</p>
          )}
        </div>
      </div>
    </section>
  );
}
