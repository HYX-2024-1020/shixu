import { useBoard } from "./BoardProvider";
export function BoardTrash() {
  const { snapshot, activePlan, commit } = useBoard();
  const tasks = snapshot.tasks.filter(
    (t) =>
      t.planningId === activePlan.id &&
      t.deletedAt &&
      !snapshot.longPlans.find((p) => p.id === t.parentId)?.deletedAt,
  );
  const parents = snapshot.longPlans.filter(
    (p) => p.planningId === activePlan.id && p.deletedAt,
  );
  return (
    <details>
      <summary>最近删除 · {tasks.length + parents.length}</summary>
      <small>手写内容保留在本规划，可恢复；来源移出不删除来源。</small>
      {parents.map((p) => (
        <p key={p.id}>
          {p.title}
          <button
            type="button"
            onClick={() =>
              commit((d) => {
                const parent = d.longPlans.find((x) => x.id === p.id)!;
                const at = parent.deletedAt;
                delete parent.deletedAt;
                for (const task of d.tasks)
                  if (task.parentId === p.id && task.deletedAt === at)
                    delete task.deletedAt;
              }, "已恢复长期计划及其子事项")
            }
          >
            恢复长期计划
          </button>
        </p>
      ))}
      {tasks.map((t) => (
        <p key={t.id}>
          {t.title}
          <button
            type="button"
            onClick={() =>
              commit((d) => {
                delete d.tasks.find((x) => x.id === t.id)!.deletedAt;
              }, "已恢复手写事项")
            }
          >
            恢复事项
          </button>
        </p>
      ))}
    </details>
  );
}
