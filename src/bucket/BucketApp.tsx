import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Leaf,
  LoaderCircle,
  Paperclip,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import {
  DEFAULT_MODEL,
  organizePacket,
  checkSources,
  validateResult,
} from "../../shared/bucket-engine.mjs";
import { localDate } from "../organize";
import { extractFile } from "../files";
import {
  allPackets,
  putPacket,
  readDraft,
  writeDraft,
  allUsage,
  putUsage,
} from "./store";
import { usageTotals, money, type UsageRecord } from "../../shared/usage.mjs";
import { modelLabel } from "./model-api";
import {
  detectService,
  serviceRequest,
  uploadPacket,
  type Health,
} from "./service";
import { samplePacket, SAMPLE_TEXT, SAMPLE_FILE } from "./demo";
import Connection from "./Connection";
import PacketCard from "./PacketCard";
import type { Packet, Attachment } from "./types";
import "./bucket.css";

const DEMO = new URLSearchParams(location.search).has("preview");
const CONFIG_KEY = DEMO
  ? "shixu-bucket-connection-demo"
  : "shixu-bucket-connection";
function initialConfig() {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    return {
      key: value.rememberKey && typeof value.key === "string" ? value.key : "",
      model: typeof value.model === "string" ? value.model : DEFAULT_MODEL,
      rememberKey: value.rememberKey === true,
    };
  } catch {
    return { key: "", model: DEFAULT_MODEL, rememberKey: false };
  }
}
function message(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      return "整理超时，原文和附件已经保留，可以重试";
    if (error instanceof TypeError)
      return "暂时连不上服务，内容已经保留，请检查网络后重试";
    return error.message;
  }
  return "暂时没整理好，内容已经保留";
}

