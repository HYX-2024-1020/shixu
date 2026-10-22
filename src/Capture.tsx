import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  FileText,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { Modal, DraftFields, Badge } from "./components";
import { organize, organizeWithAI } from "./organize";
import { extractFile, extractiveSummary } from "./files";
import { type Draft, type Entry, type Preferences } from "./types";

export default function Capture({
  draftKey,
  initialText,
  preferences,
  aiKey,
  projects,
  onClose,
  onSave,
  notify,
  openSettings,
}: {
  draftKey: string;
  initialText: string;
  preferences: Preferences;
  aiKey: string;
  projects: string[];
  onClose: () => void;
  onSave: (entries: Entry[]) => Promise<void>;
  notify: (message: string) => void;
  openSettings: () => void;
}) {
  const [text, setText] = useState(() => {
      try {
        return initialText || sessionStorage.getItem(draftKey) || "";
      } catch {
        return initialText;
      }
    }),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [expanded, setExpanded] = useState(0);
  const [busy, setBusy] = useState(""),
    [fileName, setFileName] = useState(""),
    [mode, setMode] = useState("本机整理"),
    [summary, setSummary] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, text);
      } catch {
        /* Captures can still be saved normally. */
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [text, draftKey]);
  async function handleFile(file?: File) {
    if (!file) return;
    setBusy("读取文件");
    try {
      const extracted = await extractFile(file);
      setText(extracted);
      setFileName(file.name);
      setDrafts([]);
      setSummary([]);
      notify(`已提取 ${extracted.length.toLocaleString()} 字，原文件不会上传`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "文件提取失败");
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  }
  async function process(ai = false) {
    if (!text.trim()) return;
    if (text.length > 60000) {
      notify("最多处理 6 万字，请拆分后整理");
      return;
    }
    if (ai && (!preferences.aiEndpoint || !preferences.aiModel)) {
      notify("请先在设置里配置 AI 接口和模型");
      return;
    }
    if (ai && text.length > 20000) {
      notify("AI 每次最多处理 2 万字，请拆分后重试，避免截断原文");
      return;
    }
    setBusy(ai ? "AI 正在整理" : "正在提取");
    try {
      const result = ai
        ? await organizeWithAI(
            text,
            preferences.aiEndpoint,
            preferences.aiModel,
            aiKey,
          )
        : organize(text);
      if (!result.length) throw new Error("没有找到可收纳的文字");
      setDrafts(result);
      setSource(text);
      setSummary(extractiveSummary(text));
      setExpanded(0);
      setMode(ai ? "AI 整理" : "本机规则提取");
      if (result.length === 50)
        notify("最多提取 50 条，建议将长文拆分后再整理");
    } catch (e) {
      notify(e instanceof Error ? e.message : "整理失败，请重试");
    } finally {
      setBusy("");
    }
  }
  async function save(inbox: boolean) {
    const list = inbox ? organize(text) : drafts;
    if (!list.length || list.some((d) => !d.title.trim())) {
      notify("请为每条事项填写标题");
      return;
    }
    setBusy("正在保存");
    try {
      const at = new Date().toISOString();
      await onSave(
        list.map((d) => ({
          ...d,
          tags: d.tags.filter(Boolean),
          id: crypto.randomUUID(),
          title: d.title.trim(),
          content: d.content.slice(0, 20000),
          confirmedDate: !inbox,
          status: inbox ? "inbox" : "active",
          createdAt: at,
          updatedAt: at,
          checkins: [],
        })),
      );
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Optional draft cache. */
      }
      notify(`已${inbox ? "放入收集箱" : "收纳"} ${list.length} 条事项`);
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal
      title="把脑海里的事，放在这里"
      subtitle="通知、作业、突然冒出的点子，都可以。先记录，再理顺。"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="capture-body">
        <div className="capture-label">
          <span>
            <span className="live-dot" />
            随手一记
          </span>
          <span>{text.length.toLocaleString()} / 60,000</span>
        </div>
        <textarea
          className="capture-input"
          aria-label="待整理的内容"
          autoFocus
          placeholder={
            "粘贴老师发来的长通知，或记下一个小小的灵感…\n\n例如：下周三下午 3 点交设计作业，记得附上过程稿。\n还有，想做一个校园旧书交换地图。"
          }
          value={text}
          maxLength={60000}
          rows={7}
          onChange={(e) => {
            setText(e.target.value);
            if (drafts.length) setDrafts([]);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy) {
              e.preventDefault();
              void process();
            }
          }}
        />
        <div className="capture-tools">
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => input.current?.click()}
          >
            <FileText size={16} />
            {fileName || "从文件提取文字"}
          </button>
          <input
            ref={input}
            type="file"
            accept=".txt,.md,.csv,.pdf,.docx"
            hidden
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <span>TXT / PDF / DOCX / MD / CSV · ≤15 MB</span>
        </div>
        <div className="process-actions">
          <button
            className="button primary"
            disabled={!text.trim() || !!busy}
            onClick={() => void process()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <WandSparkles size={16} />
            )}
            本机提取整理
          </button>
          <button
            className="button soft"
            disabled={!text.trim() || !!busy}
            onClick={() => void process(true)}
          >
            <Sparkles size={16} />
            发送给 AI 整理
          </button>
          <button
            className="text-button"
            disabled={!text.trim() || !!busy}
            onClick={() => void save(true)}
          >
            先放收集箱
            <ArrowRight size={14} />
          </button>
        </div>
        <p className="helper">
          本机提取不联网。AI 整理会把上方文字发送至你设置的接口。
          <button onClick={openSettings}>配置 AI</button>
        </p>
        {busy && (
          <p className="processing" role="status">
            <LoaderCircle className="spin" size={16} />
            {busy}，请稍等…
          </p>
        )}
        {!!drafts.length && (
          <div className="results">
            <div className="result-title">
              <div>
                <Sparkles size={17} />
                <h3>整理好了，来确认一下</h3>
              </div>
              <span>
                {mode} · {drafts.length} 条
              </span>
            </div>
            {!!summary.length && (
              <div className="summary">
                <b>原文重点摘录</b>
                <ul>
                  {summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <small>
                  摘录自原文，不能替代完整通知。请核对要求、附件与日期。
                </small>
              </div>
            )}
            <div className="draft-list">
              {drafts.map((draft, index) => (
                <section className="draft-item" key={index}>
                  <div className="draft-heading">
                    <button
                      onClick={() =>
                        setExpanded(expanded === index ? -1 : index)
                      }
                    >
                      <Badge kind={draft.kind} />
                      <strong>{draft.title || "未命名事项"}</strong>
                      {draft.due && <span>{draft.due} · 待确认</span>}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`移除第 ${index + 1} 条`}
                      onClick={() =>
                        setDrafts(drafts.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {expanded === index && (
                    <DraftFields
                      value={draft}
                      projects={projects}
                      onChange={(value) =>
                        setDrafts(
                          drafts.map((d, i) => (i === index ? value : d)),
                        )
                      }
                    />
                  )}
                </section>
              ))}
            </div>
            <details className="source">
              <summary>查看整理时的完整原文</summary>
              <pre>{source}</pre>
            </details>
            <div className="modal-footer">
              <span>确认日期、分类与内容后，收纳到对应页面。</span>
              <button
                className="button primary"
                disabled={!!busy || !drafts.length}
                onClick={() => void save(false)}
              >
                确认并收纳 <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
        {!drafts.length && !busy && (
          <div className="capture-examples">
            <span>试试这样记</span>
            {[
              "明天下午 3 点交高数作业 #学习",
              "每天睡前读 20 分钟",
              "灵感：校园旧书交换地图",
            ].map((s) => (
              <button key={s} onClick={() => setText(s)}>
                <Plus size={12} />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
