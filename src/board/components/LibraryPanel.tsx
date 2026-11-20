import { useRef, useState, type ChangeEvent } from "react";
import { FilePlus, GripVertical } from "lucide-react";
import { useCardDrag } from "../../bucket/useCardDrag";
import { mergeCardOrder } from "../../bucket/card-order";
import { useBoard } from "./BoardProvider";
import type { ResourceItem } from "../types/board";

export function LibraryPanel({
  floating = false,
}: { floating?: boolean } = {}) {
  const { snapshot, activePlan, adapter, addResources, commit } = useBoard();
  const [filter, setFilter] = useState<"all" | "image" | "file">("all");
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [trash, setTrash] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const resources = snapshot.resources.filter(
    (item) =>
      item.planningId === activePlan.id &&
      !!item.deletedAt === trash &&
      (filter === "all" || item.kind === filter),
  );
  const ids = resources.map((item) => item.id);
  const drag = useCardDrag(root, {
    ids,
    enabled: !trash && !busy,
    cardSelector: ".sx-library-card[data-motion-id]",
    scrollSelector: ".sx-floating .sx-board-content, .bucket-main",
    onPreview: setPreviewOrder,
    onCommit: async (order) => {
      commit((draft) => {
        const byId = new Map(draft.resources.map((item) => [item.id, item]));
        draft.resources = mergeCardOrder([...byId.keys()], ids, order).map(
          (id) => byId.get(id)!,
        );
      }, "已保存资料顺序");
      await window.flushBoardDraft?.();
    },
    onError: setNotice,
  });
  const ordered = previewOrder
    ? previewOrder.flatMap((id) => resources.filter((item) => item.id === id))
    : resources;

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setNotice("正在保存原件…");
    try {
      await addResources(files, activePlan.id);
      setNotice("");
      setTrash(false);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "保存失败，请重新选择文件重试",
      );
    } finally {
      setBusy(false);
    }
  };

  const openResource = async (resource: ResourceItem, download = false) => {
    try {
      const open = download
        ? adapter.downloadResource?.bind(adapter)
        : adapter.openResource?.bind(adapter);
      if (!open) throw Error("当前环境不能打开资料");
      await open(resource);
      setNotice("");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "打开失败，请重试");
    }
  };

  return (
    <section
      className="sx-library"
      aria-label="资料库面板"
      data-testid="library-panel"
    >
      <div className="sx-library-toolbar">
        {!floating ? <h2>资料库</h2> : null}
        <label className="sx-button sx-button-primary sx-upload">
          <FilePlus size={15} /> 添加资料
          <input
            type="file"
            multiple
            onChange={(event) => void addFiles(event)}
            disabled={busy}
            aria-label="添加图片或文件"
          />
        </label>
        {!floating ? (
          <>
            <select
              aria-label="资料类型"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="all">全部</option>
              <option value="image">图片</option>
              <option value="file">文件</option>
            </select>
            <select
              aria-label="资料排列"
              value={view}
              onChange={(e) => setView(e.target.value as typeof view)}
            >
              <option value="gallery">画廊</option>
              <option value="table">列表</option>
            </select>
            <button type="button" onClick={() => setTrash(!trash)}>
              {trash ? "返回资料库" : "最近移除"}
            </button>
          </>
        ) : null}
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      <span className="sx-sr-only" aria-live="polite">
        {drag.announcement}
      </span>
      {!ordered.length ? <p className="sx-empty-inline">暂无资料</p> : null}
      <div
        ref={root}
        className={view === "gallery" ? "sx-gallery" : "sx-library-list"}
      >
        {ordered.map((resource) => (
          <article
            key={resource.id}
            className="sx-library-card"
            data-motion-id={resource.id}
            onPointerDown={drag.onPointerDown}
          >
            <div className="sx-library-card-row">
              {!trash ? (
                <span
                  data-card-drag-handle
                  className="sx-library-grip"
                  title="拖动排序"
                >
                  <GripVertical size={17} />
                </span>
              ) : null}
              <span className="sx-library-type">{resource.fileType}</span>
              <strong>{resource.name}</strong>
              {!trash ? (
                <button
                  type="button"
                  onClick={() => void openResource(resource)}
                  aria-label={`打开资料：${resource.name}`}
                >
                  打开
                </button>
              ) : null}
              <details className="sx-item-menu">
                <summary aria-label={`资料操作：${resource.name}`}>⋯</summary>
                <div className="sx-menu-content">
                  {!trash ? (
                    <form
                      key={resource.name}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = String(
                          new FormData(e.currentTarget).get("name") ?? "",
                        ).trim();
                        if (name)
                          commit((draft) => {
                            const item = draft.resources.find(
                              (r) => r.id === resource.id,
                            );
                            if (item) item.name = name;
                          }, "已重命名资料");
                      }}
                    >
                      <input
                        name="name"
                        aria-label="资料显示名"
                        required
                        maxLength={255}
                        defaultValue={resource.name}
                      />
                      <button type="submit">保存名称</button>
                    </form>
                  ) : null}
                  <label>
                    关联长期计划
                    <select
                      aria-label="资料关联长期计划"
                      value={resource.longPlanId || ""}
                      disabled={trash}
                      onChange={(e) =>
                        commit((d) => {
                          const r = d.resources.find(
                            (r) => r.id === resource.id,
                          );
                          if (r) r.longPlanId = e.target.value || undefined;
                        }, "已保存资料关联")
                      }
                    >
                      <option value="">仅属于当前规划</option>
                      {snapshot.longPlans
                        .filter(
                          (p) =>
                            p.planningId === activePlan.id &&
                            (!p.deletedAt || p.id === resource.longPlanId),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                            {p.deletedAt ? "（已删除）" : ""}
                          </option>
                        ))}
                    </select>
                  </label>

                  {!trash && adapter.downloadResource ? (
                    <button
                      type="button"
                      onClick={() => void openResource(resource, true)}
                    >
                      另存原件
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      commit(
                        (draft) => {
                          const item = draft.resources.find(
                            (r) => r.id === resource.id,
                          );
                          if (item)
                            item.deletedAt = trash
                              ? undefined
                              : new Date().toISOString();
                        },
                        trash ? "已恢复资料" : "已移到最近移除",
                      );
                    }}
                  >
                    {trash ? "恢复资料" : "移除资料"}
                  </button>
                </div>
              </details>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