export default function BucketApp() {
  const [initial] = useState(initialConfig),
    [apiKey, setApiKey] = useState(initial.key),
    [model, setModel] = useState(initial.model),
    [remember, setRemember] = useState(initial.rememberKey);
  const [packets, setPackets] = useState<Packet[]>([]),
    [usage, setUsage] = useState<UsageRecord[]>([]),
    [text, setText] = useState(""),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [loaded, setLoaded] = useState(false),
    [settings, setSettings] = useState(false),
    [toast, setToast] = useState(""),
    [drag, setDrag] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [health, setHealth] = useState<Health | null>(null),
    [progress, setProgress] = useState(""),
    [workingId, setWorkingId] = useState("");
  const packetsRef = useRef<Packet[]>([]),
    working = useRef(false),
    syncing = useRef(false),
    input = useRef<HTMLInputElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    submitLock = useRef(false),
    toastTimer = useRef<number>(0);
  const notify = useCallback((value: string) => {
    setToast(value);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 7000);
  }, []);
  const save = useCallback(async (packet: Packet) => {
    await putPacket(packet);
    const map = new Map(packetsRef.current.map((p) => [p.id, p]));
    map.set(packet.id, packet);
    const next = [...map.values()].sort((a, b) =>
      b.capturedAt.localeCompare(a.capturedAt),
    );
    packetsRef.current = next;
    setPackets(next);
  }, []);
  const recordUsage = useCallback(async (record: UsageRecord) => {
    await putUsage(record);
    setUsage((rows) => [...rows.filter((r) => r.id !== record.id), record]);
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      let stored = await allPackets();
      if (!active) return;
      if (DEMO && !stored.length) {
        const sample = samplePacket();
        await putPacket(sample);
        stored = [sample];
      }
      for (const p of stored)
        if (p.status === "processing" && !p.remote) {
          p.status = "pending";
          await putPacket(p);
        }
      const draft = await readDraft();
      const calls = await allUsage();
      if (!active) return;
      packetsRef.current = stored;
      setPackets(stored);
      setUsage(calls);
      setText(draft.text);
      setAttachments(draft.attachments);
      setLoaded(true);
    })().catch((error) => notify(message(error)));
    return () => {
      active = false;
    };
  }, [notify]);
  useEffect(() => {
    if (!loaded) return;
    const timeout = setTimeout(() => {
      void writeDraft({ text, attachments }).catch((error) =>
        notify(message(error)),
      );
    }, 400);
    return () => clearTimeout(timeout);
  }, [text, attachments, loaded, notify]);
  useEffect(() => {
    if (DEMO) return;
    let active = true;
    const detect = async () => {
      const result = await detectService();
      if (!active) return;
      if (result) {
        setHealth(result);
        setModel(result.model || DEFAULT_MODEL);
        if (!result.authenticated) setSettings(true);
      }
    };
    void detect();
    window.addEventListener("online", detect);
    return () => {
      active = false;
      window.removeEventListener("online", detect);
    };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current || !health?.authenticated || !navigator.onLine) return;
    syncing.current = true;
    try {
      for (const p of packetsRef.current.filter(
        (p) => p.remoteDirty && p.remote,
      )) {
        const result = await serviceRequest("packets/" + p.id + "/done", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doneIds: p.doneIds }),
        });
        await save({
          ...result.packet,
          attachments: p.attachments,
          remote: true,
          remoteDirty: false,
        });
      }
      const data = await serviceRequest("packets");
      if (!Array.isArray(data.packets)) throw new Error("同步内容无效");
      if (Array.isArray(data.usage)) setUsage(data.usage);
      for (const raw of data.packets) {
        if (
          !raw ||
          typeof raw.id !== "string" ||
          typeof raw.updatedAt !== "string"
        )
          continue;
        const current = packetsRef.current.find((p) => p.id === raw.id);
        if (current?.remoteDirty) continue;
        if (current && current.updatedAt > raw.updatedAt) continue;
        const p = raw as Packet;
        if (p.result) validateResult(p.result, p.sources, p.captureDate);
        await save({
          ...p,
          remote: true,
          attachments: p.attachments.map((a) => ({
            ...a,
            blob: current?.attachments.find((old) => old.id === a.id)?.blob,
          })),
        });
      }
    } catch (error) {
      if ((error as Error).message?.includes("访问口令")) {
        setHealth((h) => (h ? { ...h, authenticated: false } : h));
      } else if (
        packetsRef.current.some((p) => p.remote && p.status === "processing")
      )
        setProgress("个人服务正在处理，稍后会继续同步");
    } finally {
      syncing.current = false;
    }
  }, [health?.authenticated, save]);
  useEffect(() => {
    if (!health?.authenticated) return;
    void sync();
    const timer = setInterval(() => void sync(), 4000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [health?.authenticated, sync]);

  useEffect(() => {
    if (
      !loaded ||
      working.current ||
      !online ||
      (!apiKey && !health?.authenticated)
    )
      return;
    if (health && !health.modelReady) return;
    const packet = packets.find(
      (p) => p.status === "pending" && !p.deletedAt && !p.remote,
    );
    if (!packet) return;
    working.current = true;
    setWorkingId(packet.id);
    setProgress("正在读取这次投递");
    (async () => {
      let current = {
        ...packet,
        status: "processing" as const,
        updatedAt: new Date().toISOString(),
      };
      await save(current);
      try {
        const sources = current.text.trim()
          ? [{ id: "input", name: "随手输入", text: current.text.trim() }]
          : [];
        for (const a of current.attachments) {
          setProgress(`正在读 ${a.name}`);
          const existing = current.sources.find((s) => s.id === a.id);
          if (existing) {
            sources.push(existing);
            continue;
          }
          if (!a.blob) throw new Error(`原文件 ${a.name} 不在这台设备上`);
          try {
            const extracted = await extractFile(
              new File([a.blob], a.name, { type: a.type }),
            );
            sources.push({ id: a.id, name: a.name, text: extracted });
          } catch (error) {
            throw new Error(`${a.name}：${message(error)}`);
          }
        }
        checkSources(sources);
        current = { ...current, sources, updatedAt: new Date().toISOString() };
        if (packetsRef.current.find((p) => p.id === current.id)?.deletedAt)
          return;
        await save(current);
        if (health) {
          const remote = await uploadPacket(current);
          if (packetsRef.current.find((p) => p.id === current.id)?.deletedAt) {
            await serviceRequest("packets/" + current.id, { method: "DELETE" });
            return;
          }
          await save({
            ...remote,
            attachments: current.attachments,
            remote: true,
          });
          void sync();
        } else {
          const result = await organizePacket(sources, {
            apiKey,
            model,
            captureDate: current.captureDate,
            signal: AbortSignal.timeout(240000),
            onProgress: setProgress,
            packetId: current.id,
            onUsage: recordUsage,
          });
          if (packetsRef.current.find((p) => p.id === current.id)?.deletedAt)
            return;
          await save({
            ...current,
            status: "ready",
            result,
            error: "",
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (packetsRef.current.find((p) => p.id === current.id)?.deletedAt)
          return;
        await save({
          ...current,
          status: "error",
          error: message(error),
          updatedAt: new Date().toISOString(),
        });
      }
    })()
      .catch((error) => notify(message(error)))
      .finally(() => {
        working.current = false;
        setWorkingId("");
        setProgress("");
        setPackets([...packetsRef.current]);
      });
  }, [
    packets,
    apiKey,
    model,
    loaded,
    online,
    health,
    save,
    sync,
    notify,
    recordUsage,
  ]);

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (!/\.(txt|md|csv|docx|pdf)$/i.test(file.name)) {
        notify(`${file.name}：目前支持 PDF、DOCX、TXT、MD、CSV`);
        continue;
      }
      if (file.size > 15 * 1024 * 1024) {
        notify(`${file.name} 超过15MB`);
        continue;
      }
      if (next.length >= 8) {
        notify("一次最多放入8个附件");
        break;
      }
      if (next.reduce((n, a) => n + a.size, 0) + file.size > 24 * 1024 * 1024) {
        notify("这一组附件合计不能超过24MB");
        break;
      }
      if (file.name.length > 200) {
        notify("文件名过长，请缩短后重试");
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        blob: file,
      });
    }
    setAttachments(next);
    if (input.current) input.current.value = "";
    textarea.current?.focus();
  }
  async function submit() {
    if (submitLock.current || (!text.trim() && !attachments.length)) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const at = new Date().toISOString(),
        packet: Packet = {
          id: crypto.randomUUID(),
          text: text.trim(),
          attachments: [...attachments],
          sources: [],
          capturedAt: at,
          captureDate: localDate(),
          status: "pending",
          result: null,
          error: "",
          doneIds: [],
          updatedAt: at,
        };
      await save(packet);
      setText("");
      setAttachments([]);
      await writeDraft({ text: "", attachments: [] });
      if (!apiKey && !health?.modelReady) setSettings(true);
    } catch (error) {
      notify(message(error));
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }
  async function retry(p: Packet) {
    try {
      if (p.remote) {
        const result = await serviceRequest("packets/" + p.id + "/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await save({
          ...result.packet,
          attachments: p.attachments,
          remote: true,
        });
      } else
        await save({
          ...p,
          status: "pending",
          error: "",
          updatedAt: new Date().toISOString(),
        });
      if (!apiKey && !health?.modelReady) setSettings(true);
    } catch (error) {
      notify(message(error));
    }
  }
  async function toggle(p: Packet, index: number) {
    const doneIds = p.doneIds.includes(index)
      ? p.doneIds.filter((i) => i !== index)
      : [...p.doneIds, index];
    try {
      await save({
        ...p,
        doneIds,
        remoteDirty: !!p.remote,
        updatedAt: new Date().toISOString(),
      });
      void sync();
    } catch (error) {
      notify(message(error));
    }
  }
  async function erase(p: Packet) {
    if (!window.confirm("删除这一包原文、附件和整理结果？此操作不能恢复。"))
      return;
    try {
      if (p.remote) {
        const response = await serviceRequest("packets/" + p.id, {
          method: "DELETE",
        });
        await save(response.packet);
      } else {
        const at = new Date().toISOString();
        await save({
          ...p,
          deletedAt: at,
          text: "",
          sources: [],
          attachments: [],
          result: null,
          updatedAt: at,
        });
      }
    } catch (error) {
      notify(message(error));
    }
  }
  function connected(key: string, selected: string, persist: boolean) {
    setApiKey(key);
    setModel(selected);
    setRemember(persist);
    try {
      if (health) void detectService().then(setHealth);
      else
        localStorage.setItem(
          CONFIG_KEY,
          JSON.stringify({
            model: selected,
            rememberKey: persist,
            ...(persist ? { key } : {}),
          }),
        );
    } catch {
      notify("连接已生效，但浏览器不允许记住配置");
    }
  }
  function useSample() {
    setText(SAMPLE_TEXT);
    const blob = new Blob([SAMPLE_FILE], { type: "text/plain" });
    setAttachments([
      {
        id: crypto.randomUUID(),
        name: "课程要求.txt",
        size: blob.size,
        type: "text/plain",
        blob,
      },
    ]);
    textarea.current?.focus();
  }
  const cost = usageTotals(usage);
  const visible = packets.filter((p) => !p.deletedAt),
    waiting = visible.filter(
      (p) => p.status === "pending" || p.status === "processing",
    ).length;
  return (
    <div
      className="bucket-app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <header className="bucket-header">
        <a href={import.meta.env.BASE_URL} className="bucket-brand">
          <span>
            <Leaf size={21} />
          </span>
          拾序<small>一个，什么都能放的桶。</small>
        </a>
        <button
          className="bucket-settings"
          aria-label="连接与设置"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={20} />
        </button>
      </header>
      <main className="bucket-main">
        {DEMO && (
          <div className="bucket-demo-note">
            <span>示例空间 · 虚构内容，与个人资料隔离</span>
            <a href={location.pathname}>
              回到我的桶
              <ArrowUpRight size={12} />
            </a>
          </div>
        )}
        <section className="bucket-intro">
          <div className="bucket-drawing" aria-hidden="true">
            <svg viewBox="0 0 88 82">
              <path d="m20 28 7 43c1 4 5 6 17 6s16-2 17-6l7-43" />
              <ellipse cx="44" cy="27" rx="24" ry="7" />
              <path d="M31 18v-6h16l7 7v4M50 8l5-5 11 11-5 5M34 43l7 6 14-15" />
              <path
                className="bucket-spark"
                d="M13 11v8M9 15h8M74 42v6M71 45h6"
              />
            </svg>
          </div>
          <h1>
            先丢进来，
            <br className="bucket-mobile-break" />
            剩下的交给我。
          </h1>
          <p>一件待办、一份文件、一个灵感，或者想坚持的小事。</p>
        </section>
        <section
          className={`bucket-composer ${drag ? "is-dragging" : ""}`}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDrag(false);
          }}
        >
          {drag && (
            <div
              className="bucket-drop-hint"
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDrag(false);
                void addFiles(e.dataTransfer.files);
              }}
            >
              <ArrowDown size={25} />
              <span>松手，放进桶里。</span>
            </div>
          )}
          <textarea
            ref={textarea}
            autoFocus
            aria-label="往桶里放入内容"
            placeholder={
              "想到什么就写什么，也可以直接粘贴一大段。\n文件和相关的通知，一起放进来就好。"
            }
            value={text}
            maxLength={60000}
            disabled={!loaded}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {!!attachments.length && (
            <div className="bucket-attachments">
              {attachments.map((a) => (
                <span className="attachment-chip" key={a.id}>
                  <Paperclip size={12} />
                  <span>{a.name}</span>
                  <button
                    aria-label={`移除 ${a.name}`}
                    onClick={() =>
                      setAttachments(
                        attachments.filter((item) => item.id !== a.id),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="bucket-composer-bottom">
            <button
              className="bucket-attach"
              onClick={() => input.current?.click()}
              disabled={!loaded}
              aria-label="添加文件"
            >
              <Paperclip size={18} />
              <span>放个文件</span>
            </button>
            <input
              type="file"
              multiple
              accept=".txt,.md,.csv,.docx,.pdf"
              hidden
              ref={input}
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              className="bucket-primary bucket-send"
              disabled={
                !loaded || submitting || (!text.trim() && !attachments.length)
              }
              onClick={() => void submit()}
            >
              {submitting ? (
                <LoaderCircle size={17} className="bucket-spin" />
              ) : (
                <ArrowDown size={17} />
              )}
              丢进去
            </button>
          </div>
        </section>
        <div className="bucket-under-composer">
          <span
            className={`model-status ${apiKey || health?.modelReady ? "is-connected" : ""}`}
          >
            <i />
            {!online
              ? "离线 · 先接住，联网再整理"
              : health
                ? health.authenticated
                  ? health.modelReady
                    ? "个人服务已连接"
                    : "个人服务待连接 DeepSeek"
                  : "个人服务待解锁"
                : apiKey
                  ? "DeepSeek 已连接"
                  : "连接 DeepSeek 后，自动整理"}
            {waiting > 0 && online ? ` · ${waiting} 包等待处理` : ""}
          </span>
          <button
            className="bucket-model-cost"
            onClick={() => setSettings(true)}
            aria-label="选择模型与查看费用"
          >
            {modelLabel(model)} ·{" "}
            {cost.calls
              ? cost.unpriced === cost.calls
                ? "费用待核对"
                : `累计约 ¥${money(cost.min)}–${money(cost.max)}${cost.unpriced ? " + 待核对" : ""}`
              : "尚无用量记录"}
          </button>
        </div>
        {!visible.length && (
          <div className="bucket-empty">
            <span className="bucket-quiet-line" />
            <p>
              不用选分类，不用填表。
              <br />
              先把脑袋里的零零碎碎放下来。
            </p>
            <button onClick={useSample}>
              拿一份通知和附件试试
              <ArrowUpRight size={13} />
            </button>
            <a href={`${location.pathname}?preview=bucket`}>看看整理后的样子</a>
          </div>
        )}
        {!!visible.length && (
          <section className="bucket-collection">
            <div className="bucket-collection-heading">
              <h2>
                都在这里了<span>{visible.length}</span>
              </h2>
              <p>你只管放下，我来理清楚。</p>
            </div>
            {visible.map((p) => (
              <PacketCard
                key={p.id}
                packet={p}
                usage={usage.filter((r) => r.packetId === p.id)}
                progress={workingId === p.id ? progress : ""}
                onRetry={() => void retry(p)}
                onToggle={(i) => void toggle(p, i)}
                onDelete={() => void erase(p)}
                notify={notify}
              />
            ))}
          </section>
        )}
        <footer className="bucket-footer">
          <Sparkles size={12} />
          <span>留住原文，分清事实与建议。拿不准的事，不乱替你决定。</span>
        </footer>
      </main>
      {settings && (
        <Connection
          apiKey={apiKey}
          model={model}
          remember={remember}
          health={health}
          packets={packets}
          usage={usage}
          onConnected={connected}
          onClose={() => setSettings(false)}
          notify={notify}
        />
      )}
      {toast && (
        <div className="bucket-toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
