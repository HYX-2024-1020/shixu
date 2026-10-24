import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Palette,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import SkinArt from "./SkinArt";
import SkinMascot from "./SkinMascot";
import {
  BUILTIN_SKINS,
  MAX_CUSTOM_SKINS,
  readSkinImage,
  SKIN_MOTIONS,
  type Skin,
  type SkinCollection,
  type SkinMotion,
} from "./skins";

const EMPTY_SKIN: Skin = {
  id: "custom-draft",
  art: "custom",
  name: "我的小伙伴",
  description: "自己创造的，当然最特别。",
  color: "#e3ddff",
  motion: "bounce",
  hello: "扔给我，什么都吃！",
  greeting: "见到你真开心！",
  feeding: "啊呜，已经接住啦！",
};

export default function SkinMarket({
  collection,
  onChange,
  onClose,
}: {
  collection: SkinCollection;
  onChange: (collection: SkinCollection) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [previewId, setPreviewId] = useState(collection.selected);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Skin | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [demoState, setDemoState] = useState<"idle" | "feeding">("idle");
  const [deleteId, setDeleteId] = useState("");
  const uploadRequest = useRef(0);
  const feedTimer = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    element?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      clearTimeout(feedTimer.current);
      uploadRequest.current++;
      opener?.focus({ preventScroll: true });
    };
  }, []);
  const skins = [...BUILTIN_SKINS, ...collection.custom];
  const preview =
    editing || skins.find((s) => s.id === previewId) || BUILTIN_SKINS[0];
  const listed = skins.filter(
    (s) =>
      filter === "all" ||
      (filter === "mine" ? s.art === "custom" : s.art !== "custom"),
  );
  function resetInteraction() {
    setDemoState("idle");
    clearTimeout(feedTimer.current);
    setError("");
    setDeleteId("");
  }
  function startEditing(skin?: Skin) {
    if (!skin && collection.custom.length >= MAX_CUSTOM_SKINS) {
      setError(`最多收藏 ${MAX_CUSTOM_SKINS} 个自定义皮肤，请先删除一个再添加`);
      return;
    }
    resetInteraction();
    uploadRequest.current++;
    setUploading(false);
    setEditing(skin ? { ...skin } : { ...EMPTY_SKIN });
  }
  function cancelEditing() {
    uploadRequest.current++;
    setUploading(false);
    setEditing(null);
    resetInteraction();
  }
  function commit(next: SkinCollection) {
    try {
      onChange(next);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "皮肤保存失败，请重试");
      return false;
    }
  }
  function save() {
    if (!editing?.image) {
      setError("先为小伙伴上传一张图片吧");
      return;
    }
    if (
      !editing.name.trim() ||
      !editing.hello.trim() ||
      !editing.greeting.trim() ||
      !editing.feeding.trim()
    ) {
      setError("请填写名称和三句互动台词");
      return;
    }
    const exists = collection.custom.some((s) => s.id === editing.id);
    const skin = {
      ...editing,
      id: exists ? editing.id : `custom-${crypto.randomUUID()}`,
      name: editing.name.trim(),
    };
    const custom = exists
      ? collection.custom.map((s) => (s.id === skin.id ? skin : s))
      : [...collection.custom, skin];
    if (commit({ ...collection, custom })) {
      setPreviewId(skin.id);
      setFilter("mine");
      cancelEditing();
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    const request = ++uploadRequest.current;
    setUploading(true);
    setError("");
    try {
      const image = await readSkinImage(file);
      if (request === uploadRequest.current)
        setEditing((s) => (s ? { ...s, image } : s));
    } catch (e) {
      if (request === uploadRequest.current)
        setError(e instanceof Error ? e.message : "图片读取失败");
    } finally {
      if (request === uploadRequest.current) setUploading(false);
    }
  }
  function feed() {
    setDemoState("feeding");
    clearTimeout(feedTimer.current);
    feedTimer.current = window.setTimeout(() => setDemoState("idle"), 2800);
  }
  function remove(skin: Skin) {
    if (
      commit({
        selected:
          collection.selected === skin.id ? "whale" : collection.selected,
        custom: collection.custom.filter((s) => s.id !== skin.id),
      })
    ) {
      setPreviewId("whale");
      setDeleteId("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="skin-market"
      aria-labelledby="skin-market-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <header className="skin-market-header">
        <div>
          <span className="skin-eyebrow">
            <Palette size={14} /> THE SKIN CLUB
          </span>
          <h2 id="skin-market-title">
            给你的桶，换个新朋友<span>✦</span>
          </h2>
          <p>不同的模样，同样什么都能装。</p>
        </div>
        <button
          className="skin-icon-button"
          aria-label="关闭皮肤市场"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      <div className="skin-market-layout">
        <aside className="skin-preview-panel">
          <span className="skin-eyebrow">
            {editing ? "你的专属创作" : "试着戳一下它"} <span>↙</span>
          </span>
          <div
            className="skin-preview-stage"
            style={{ backgroundColor: preview.color }}
          >
            {preview.art === "custom" && !preview.image ? (
              <div className="skin-upload-placeholder">
                <Palette size={54} />
                <span>等你赋予它模样</span>
              </div>
            ) : (
              <SkinMascot
                key={preview.id}
                skin={preview}
                state={demoState}
                compact
              />
            )}
            <span className="skin-stage-label">HELLO, NEW FRIEND.</span>
          </div>
          <div className="skin-preview-copy">
            <h3>{preview.name || "还没起名的小伙伴"}</h3>
            <p>{preview.description}</p>
            <span className="skin-motion-label">
              ✧ {SKIN_MOTIONS[preview.motion]}
              {preview.art === "whale" ? " · 原版笑声" : " · 点击互动"}
            </span>
          </div>
          <button
            className="skin-button skin-feed-button"
            disabled={preview.art === "custom" && !preview.image}
            onClick={feed}
          >
            试着喂一口 <span>↘</span>
          </button>
          {!editing && (
            <button
              className={`skin-button skin-apply ${collection.selected === preview.id ? "is-applied" : ""}`}
              onClick={() => commit({ ...collection, selected: preview.id })}
              disabled={collection.selected === preview.id}
            >
              {collection.selected === preview.id ? (
                <>
                  <CheckCheck size={17} /> 正在陪伴你
                </>
              ) : (
                <>
                  就选这个朋友 <Check size={17} />
                </>
              )}
            </button>
          )}
          {!editing && preview.art === "custom" && (
            <div className="skin-custom-actions">
              <button onClick={() => startEditing(preview)}>编辑皮肤</button>
              <button onClick={() => setDeleteId(preview.id)}>
                <Trash2 size={13} /> 删除
              </button>
            </div>
          )}
          {deleteId === preview.id && (
            <div className="skin-delete-confirm">
              <p>删除后需重新上传这张皮肤。</p>
              <button onClick={() => remove(preview)}>确认删除</button>
              <button onClick={() => setDeleteId("")}>保留</button>
            </div>
          )}
        </aside>
        <section
          className="skin-collection-panel"
          aria-label={editing ? "自定义皮肤" : "皮肤收藏"}
        >
          {editing ? (
            <>
              <button className="skin-back" onClick={cancelEditing}>
                <ArrowLeft size={15} /> 回到皮肤收藏
              </button>
              <h3 className="skin-editor-heading">
                创造一个，只属于你的伙伴。
              </h3>
              <form
                className="skin-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="上传皮肤图片"
                  hidden
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="skin-upload"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={23} />
                  <strong>
                    {uploading
                      ? "正在准备图片…"
                      : editing.image
                        ? "换一张图片"
                        : "上传你的角色图片"}
                  </strong>
                  <small>PNG / JPG / WebP · 最大 8 MB，透明背景更好看</small>
                </button>
                <div className="skin-form-row">
                  <label>
                    伙伴的名字
                    <input
                      required
                      maxLength={20}
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    舞台颜色
                    <input
                      className="skin-color-input"
                      type="color"
                      value={editing.color}
                      onChange={(e) =>
                        setEditing({ ...editing, color: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  一句介绍
                  <input
                    maxLength={60}
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                  />
                </label>
                <fieldset>
                  <legend>被戳到时，做什么动作？</legend>
                  <div className="skin-motion-options">
                    {Object.entries(SKIN_MOTIONS).map(([id, name]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={editing.motion === id}
                        onClick={() =>
                          setEditing({ ...editing, motion: id as SkinMotion })
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label>
                  平时说什么
                  <input
                    required
                    maxLength={40}
                    value={editing.hello}
                    onChange={(e) =>
                      setEditing({ ...editing, hello: e.target.value })
                    }
                  />
                </label>
                <label>
                  被戳到时说什么
                  <input
                    required
                    maxLength={40}
                    value={editing.greeting}
                    onChange={(e) =>
                      setEditing({ ...editing, greeting: e.target.value })
                    }
                  />
                </label>
                <label>
                  吃到东西时说什么
                  <input
                    required
                    maxLength={40}
                    value={editing.feeding}
                    onChange={(e) =>
                      setEditing({ ...editing, feeding: e.target.value })
                    }
                  />
                </label>
                {error && (
                  <p className="skin-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="skin-editor-footer">
                  <span>图片会优化后保存在这台设备。</span>
                  <button
                    type="submit"
                    className="skin-button skin-save"
                    disabled={uploading}
                  >
                    保存到我的收藏 <Check size={16} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="skin-collection-toolbar">
                <div
                  className="skin-filters"
                  role="group"
                  aria-label="筛选皮肤"
                >
                  {[
                    ["all", "全部伙伴"],
                    ["builtin", "预设"],
                    ["mine", "我的收藏"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      aria-pressed={filter === id}
                      onClick={() => {
                        setFilter(id);
                        setError("");
                      }}
                    >
                      {name}
                      {id === "mine" && <span>{collection.custom.length}</span>}
                    </button>
                  ))}
                </div>
                <button className="skin-add" onClick={() => startEditing()}>
                  <Plus size={16} /> 自己做一个
                </button>
              </div>
              {error && (
                <p className="skin-error" role="alert">
                  {error}
                </p>
              )}
              <div className="skin-grid">
                {listed.map((skin) => (
                  <button
                    className="skin-card"
                    key={skin.id}
                    aria-label={`预览${skin.name}`}
                    aria-pressed={preview.id === skin.id}
                    onClick={() => {
                      setPreviewId(skin.id);
                      resetInteraction();
                    }}
                  >
                    <span
                      className="skin-card-stage"
                      style={{ backgroundColor: skin.color }}
                    >
                      <SkinArt skin={skin} />
                      {collection.selected === skin.id && (
                        <span className="skin-equipped">
                          <Check size={11} /> 使用中
                        </span>
                      )}
                      <span className="skin-card-index">
                        {skin.art === "custom"
                          ? "DIY"
                          : `0${BUILTIN_SKINS.indexOf(skin) + 1}`}
                      </span>
                    </span>
                    <span className="skin-card-copy">
                      <strong>{skin.name}</strong>
                      <small>{skin.description}</small>
                      <span>
                        {SKIN_MOTIONS[skin.motion]} <span>↗</span>
                      </span>
                    </span>
                  </button>
                ))}
                <button
                  className="skin-create-card"
                  onClick={() => startEditing()}
                >
                  <span>
                    <Plus size={29} />
                  </span>
                  <strong>下一个伙伴，由你创造</strong>
                  <small>上传图片 · 设计专属互动</small>
                </button>
              </div>
              <p className="skin-collection-note">
                全部预设，随心换。自定义收藏 {collection.custom.length}/
                {MAX_CUSTOM_SKINS} · 仅保存在当前设备与浏览器。
              </p>
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
