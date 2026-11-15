import { useState, type FormEvent } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { LongPlan } from "../types/board";
import { createId, formatDate } from "../utils/board";
import { useBoard, useBoardDraft } from "./BoardProvider";
import { TaskRow } from "./TaskRow";

function LongPlanSection({ parent }: { parent: LongPlan }) {
  const { snapshot, commit } = useBoard();
  const [stepTitle, setStepTitle] = useBoardDraft(`step:${parent.id}`);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useBoardDraft(`parent:${parent.id}`, parent.title);
  const steps = parent.stepIds
    .map((id) => snapshot.tasks.find((task) => task.id === id))
    .filter((task) => task !== undefined)
    .filter((task) => !task.deletedAt);
  const visibleSteps = steps.filter((task) => !task.archived);
  const archivedSteps = steps.filter((task) => task.archived);
  const completedCount = steps.filter((task) => task.completedAt).length;

  const toggleStep = (taskId: string, completed: boolean) => {
    commit(
      (draft) => {
        const task = draft.tasks.find((item) => item.id === taskId);
        if (task)
          task.completedAt = completed ? new Date().toISOString() : null;
      },
      completed ? "子事项已完成，短期页同步更新" : "已撤销子事项完成状态",
    );
  };

  const addStep = (event: FormEvent) => {
    event.preventDefault();
    if (!stepTitle.trim()) return;
    const id = createId("step");
    commit((draft) => {
      draft.tasks.push({
        id,
        planningId: parent.planningId,
        parentId: parent.id,
        origin: "step",
        title: stepTitle.trim(),
        completedAt: null,
        dueAt: null,
        timePrecision: "inferred",
        archived: false,
      });
      draft.longPlans.find((item) => item.id === parent.id)?.stepIds.push(id);
    }, "子事项已自动关联到短期计划");
    setStepTitle("");
  };

  const updateStep = (
    taskId: string,
    nextTitle: string,
    dueAt: string | null,
  ) => {
    commit((draft) => {
      const task = draft.tasks.find((item) => item.id === taskId);
      if (task) {
        task.title = nextTitle;
        task.dueAt = dueAt;
        task.timePrecision = dueAt ? "explicit" : "inferred";
      }
    }, "已更新子事项");
  };

  const removeStep = (taskId: string) => {
    commit((draft) => {
      draft.tasks.find((t) => t.id === taskId)!.deletedAt =
        new Date().toISOString();
    }, "已删除子事项，短期关联同步移除");
  };

  const moveStep = (taskId: string, offset: number) => {
    commit((draft) => {
      const target = draft.longPlans.find((item) => item.id === parent.id);
      if (!target) return;
      const index = target.stepIds.indexOf(taskId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= target.stepIds.length)
        return;
      [target.stepIds[index], target.stepIds[nextIndex]] = [
        target.stepIds[nextIndex],
        target.stepIds[index],
      ];
    }, "已调整子事项顺序");
  };

  const archiveCompleted = () => {
    commit((draft) => {
      const ids =
        draft.longPlans.find((item) => item.id === parent.id)?.stepIds ?? [];
      draft.tasks.forEach((task) => {
        if (ids.includes(task.id) && task.completedAt) task.archived = true;
      });
    }, "已归档已完成子事项，完成记录仍保留");
  };

  const restore = (taskId: string) => {
    commit((draft) => {
      const task = draft.tasks.find((item) => item.id === taskId);
      if (task) task.archived = false;
    }, "已恢复展示，完成状态与日期未改变");
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    commit((draft) => {
      const target = draft.longPlans.find((item) => item.id === parent.id);
      if (target) target.title = title.trim();
    }, "已重命名长期计划");
    setEditingTitle(false);
  };

  const toggleParent = () => {
    commit(
      (draft) => {
        const target = draft.longPlans.find((item) => item.id === parent.id);
        if (target)
          target.completedAt = target.completedAt
            ? null
            : new Date().toISOString();
      },
      parent.completedAt ? "已撤销长期计划完成状态" : "已主动完成整个长期计划",
    );
  };

  return (
    <article
      className={`sx-parent ${parent.completedAt ? "sx-parent-done" : ""}`}
      data-parent-id={parent.id}
    >
      <div className="sx-parent-top">
        {editingTitle ? (
          <form className="sx-parent-title-form" onSubmit={rename}>
            <input
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="长期计划标题"
            />
            <button
              className="sx-row-button"
              type="submit"
              aria-label="保存长期计划标题"
            >
              <Check size={14} />
            </button>
          </form>
        ) : (
          <h4>{parent.title}</h4>
        )}
        <span className="sx-progress">
          {completedCount} / {steps.length} 已完成
        </span>
      </div>
      <div className="sx-parent-actions">
        <button
          className="sx-text-button"
          type="button"
          onClick={() => {
            setTitle(parent.title);
            setEditingTitle((value) => !value);
          }}
        >
          <Pencil size={12} /> 编辑标题
        </button>
        <button className="sx-text-button" type="button" onClick={toggleParent}>
          <CircleCheck size={13} />{" "}
          {parent.completedAt ? "撤销父计划完成" : "完成整个计划"}
        </button>
      </div>
      {parent.completedAt ? (
        <small className="sx-parent-completion">
          父计划由你手动完成于 {formatDate(parent.completedAt)}
        </small>
      ) : null}
      <div className="sx-parent-steps">
        <small>
          下一步：
          {steps.find((t) => t.id === parent.nextStepId && !t.completedAt)
            ?.title ||
            steps.find((t) => !t.archived && !t.completedAt)?.title ||
            "当前步骤已全部完成，可继续添加"}
        </small>
        {visibleSteps.length ? (
          visibleSteps.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              parent={parent}
              removeLabel="删除子事项"
              onToggle={(done) => toggleStep(task.id, done)}
              onUpdate={(nextTitle, dueAt) =>
                updateStep(task.id, nextTitle, dueAt)
              }
              onRemove={() => removeStep(task.id)}
              controls={
                <span className="sx-sort-controls">
                  {!task.completedAt ? (
                    <button
                      className="sx-row-button"
                      type="button"
                      aria-label={`设为下一步：${task.title}`}
                      onClick={() =>
                        commit((d) => {
                          d.longPlans.find(
                            (p) => p.id === parent.id,
                          )!.nextStepId = task.id;
                        }, "已指定下一步")
                      }
                    >
                      下一步
                    </button>
                  ) : (
                    <button
                      className="sx-row-button"
                      type="button"
                      aria-label={`归档：${task.title}`}
                      onClick={() =>
                        commit((d) => {
                          d.tasks.find((t) => t.id === task.id)!.archived =
                            true;
                        }, "已归档子事项")
                      }
                    >
                      <Archive size={13} />
                    </button>
                  )}
                  <button
                    className="sx-row-button"
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveStep(task.id, -1)}
                    aria-label={`上移：${task.title}`}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="sx-row-button"
                    type="button"
                    disabled={index === visibleSteps.length - 1}
                    onClick={() => moveStep(task.id, 1)}
                    aria-label={`下移：${task.title}`}
                  >
                    <ArrowDown size={13} />
                  </button>
                </span>
              }
            />
          ))
        ) : (
          <p className="sx-empty-inline">还没有进行中的子事项。</p>
        )}
      </div>
      <form className="sx-step-add" onSubmit={addStep}>
        <input
          value={stepTitle}
          onChange={(event) => setStepTitle(event.target.value)}
          placeholder="手动拆一个小步骤…"
          maxLength={100}
          aria-label={`${parent.title}的新子事项`}
        />
        <button
          className="sx-button"
          type="submit"
          disabled={!stepTitle.trim()}
        >
          <Plus size={13} /> 子事项
        </button>
      </form>
      <small className="sx-parent-hint">
        新增子事项会自动加入短期计划；步骤全部完成也不会自动完成父计划。
      </small>
      <div className="sx-archive-row">
        <button
          className="sx-text-button"
          type="button"
          onClick={archiveCompleted}
          disabled={!visibleSteps.some((task) => task.completedAt)}
        >
          <Archive size={13} /> 归档已完成
        </button>
      </div>
      <details className="sx-archived">
        <summary>已归档 · {archivedSteps.length}</summary>
        {archivedSteps.length ? (
          archivedSteps.map((task) => (
            <div className="sx-archived-item" key={task.id}>
              <span>
                {task.title}
                <small>完成于 {formatDate(task.completedAt)}</small>
              </span>
              <button
                className="sx-text-button"
                type="button"
                onClick={() => restore(task.id)}
              >
                <RotateCcw size={12} /> 恢复展示
              </button>
            </div>
          ))
        ) : (
          <p className="sx-empty-inline">归档后的完成记录会留在这里。</p>
        )}
      </details>
      <details>
        <summary>删除此长期计划</summary>
        <p>
          删除父计划及其子事项，不影响主程序来源；可在窗口与规划的最近删除中恢复。
        </p>
        <button
          type="button"
          onClick={() =>
            commit((d) => {
              const at = new Date().toISOString();
              d.longPlans.find((p) => p.id === parent.id)!.deletedAt = at;
              for (const t of d.tasks)
                if (t.parentId === parent.id && !t.deletedAt) t.deletedAt = at;
            }, "已移到最近删除")
          }
        >
          确认删除父计划及其子事项
        </button>
      </details>
    </article>
  );
}

