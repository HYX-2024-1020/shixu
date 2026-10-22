import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  Check,
  Circle,
  ArrowUpRight,
  CalendarDays,
  MoreHorizontal,
  Flag,
} from "lucide-react";
import { KIND_LABEL, type Draft, type Entry, type Kind } from "./types";
import { localDate } from "./organize";

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => {
      el.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const r = dialog.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Badge({ kind }: { kind: Kind }) {
  return <span className={`badge ${kind}`}>{KIND_LABEL[kind]}</span>;
}
export function dateLabel(due: string, today = localDate()) {
  if (!due) return "未安排日期";
  if (due === today) return "今天";
  const days = Math.round(
    (new Date(`${due}T12:00:00`).getTime() -
      new Date(`${today}T12:00:00`).getTime()) /
      86400000,
  );
  if (days === 1) return "明天";
  if (days < 0) return `逾期 ${Math.abs(days)} 天`;
  return `${Number(due.slice(5, 7))}月${Number(due.slice(8))}日`;
}
export function EntryRow({
  entry,
  onOpen,
  onToggle,
  today = localDate(),
}: {
  entry: Entry;
  onOpen: (e: Entry) => void;
  onToggle: (e: Entry) => void;
  today?: string;
}) {
  const done =
    entry.kind === "habit"
      ? entry.checkins.includes(today)
      : entry.status === "done";
  return (
    <div className={`entry-row ${done ? "is-done" : ""}`}>
      <button
        className={`check-button ${done ? "checked" : ""}`}
        title={entry.kind === "habit" ? "切换今日打卡" : "切换完成状态"}
        aria-label={`${done ? "取消完成" : "完成"}：${entry.title}`}
        onClick={() => onToggle(entry)}
      >
        {done ? <Check size={14} /> : <span />}
      </button>
      <button className="entry-main" onClick={() => onOpen(entry)}>
        <span className="entry-title">{entry.title}</span>
        <span className="entry-meta">
          {entry.project && <span>{entry.project}</span>}
          {entry.tags.slice(0, 2).map((t) => (
            <span key={t}>#{t}</span>
          ))}
          {!entry.project && !entry.tags.length && (
            <span>{KIND_LABEL[entry.kind]}</span>
          )}
        </span>
      </button>
      <div className="entry-end">
        {entry.priority === "high" && (
          <Flag size={13} className="priority-icon" />
        )}
        {entry.due && (
          <span
            className={`due ${entry.due < today && !done ? "overdue" : entry.due === today ? "today" : ""}`}
          >
            {!entry.confirmedDate && <span title="日期待确认">待确认 · </span>}
            {dateLabel(entry.due, today)}
            {entry.time && <small>{entry.time}</small>}
          </span>
        )}
        <button
          className="icon-button row-more"
          aria-label={`编辑：${entry.title}`}
          onClick={() => onOpen(entry)}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function DraftFields({
  value,
  onChange,
  projects = [],
}: {
  value: Draft;
  onChange: (d: Draft) => void;
  projects?: string[];
}) {
  return (
    <div className="draft-fields">
      <label className="full">
        标题
        <input
          value={value.title}
          maxLength={150}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="给这件事一个清晰的名字"
          required
        />
      </label>
      <label>
        分类
        <select
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as Kind })}
        >
          {Object.entries(KIND_LABEL).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        优先级
        <select
          value={value.priority}
          onChange={(e) =>
            onChange({
              ...value,
              priority: e.target.value as Draft["priority"],
            })
          }
        >
          <option value="normal">普通</option>
          <option value="high">重要</option>
          <option value="low">不着急</option>
        </select>
      </label>
      <label>
        日期
        <input
          type="date"
          value={value.due}
          onChange={(e) =>
            onChange({ ...value, due: e.target.value, confirmedDate: true })
          }
        />
      </label>
      <label>
        时间
        <input
          type="time"
          value={value.time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
        />
      </label>
      {value.dateHint && (
        <p className="field-note full">
          <CalendarDays size={14} />
          {value.dateHint} · 保存前请核对
        </p>
      )}
      <label>
        所属项目
        <input
          value={value.project}
          maxLength={100}
          list="project-options"
          placeholder="可选"
          onChange={(e) => onChange({ ...value, project: e.target.value })}
        />
        <datalist id="project-options">
          {projects.map((p) => (
            <option value={p} key={p} />
          ))}
        </datalist>
      </label>
      <label>
        标签
        <input
          value={value.tags.join("，")}
          maxLength={300}
          placeholder="学习，生活"
          onChange={(e) =>
            onChange({
              ...value,
              tags: [
                ...new Set(
                  e.target.value
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                ),
              ]
                .slice(0, 12)
                .map((t) => t.slice(0, 40)),
            })
          }
        />
      </label>
      <label className="full">
        内容与原文
        <textarea
          rows={5}
          value={value.content}
          maxLength={20000}
          onChange={(e) => onChange({ ...value, content: e.target.value })}
        />
      </label>
    </div>
  );
}
export function SectionHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>
        {title}
        {count !== undefined && <span>{count}</span>}
      </h2>
      {action}
    </div>
  );
}
export function LinkArrow({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}
export const DotCircle = Circle;
