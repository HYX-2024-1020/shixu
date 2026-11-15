import { useMemo, useState, type ChangeEvent } from "react";
import { ExternalLink, FilePlus, LayoutGrid, Table2, X } from "lucide-react";
import type { ResourceItem } from "../types/board";
import { formatDate } from "../utils/board";
import { useBoard } from "./BoardProvider";
import { WindowFrame } from "./WindowFrame";

function ResourcePreview({
  resource,
  large = false,
}: {
  resource: ResourceItem;
  large?: boolean;
}) {
  return (
    <div
      className={`sx-resource-preview ${large ? "sx-resource-preview-large" : ""}`}
    >
      {resource.kind === "image" && resource.url ? (
        <img src={resource.url} alt={resource.name} />
      ) : resource.preview ? (
        <div className="sx-note-paper">
          <strong>
            {resource.preview === "math"
              ? "积分 · 换元法"
              : "Reading / 错题复盘"}
          </strong>
          {(resource.preview === "math"
            ? ["∫ f(x) dx = F(x) + C", "① 先找内层函数", "② 代换后检查定义域"]
            : ["main idea → 先看首尾句", "例证 ≠ 作者观点", "圈出转折：however"]
          ).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      ) : (
        <span className="sx-file-type">{resource.fileType}</span>
      )}
    </div>
  );
}

export function LibraryPanel() {
  const { snapshot, activePlan, adapter, addResources, commit } = useBoard();
  const [filter, setFilter] = useState<"all" | "image" | "file">("all");
  const [view, setView] = useState<"gallery" | "table">("gallery");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [trash, setTrash] = useState(false);

  const resources = useMemo(
    () =>
      snapshot.resources.filter(
        (item) =>
          item.planningId === activePlan.id && !!item.deletedAt === trash,
      ),
    [snapshot.resources, activePlan.id, trash],
  );
  const filtered = resources.filter(
    (item) => filter === "all" || item.kind === filter,
  );
  const selected = resources.find((item) => item.id === selectedId) ?? null;

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setNotice("正在保存原件…");
    try {
      await addResources(files, activePlan.id);
      setNotice("原件已保存到当前资料空间；云端状态可在账号设置核对");
      setTrash(false);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "保存失败，请重新选择文件重试",
      );
    } finally {
      setBusy(false);
    }
  };

  const openResource = async (resource: ResourceItem) => {
    try {
      if (!adapter.openResource) throw Error("当前环境不能打开资料");
      await adapter.openResource(resource);
      setNotice("已打开资料预览");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "打开失败，请重试");
    }
  };

  return (
    <div data-testid="library-panel">
      <WindowFrame
        title="资料库"
        subtitle={activePlan.name}
        className="sx-library"
        label="资料库面板"
        footer={
          <>
            <span aria-live="polite">
              {resources.length} 份资料 · {filtered.length} 份显示
            </span>
            <span>原件独立保存，不投递桶或调用模型</span>
          </>
        }
      >
        <div className="sx-library-intro">
          <div>
            <span className="sx-eyebrow">REFERENCE / 随手可用</span>
            <h2>用得上的资料，留在手边。</h2>
          </div>
          <label className="sx-button sx-button-primary sx-upload">
            <FilePlus size={15} /> 添加图片 / 文件
            <input
              type="file"
              multiple
              onChange={(event) => void addFiles(event)}
              disabled={busy}
              aria-label="添加图片或文件"
            />
          </label>
        </div>
        <button
          className="sx-button"
          type="button"
          onClick={() => {
            setTrash(!trash);
            setSelectedId(null);
          }}
        >
          {trash ? "返回资料库" : "最近移除"}
        </button>
        <div className="sx-library-tools">
          <div className="sx-segmented" aria-label="资料类型筛选">
            {(["all", "image", "file"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "全部"
                  : value === "image"
                    ? "笔记图片"
                    : "文件"}
              </button>
            ))}
          </div>
          <div className="sx-segmented" aria-label="资料视图">
            <button
              type="button"
              aria-pressed={view === "gallery"}
              onClick={() => setView("gallery")}
            >
              <LayoutGrid size={13} /> 画廊
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              <Table2 size={13} /> 表格
            </button>
          </div>
        </div>
        {!filtered.length ? (
          <div className="sx-empty sx-library-empty">
            <strong>
              {resources.length ? "这个筛选下没有资料" : "资料库还是空的"}
            </strong>
            <span>
              {resources.length
                ? "切换到全部看看。"
                : "添加图片或文件，保存后可在重启后继续使用。"}
            </span>
          </div>
        ) : null}
        <div
          className="sx-gallery"
          hidden={view !== "gallery" || !filtered.length}
        >
          {filtered.map((resource) => (
            <button
              className="sx-resource-card"
              type="button"
              key={resource.id}
              onClick={() => setSelectedId(resource.id)}
            >
              <ResourcePreview resource={resource} />
              <span className="sx-resource-info">
                <strong>{resource.name}</strong>
                <small>
                  {resource.fileType} · {resource.planLabel} ·{" "}
                  {formatDate(resource.createdAt)}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div
          className="sx-table-wrap"
          hidden={view !== "table" || !filtered.length}
        >
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>关联计划</th>
                <th>添加时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((resource) => (
                <tr key={resource.id}>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelectedId(resource.id)}
                    >
                      {resource.name}
                    </button>
                  </td>
                  <td>{resource.fileType}</td>
                  <td>{resource.planLabel}</td>
                  <td>{formatDate(resource.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected ? (
          <section className="sx-resource-detail" aria-label="资料详情">
            <label>
              关联长期计划
              <select
                aria-label="资料关联长期计划"
                value={selected.longPlanId || ""}
                disabled={trash}
                onChange={(e) =>
                  commit((d) => {
                    const r = d.resources.find((r) => r.id === selected.id);
                    if (r) r.longPlanId = e.target.value || undefined;
                  }, "已保存资料关联")
                }
              >
                <option value="">仅属于当前规划</option>
                {snapshot.longPlans
                  .filter(
                    (p) =>
                      p.planningId === activePlan.id &&
                      (!p.deletedAt || p.id === selected.longPlanId),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                      {p.deletedAt ? "（已删除）" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <div className="sx-section-head">
              <h3>{selected.name}</h3>
              <button
                className="sx-icon-button"
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="收起资料详情"
              >
                <X size={15} />
              </button>
            </div>
            <ResourcePreview resource={selected} large />
            <p>
              {selected.fileType} · {selected.sizeLabel} · 关联：
              {selected.planLabel} · {formatDate(selected.createdAt)}
            </p>
            <p>
              {selected.deletedAt
                ? "已从资料库移除；原件按现有保留期保存，可恢复。"
                : "原件属于本规划，不会自动进入桶或调用模型。"}
            </p>
            <button
              className="sx-button"
              type="button"
              disabled={trash}
              onClick={() => void openResource(selected)}
            >
              <ExternalLink size={14} /> 打开资料
            </button>
            <button
              className="sx-button"
              type="button"
              onClick={() => {
                commit(
                  (draft) => {
                    const r = draft.resources.find((r) => r.id === selected.id);
                    if (r)
                      r.deletedAt = trash
                        ? undefined
                        : new Date().toISOString();
                  },
                  trash ? "已恢复资料" : "已移到最近移除",
                );
                setSelectedId(null);
              }}
            >
              {trash ? "恢复资料" : "移除资料（保留30天）"}
            </button>
          </section>
        ) : null}
        <div className="sx-library-notice" aria-live="polite">
          {notice}
        </div>
      </WindowFrame>
    </div>
  );
}