export function LongPlans() {
  const { snapshot, activePlan, commit } = useBoard();
  const [title, setTitle] = useBoardDraft(`long:${activePlan.id}`);
  const parents = snapshot.longPlans.filter(
    (parent) => parent.planningId === activePlan.id && !parent.deletedAt,
  );

  const addParent = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    commit((draft) => {
      draft.longPlans.push({
        id: createId("parent"),
        planningId: activePlan.id,
        title: title.trim(),
        stepIds: [],
        completedAt: null,
      });
    }, "已新增长期父计划，可继续添加子事项");
    setTitle("");
  };

  return (
    <section
      className="sx-module sx-long"
      aria-labelledby="sx-long-title"
      data-testid="long-plans"
    >
      <div className="sx-section-head">
        <h3 id="sx-long-title">一步步推进</h3>
        <small>子事项自动加入短期</small>
      </div>
      <div className="sx-parents">
        {parents.length ? (
          parents.map((parent) => (
            <LongPlanSection key={parent.id} parent={parent} />
          ))
        ) : (
          <div className="sx-empty">
            <strong>还没有长期计划</strong>
            <span>先创建父计划，再按自己的节奏拆步骤。</span>
          </div>
        )}
      </div>
      <form className="sx-new-item" onSubmit={addParent}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="新增长期计划"
          placeholder="写一项长期计划…"
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
    </section>
  );
}
