import { useState, type FormEvent } from "react";
import { Check, FolderPlus, Pencil, X } from "lucide-react";
import { createId } from "../utils/board";
import { useBoard, useBoardDraft } from "./BoardProvider";

/** 可独立嵌入主程序「看板」页面的规划管理组件。 */
export function PlanningManager() {
  const { snapshot, activePlan, commit, setActivePlan } = useBoard();
  const [action, setAction] = useState<"new" | "rename" | null>(null);
  const [newDraft, setNewDraft] = useBoardDraft("planning-new-name");
  const [renameDraft, setRenameDraft, clearRename] = useBoardDraft(
    `planning-rename:${activePlan.id}`,
    activePlan.name,
  );
  const draft = action === "rename" ? renameDraft : newDraft;
  const setDraft = action === "rename" ? setRenameDraft : setNewDraft;

  const begin = (nextAction: "new" | "rename") => {
    setAction(nextAction);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name || !action) return;
    if (action === "new") {
      const id = createId("plan");
      commit((state) => {
        state.plans.push({ id, name });
        state.activePlanId = id;
      }, "已新建空白规划");
    } else {
      commit((state) => {
        const plan = state.plans.find((item) => item.id === activePlan.id);
        if (plan) plan.name = name;
      }, "已重命名规划");
    }
    if (action === "new") setNewDraft("");
    else clearRename();
    setAction(null);
  };

  return (
    <div className="sx-planning" aria-label="规划管理">
      <label className="sx-plan-select">
        <span>当前规划</span>
        <select
          value={activePlan.id}
          onChange={(event) => setActivePlan(event.target.value)}
        >
          {snapshot.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <div className="sx-plan-actions">
        <button
          className="sx-icon-button"
          type="button"
          onClick={() => begin("new")}
          aria-label="新建规划"
          title="新建规划"
        >
          <FolderPlus size={15} />
        </button>
        <button
          className="sx-icon-button"
          type="button"
          onClick={() => begin("rename")}
          aria-label="重命名当前规划"
          title="重命名当前规划"
        >
          <Pencil size={14} />
        </button>
      </div>
      {action ? (
        <form className="sx-plan-form" onSubmit={submit}>
          <input
            autoFocus
            value={draft}
            maxLength={30}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={action === "new" ? "新规划名称" : "规划新名称"}
            placeholder="规划名称"
          />
          <button
            className="sx-icon-button"
            type="submit"
            aria-label="确认规划名称"
          >
            <Check size={15} />
          </button>
          <button
            className="sx-icon-button"
            type="button"
            onClick={() => setAction(null)}
            aria-label="取消编辑规划"
          >
            <X size={15} />
          </button>
        </form>
      ) : null}
    </div>
  );
}
