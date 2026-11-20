import { useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { useBoardDraft } from "./BoardProvider";
import type { BoardTask, LongPlan } from "../types/board";
import { fromDateTimeInput, toDateTimeInput } from "../utils/board";

interface TaskRowProps {
  task: BoardTask;
  parent?: LongPlan;
  compact?: boolean;
  menu?: boolean;
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
  menu = false,
  controls,
  onToggle,
  onUpdate,
  onRemove,
  onOpenSource,
  removeLabel,
}: TaskRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle, clearTitle] = useBoardDraft(
    `title:${task.id}`,
    task.title,
  );
  const [dueAt, setDueAt, clearDue] = useBoardDraft(
    `due:${task.id}`,
    toDateTimeInput(task.dueAt),
  );
  const done = Boolean(task.completedAt);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onUpdate?.(title.trim(), fromDateTimeInput(dueAt));
    clearTitle();
    clearDue();
    setEditing(false);
  };

  const actions = (
    <>
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
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
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
    </>
  );

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
          {!compact && task.sourceUnavailable ? (
            <small>来源不可用</small>
          ) : null}
          {!compact && parent && !controls ? (
            <small>{parent.title}</small>
          ) : null}
        </span>
      </label>
      {!compact && !task.sourceUnavailable ? (
        menu ? (
          <details className="sx-item-menu sx-task-menu">
            <summary aria-label={`事项操作：${task.title}`}>⋯</summary>
            <div className="sx-task-controls">{actions}</div>
          </details>
        ) : (
          <span className="sx-task-controls">{actions}</span>
        )
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
              onClick={() => {
                clearTitle();
                clearDue();
                setEditing(false);
              }}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
