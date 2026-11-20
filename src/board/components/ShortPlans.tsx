import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { BoardTask } from "../types/board";
import { createId, getParent, removeBoardTask } from "../utils/board";
import { useBoard, useBoardDraft } from "./BoardProvider";
import { TaskRow } from "./TaskRow";

export function ShortPlans({ floating = false }: { floating?: boolean } = {}) {
  const { snapshot, activePlan, adapter, commit } = useBoard();
  const [title, setTitle] = useBoardDraft(`short:${activePlan.id}`);
  const [notice, setNotice] = useState("");
  const tasks = snapshot.tasks.filter(
    (task) =>
      task.planningId === activePlan.id && !task.archived && !task.deletedAt,
  );

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    const id = createId("task");
    commit((draft) => {
      draft.tasks.push({
        id,
        planningId: activePlan.id,
        origin: "manual",
        title: title.trim(),
        completedAt: null,
        dueAt: null,
        timePrecision: "inferred",
        archived: false,
      });
    }, "已新增短期事项");
    setTitle("");
  };

  const toggle = (taskId: string, completed: boolean) => {
    commit(
      (draft) => {
        const task = draft.tasks.find((item) => item.id === taskId);
        if (task)
          task.completedAt = completed ? new Date().toISOString() : null;
      },
      completed ? "已完成，随时可撤销" : "已撤销完成",
    );
  };

  const update = (taskId: string, nextTitle: string, dueAt: string | null) => {
    commit((draft) => {
      const task = draft.tasks.find((item) => item.id === taskId);
      if (task) {
        task.title = nextTitle;
        task.dueAt = dueAt;
        task.timePrecision = dueAt ? "explicit" : "inferred";
      }
    }, "已更新事项标题与日期");
  };

  const remove = (task: BoardTask) => {
    commit(
      (draft) => removeBoardTask(draft, task),
      task.origin === "source"
        ? "已移出规划，来源事项未删除"
        : "已移到最近删除",
    );
  };

  const toggleSource = (sourceId: string, checked: boolean) => {
    const source = snapshot.sourceTasks.find((item) => item.id === sourceId);
    if (!source) return;
    commit(
      (draft) => {
        if (checked) {
          draft.tasks.push({
            id: createId("task"),
            planningId: activePlan.id,
            origin: "source",
            sourceId,
            title: source.title,
            completedAt: source.completedAt ?? null,
            dueAt: source.dueAt ?? null,
            timePrecision: source.timePrecision ?? "inferred",
            archived: false,
          });
        } else {
          draft.tasks = draft.tasks.filter(
            (item) =>
              !(
                item.planningId === activePlan.id && item.sourceId === sourceId
              ),
          );
        }
      },
      checked ? "已选入来源事项" : "已移出规划，来源事项未删除",
    );
  };

  const openSource = async (sourceId: string) => {
    if (!adapter.openSource) {
      setNotice("当前环境不能打开来源详情，请在主程序中查看。");
      return;
    }
    try {
      await adapter.openSource(sourceId);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "打开失败");
      return;
    }
    setNotice("");
  };

  return (
    <section
      className="sx-module sx-short"
      aria-label="短期计划"
      data-testid="short-plans"
    >
      <form className="sx-new-item" onSubmit={add}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="新增短期计划"
          placeholder="新增事项…"
          maxLength={100}
        />
        <button
          className="sx-button sx-button-primary"
          type="submit"
          disabled={!title.trim()}
        >
          <Plus size={14} /> 新增一项
        </button>
      </form>
      <div className="sx-task-list">
        {tasks.length ? (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              menu={floating}
              parent={getParent(task.parentId, snapshot.longPlans)}
              onToggle={(done) => toggle(task.id, done)}
              onUpdate={(nextTitle, dueAt) => update(task.id, nextTitle, dueAt)}
              onRemove={task.origin === "step" ? undefined : () => remove(task)}
              onOpenSource={
                task.sourceId
                  ? () => void openSource(task.sourceId!)
                  : undefined
              }
            />
          ))
        ) : (
          <p className="sx-empty-inline sx-rail-empty">
            <img
              src={import.meta.env.BASE_URL + "mascot.png"}
              alt=""
              draggable={false}
            />
            暂无短期事项
          </p>
        )}
      </div>
      <details className="sx-source-picker">
        <summary>从主程序选入</summary>
        <div className="sx-source-options">
          {snapshot.sourceTasks.map((source) => {
            const checked = tasks.some((task) => task.sourceId === source.id);
            return (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    toggleSource(source.id, event.target.checked)
                  }
                />
                <span>
                  {source.title}
                  <small>{source.sourceLabel}</small>
                </span>
              </label>
            );
          })}
        </div>
      </details>
      <span className="sx-inline-notice" aria-live="polite">
        {notice}
      </span>
    </section>
  );
}
