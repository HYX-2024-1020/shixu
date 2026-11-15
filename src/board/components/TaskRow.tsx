import { useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { useBoardDraft } from "./BoardProvider";
import type { BoardTask, LongPlan } from "../types/board";
import { formatDate, fromDateTimeInput, toDateTimeInput } from "../utils/board";

interface TaskRowProps {
  task: BoardTask;
  parent?: LongPlan;
  compact?: boolean;
  controls?: ReactNode;
  onToggle: (completed: boolean) => void;
  onUpdate?: (title: string, dueAt: string | null) => void;
  onRemove?: () => void;
  onOpenSource?: () => void;
  removeLabel?: string;
}

export function TaskRow({
  task,
  parent,
  compact = false,
  controls,
  onToggle,
  onUpdate,
  onRemove,
  onOpenSource,
  removeLabel,
}: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useBoardDraft(`title:${task.id}`, task.title);
  const [dueAt, setDueAt] = useBoardDraft(
    `due:${task.id}`,
    toDateTimeInput(task.dueAt),
  );
  const done = Boolean(task.completedAt);
  const source =
    task.origin === "manual"
      ? "手写 · 短期计划"
      : task.origin === "source"
        ? "选入 · 主程序"
        : `来自长期计划 · ${parent?.title ?? "关联步骤"}`;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onUpdate?.(title.trim(), fromDateTimeInput(dueAt));
    setEditing(false);
  };

  return (
    <div
      className={`sx-task ${done ? "sx-task-done" : ""}`}
      data-task-id={task.id}
    >
      <label className="sx-task-check">
        <input
          type="checkbox"
          checked={done}
          disabled={task.sourceUnavailable}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`${done ? "撤销完成" : "完成"}：${task.title}`}
        />
        <span className="sx-task-main">
          <span className="sx-task-title">{task.title}</span>
          {!compact ? (
            <small>
              {task.sourceUnavailable
                ? "来源已删除或不可用（关联保留，恢复后可继续）"
                : source}
              {done && task.completedAt
                ? ` · 完成于 ${formatDate(task.completedAt)}`
                : ""}
              {task.dueAt ? " · 有日期" : ""}
            </small>
          ) : null}
        </span>
      </label>
      {!compact && !task.sourceUnavailable ? (
        <span className="sx-task-controls">
          {controls}
          {onOpenSource ? (
            <button
              className="sx-row-button"
              type="button"
              onClick={onOpenSource}
              aria-label={`打开主程序详情：${task.title}`}
              title="打开主程序详情"
            >
              <ExternalLink size={13} />
            </button>
          ) : null}
          {onUpdate ? (
            <button
              className="sx-row-button"
              type="button"
              onClick={() => {
                setTitle(task.title);
                setDueAt(toDateTimeInput(task.dueAt));
                setEditing((value) => !value);
              }}
              aria-label={`编辑事项：${task.title}`}
              aria-expanded={editing}
            >
              <Pencil size={13} />
            </button>
          ) : null}
          {onRemove ? (
            <button
              className="sx-row-button sx-row-danger"
              type="button"
              onClick={onRemove}
              aria-label={`${removeLabel ?? (task.origin === "manual" ? "删除" : "移出规划")}：${task.title}`}
            >
              {(
                removeLabel
                  ? removeLabel.includes("删除")
                  : task.origin === "manual"
              ) ? (
                <Trash2 size={13} />
              ) : (
                <X size={14} />
              )}
            </button>
          ) : null}
        </span>
      ) : null}
      {editing && onUpdate ? (
        <form className="sx-task-edit" onSubmit={save}>
          <label>
            <span>标题</span>
            <input
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>日期与时刻（留空则不设置截止）</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <div>
            <button className="sx-button sx-button-primary" type="submit">
              保存修改
            </button>
            <button
              className="sx-button"
              type="button"
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
