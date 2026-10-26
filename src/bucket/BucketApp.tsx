import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowUpRight,
  LoaderCircle,
  Paperclip,
  Palette,
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
import {
  allPackets,
  putPacket,
  putPackets,
  readDraft,
  writeDraft,
  allUsage,
  putUsage,
  removePacket,
  upgradeDesktopProfile,
} from "./store";
import { type UsageRecord } from "../../shared/usage.mjs";
import {
  associatePacket,
  itemRef,
  itemMap,
  filterLiveLinks,
} from "../../shared/relations.mjs";
import {
  detectService,
  serviceRequest,
  uploadPacket,
  type Health,
} from "./service";
import {
  samplePacket,
  sampleRelations,
  SAMPLE_TEXT,
  SAMPLE_FILE,
} from "./demo";
import Connection from "./Connection";
import InstallGuide from "./InstallGuide";
import DeliverySources from "./DeliverySources";
import ItemDialog from "./ItemDialog";
import { useTransientUI } from "./useTransientUI";
import type { Packet, Attachment, ItemState } from "./types";
import { chatWithItem } from "./item-chat";
import DDL from "./DDL";
import Results, { categories } from "./Results";
import SkinMarket from "./SkinMarket";
import SkinMascot from "./SkinMascot";
import {
  BUILTIN_SKINS,
  loadSkinCollection,
  saveSkinCollection,
  skinStorageKey,
  type SkinCollection,
} from "./skins";
import "./bucket.css";
import "./desktop.css";
import "./card-palette.css";
import "./card-visuals.css";
import "./skin-motion.css";
import "./skins.css";
import { ingestAttachment, supportedFiles, type Coverage } from "./ingest";

const DEMO = new URLSearchParams(location.search).has("preview");
const CONFIG_KEY = DEMO
  ? "shixu-bucket-connection-demo"
  : "shixu-bucket-connection";
function initialConfig() {
  if (window.desktop)
    return { key: "", model: DEFAULT_MODEL, rememberKey: false };
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
  const [skinMarket, setSkinMarket] = useState(false);
  const [feedSignal, setFeedSignal] = useState(0);
  const [skinCollection, setSkinCollection] = useState(() =>
    loadSkinCollection(skinStorageKey(DEMO)),
  );
  const activeSkin =
    [...BUILTIN_SKINS, ...skinCollection.custom].find(
      (skin) => skin.id === skinCollection.selected,
    ) || BUILTIN_SKINS[0];
  function changeSkins(next: SkinCollection) {
    saveSkinCollection(skinStorageKey(DEMO), next);
    setSkinCollection(next);
  }
  const [workspace, setWorkspace] = useState("capture"),
    [focusPacket, setFocusPacket] = useState("");
  const scrollPositions = useRef<Record<string, number>>({
    capture: 0,
    results: 0,
  });
  const clearFocus = useCallback(() => setFocusPacket(""), []);
  const workspaceMotion = useRef<ViewTransition | null>(null);
  const workspaceSequence = useRef(0);
  function goWorkspace(next: string, packetId?: string) {
    const sequence = ++workspaceSequence.current;
    const scroller = document.querySelector<HTMLElement>(".bucket-main");
    scrollPositions.current[workspace] = scroller?.scrollTop || 0;
    if (packetId) {
      setFocusPacket(packetId);
      setRecordsOpen(false);
    }
    workspaceMotion.current?.skipTransition();
    const reveal = () => {
      if (sequence !== workspaceSequence.current) return;
      flushSync(() => setWorkspace(next));
      scroller?.scrollTo(0, packetId ? 0 : scrollPositions.current[next] || 0);
    };
    if (next !== workspace && document.startViewTransition)
      workspaceMotion.current = document.startViewTransition(reveal);
    else reveal();
  }
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudActive, setCloudActive] = useState(false);
  const [currentCaptureId, setCurrentCaptureId] = useState("");
  useEffect(() => {
    if (!currentCaptureId) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(".current-delivery")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [currentCaptureId]);
  const [dropVisible, setDropVisible] = useState(false);
  const [receiptLimit, setReceiptLimit] = useState(20);
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
  useTransientUI(drag, () => setDrag(false));
  useEffect(() => {
    if (drag) {
      setDropVisible(true);
      return;
    }
    const timer = setTimeout(() => setDropVisible(false), 150);
    return () => clearTimeout(timer);
  }, [drag]);
  const linkedItems = useMemo(() => itemMap(packets), [packets]);
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
  useEffect(() => {
    if (!loaded || !window.desktop) return;
    let stopped = false,
      busy = false;
    const refresh = async () => {
      if (busy || working.current || submitLock.current) return;
      busy = true;
      try {
        const state = await window.desktop!.cloud("status");
        setCloudActive(!!state.base);
        if (!state.base) return;
        const updated = await window.desktop!.cloud("sync");
        const ai = updated.account?.ai;
        const used =
          ai?.usage.find((u) => u.day === new Date().toISOString().slice(0, 10))
            ?.requests || 0;
        setCloudReady(!!ai?.enabled && used < ai.dailyLimit);
        const rows = await allPackets();
        if (!stopped && !working.current && !submitLock.current) {
          packetsRef.current = rows;
          setPackets(rows);
        }
      } catch {
        setCloudReady(
          false,
        ); /* Persistent queue and last error are visible in cloud settings. */
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 8000);
    window.addEventListener("online", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, [loaded]);
  const purgePacket = useCallback(
    async (id: string) => {
      await removePacket(id);
      const next = packetsRef.current.filter((p) => p.id !== id);
      packetsRef.current = next;
      setPackets(next);
      notify("已永久删除；无引用原件在下次清理时移除");
    },
    [notify],
  );
  const saveMany = useCallback(async (changes: Packet[]) => {
    await putPackets(changes);
    const map = new Map(packetsRef.current.map((p) => [p.id, p]));
    for (const p of changes) map.set(p.id, p);
    const next = [...map.values()].sort((a, b) =>
      b.capturedAt.localeCompare(a.capturedAt),
    );
    packetsRef.current = next;
    setPackets(next);
  }, []);
  const save = useCallback((packet: Packet) => saveMany([packet]), [saveMany]);
  const reorderCards = useCallback(
    async (ids: string[]) => {
      const ranks = new Map(ids.map((id, index) => [id, index]));
      const changes: Packet[] = [];
      for (const packet of packetsRef.current) {
        if (packet.deletedAt) continue;
        const itemState = { ...packet.itemState };
        let changed = false;
        for (const [index] of (packet.result?.items || []).entries()) {
          const id = packet.itemIds?.[index] || `${packet.id}:${index}`;
          const order = ranks.get(id);
          if (
            order === undefined ||
            itemState[id]?.deletedAt ||
            itemState[id]?.purgedAt ||
            itemState[id]?.order === order
          )
            continue;
          itemState[id] = { ...itemState[id], order };
          changed = true;
        }
        if (changed)
          changes.push({
            ...packet,
            itemState,
            updatedAt: new Date().toISOString(),
          });
      }
      if (changes.length) await saveMany(changes);
    },
    [saveMany],
  );
  const chatLocks = useRef(new Set<string>());
  async function runCloudAI(
    value: {
      kind: string;
      packetId: string;
      itemId?: string;
      instruction?: string;
    },
    wait = false,
  ): Promise<Packet[]> {
    const state = await window.desktop!.cloud("ai", value);
    if (wait) {
      const deadline = Date.now() + 245000;
      for (;;) {
        const status = await window.desktop!.cloud("sync");
        if (status.base !== state.base)
          throw Error("账号空间已切换，结果保留在原账号");
        const job = status.jobs?.find((j) => j.id === state.job);
        if (job?.state === "done") break;
        if (job && ["error", "conflict", "interrupted"].includes(job.state))
          throw Error(job.error || "AI 未覆盖资料，请核对后重试");
        if (Date.now() > deadline)
          throw Error("任务仍在服务端处理，请稍后核对状态；不会自动重复提交");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await window.desktop!.cloud("sync");
    }
    const rows = await allPackets();
    packetsRef.current = rows;
    setPackets(rows);
    if (!wait) notify("任务已保存，结果就绪后会同步；请在设置中查看 AI 状态");
    return rows;
  }
  async function editWithAI(
    packetId: string,
    itemId: string,
    instruction: string,
  ): Promise<ItemState> {
    if (window.desktop) {
      if (chatLocks.current.has(packetId))
        throw Error("这张卡片正在处理，请稍后");
      chatLocks.current.add(packetId);
      try {
        const result = await runCloudAI(
          { kind: "chat", packetId, itemId, instruction },
          true,
        );
        const packet = result.find((p) => p.id === packetId);
        return packet?.itemState?.[itemId] || {};
      } finally {
        chatLocks.current.delete(packetId);
      }
    }
    if (!apiKey) throw new Error("请先在连接与设置中填写 DeepSeek 密钥");
    if (chatLocks.current.has(packetId))
      throw new Error("这张卡片正在处理，请稍后");
    const current = packetsRef.current.find((p) => p.id === packetId);
    const index = current?.itemIds?.indexOf(itemId) ?? -1;
    if (
      !current?.result ||
      index < 0 ||
      current.deletedAt ||
      current.itemState?.[itemId]?.deletedAt ||
      current.status !== "ready"
    )
      throw new Error("卡片当前不可修改");
    chatLocks.current.add(packetId);
    try {
      const meta = current.itemState?.[itemId] || {};
      const fingerprint = (p: Packet) =>
        JSON.stringify([
          p.result?.items[index],
          { ...p.itemState?.[itemId], chat: undefined },
        ]);
      const before = fingerprint(current);
      const chat = [...(meta.chat || [])];
      if (!(chat.at(-1)?.role === "user" && chat.at(-1)?.text === instruction))
        chat.push({
          id: crypto.randomUUID(),
          role: "user",
          text: instruction,
          at: new Date().toISOString(),
        });
      await save({
        ...current,
        itemState: { ...current.itemState, [itemId]: { ...meta, chat } },
      });
      const response = await chatWithItem(
        current.result.items[index],
        { ...meta, chat },
        instruction,
        current.text +
          "\n" +
          current.sources.map((s) => s.name + "\n" + s.text).join("\n"),
        {
          apiKey,
          model,
          captureDate: localDate(),
          itemCaptureDate: current.captureDate,
          packetId,
          signal: AbortSignal.timeout(90000),
          onUsage: recordUsage,
        },
      );
      const latest = packetsRef.current.find((p) => p.id === packetId);
      if (
        !latest?.result ||
        latest.deletedAt ||
        latest.status !== "ready" ||
        fingerprint(latest) !== before
      )
        throw new Error("卡片刚刚有其他修改，本次回复未覆盖它；请重试");
      const items = [...latest.result.items];
      const nextItem = { ...items[index] };
      const nextMeta: ItemState = { ...latest.itemState?.[itemId] };
      const edits: NonNullable<ItemState["history"]> = [];
      for (const [field, value] of Object.entries(response.patch)) {
        const target = [
          "title",
          "summary",
          "kind",
          "due",
          "facts",
          "dueCleared",
        ].includes(field)
          ? nextItem
          : nextMeta;
        const record = target as unknown as Record<string, unknown>;
        if (JSON.stringify(record[field]) !== JSON.stringify(value))
          edits.push({
            at: new Date().toISOString(),
            field,
            before: JSON.stringify(record[field]) || "",
            after: JSON.stringify(value),
            source: "卡片对话",
          });
        record[field] = value;
      }
      nextMeta.chat = [
        ...chat,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: response.reply,
          at: new Date().toISOString(),
        },
      ];
      if (edits.length) {
        nextMeta.corrected = true;
        nextMeta.history = [...(nextMeta.history || []), ...edits];
      }
      const doneIds = new Set(latest.doneIds);
      if (response.patch.status) {
        if (response.patch.status === "done") {
          doneIds.add(index);
          nextMeta.completedAt = new Date().toISOString();
        } else {
          doneIds.delete(index);
          nextMeta.completedAt = undefined;
        }
      }
      items[index] = nextItem;
      await save({
        ...latest,
        result: { ...latest.result, items },
        itemState: { ...latest.itemState, [itemId]: nextMeta },
        doneIds: [...doneIds],
        updatedAt: new Date().toISOString(),
      });
      return {
        ...nextMeta,
        status: doneIds.has(index) ? "done" : nextMeta.status,
      };
    } finally {
      chatLocks.current.delete(packetId);
    }
  }
  const recordUsage = useCallback(async (record: UsageRecord) => {
    await putUsage(record);
    setUsage((rows) => [...rows.filter((r) => r.id !== record.id), record]);
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      if (window.desktop) {
        await upgradeDesktopProfile();
      }
      let stored = await allPackets();
      if (!active) return;
      if (DEMO && !stored.length) {
        const samples =
          new URLSearchParams(location.search).get("preview") === "relations"
            ? sampleRelations()
            : [samplePacket()];
        for (const sample of samples) await putPacket(sample);
        stored = samples;
      }
      for (const p of stored)
        if (
          p.status === "processing" &&
          !p.remote &&
          p.syncAutoOrganize !== false
        ) {
          p.status = p.result ? "ready" : "error";
          p.retryUnread = false;
          p.error =
            "上次整理被中断，原文和已读取内容已保留。请确认后重试；上次调用的用量可能待核对";
          if (p.result)
            p.association = {
              state: "error",
              links: p.association?.links || [],
              warnings: [p.error],
            };
          await putPacket(p);
        }
      for (const p of stored)
        if (p.status === "ready" && p.association?.state === "pending") {
          p.association = {
            ...p.association,
            state: "error",
            warnings: ["上次关联未完成，已有事项保持可用，可单独重试关联"],
          };
          await putPacket(p);
        }
      for (const p of stored)
        if (p.result && !p.itemIds) {
          p.itemIds = p.result.items.map(() => crypto.randomUUID());
          p.organizedSourceIds = p.sources.map((s) => s.id);
          await putPacket(p);
        }
      const refs = new Map(
        stored.flatMap((p) =>
          (p.itemIds || []).map(
            (id, i) => [itemRef(p.id, i), itemRef(p.id, id)] as const,
          ),
        ),
      );
      for (const p of stored)
        if (p.association?.links.length) {
          const original = JSON.stringify(p.association.links);
          p.association.links = p.association.links.map((link) => ({
            ...link,
            from: refs.get(link.from) || link.from,
            target: refs.get(link.target) || link.target,
            contextRefs: link.contextRefs?.map((ref) => refs.get(ref) || ref),
          }));
          if (original !== JSON.stringify(p.association.links))
            await putPacket(p);
        }
      const draft = await readDraft();
      const calls = await allUsage();
      for (const record of calls)
        if (record.state === "pending") {
          record.state = "unreported";
          record.finishedAt = new Date().toISOString();
          await putUsage(record);
        }
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
    if (!loaded || !window.desktop) return;
    const refresh = async () => {
      if (working.current || submitLock.current) return;
      try {
        if (!(await window.desktop!.cloud("status")).base)
          await window.desktop!.store("cleanup");
        const stored = await allPackets();
        if (working.current || submitLock.current) return;
        packetsRef.current = stored;
        setPackets(stored);
      } catch (e) {
        notify(message(e));
      }
    };
    const timer = setInterval(() => void refresh(), 60 * 60 * 1000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [loaded, notify]);
  useEffect(() => {
    window.flushDesktopDraft = () => writeDraft({ text, attachments });
    return () => {
      delete window.flushDesktopDraft;
    };
  }, [text, attachments]);
  useEffect(() => {
    if (DEMO || window.desktop) return;
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
      !!window.desktop ||
      (!apiKey && !health?.authenticated)
    )
      return;
    if (health && !health.modelReady) return;
    const packet = packets
      .filter(
        (p) =>
          !p.deletedAt &&
          !p.remote &&
          p.syncAutoOrganize !== false &&
          (p.status === "pending" ||
            (p.status === "ready" && p.association?.state === "pending")),
      )
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))[0];
    if (!packet) return;
    working.current = true;
    setWorkingId(packet.id);
    setProgress("正在读取这次投递");
    (async () => {
      async function relate(ready: Packet) {
        const association = await associatePacket(ready, packetsRef.current, {
          apiKey,
          model,
          captureDate: ready.captureDate,
          packetId: ready.id,
          signal: AbortSignal.timeout(240000),
          onProgress: setProgress,
          onUsage: recordUsage,
        });
        const latest = packetsRef.current.find((p) => p.id === ready.id);
        if (!latest || latest.deletedAt) return;
        const links = filterLiveLinks(association.links, packetsRef.current);
        await save({
          ...latest,
          association: { ...association, links },
          updatedAt: new Date().toISOString(),
        });
      }
      let current = {
        ...packet,
        status:
          packet.status === "ready"
            ? ("ready" as const)
            : ("processing" as const),
        updatedAt: new Date().toISOString(),
      };
      await save(current);
      async function persistReading(
        partialSources: typeof current.sources,
        partialCoverage: Coverage[],
      ) {
        const latest = packetsRef.current.find((p) => p.id === current.id);
        if (!latest || latest.deletedAt)
          throw new Error("投递已删除，停止读取");
        current = {
          ...current,
          result: latest.result,
          itemIds: latest.itemIds,
          itemState: latest.itemState,
          doneIds: latest.doneIds,
          sources: partialSources,
          coverage: partialCoverage,
          updatedAt: new Date().toISOString(),
        };
        await save(current);
      }
      try {
        if (current.status === "ready" && current.result) {
          await relate(current);
          return;
        }
        const retainedSources = current.retryUnread ? current.sources : [];
        const cachedSources = current.sources,
          cachedCoverage = current.coverage || [];
        const sources = current.text.trim()
          ? [{ id: "input", name: "随手输入", text: current.text.trim() }]
          : [];
        const coverage: Coverage[] = [];
        for (const a of current.attachments) {
          if (a.deletedAt) continue;
          setProgress(`正在读 ${a.name}`);
          const covered = cachedCoverage.filter((c) => c.attachmentId === a.id);
          if (covered?.length && covered.every((c) => c.state === "read")) {
            sources.push(
              ...cachedSources.filter((s) =>
                covered.some((c) => c.sourceIds.includes(s.id)),
              ),
            );
            coverage.push(...covered);
            continue;
          }
          const beforeSources = [...sources],
            beforeCoverage = [...coverage];
          const read = await ingestAttachment(
            a,
            {
              apiKey,
              model,
              captureDate: current.captureDate,
              packetId: current.id,
              signal: AbortSignal.timeout(240000),
              onProgress: setProgress,
              onUsage: recordUsage,
            },
            { sources: cachedSources, coverage: cachedCoverage },
            async (partial) => {
              const combinedSources = [
                ...new Map(
                  [...cachedSources, ...beforeSources, ...partial.sources].map(
                    (s) => [s.id, s],
                  ),
                ).values(),
              ];
              const combinedCoverage = [
                ...new Map(
                  [
                    ...cachedCoverage,
                    ...beforeCoverage,
                    ...partial.coverage,
                  ].map((c) => [c.name, c]),
                ).values(),
              ];
              await persistReading(combinedSources, combinedCoverage);
            },
          );
          sources.push(...read.sources.filter((s) => s.text.trim()));
          coverage.push(...read.coverage);
          await persistReading([...sources], [...coverage]);
        }
        current = { ...current, coverage };
        const priorIds = new Set(
          current.organizedSourceIds || retainedSources.map((s) => s.id),
        );
        const newlyRead = current.retryUnread
          ? sources.filter((s) => !priorIds.has(s.id) && s.id !== "input")
          : sources;
        if (current.retryUnread && !newlyRead.length) {
          await save({
            ...current,
            status: "ready",
            retryUnread: false,
            error: "未读部分仍未能读取，已有结果与人工修正已保留",
          });
          return;
        }
        checkSources(sources);
        current = { ...current, sources, updatedAt: new Date().toISOString() };
        if (packetsRef.current.find((p) => p.id === current.id)?.deletedAt)
          return;
        await persistReading(sources, coverage);
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
          const result = await organizePacket(
            current.retryUnread
              ? [...sources.filter((s) => s.id === "input"), ...newlyRead]
              : sources,
            {
              apiKey,
              model,
              captureDate: current.captureDate,
              signal: AbortSignal.timeout(240000),
              onProgress: setProgress,
              packetId: current.id,
              onUsage: recordUsage,
            },
          );
          if (packetsRef.current.find((p) => p.id === current.id)?.deletedAt)
            return;
          const latest =
            packetsRef.current.find((p) => p.id === current.id) || current;
          const prior = current.retryUnread ? latest.result : null;
          const ready: Packet = {
            ...current,
            itemState: latest.itemState,
            status: "ready",
            result: prior
              ? {
                  summary: prior.summary + "；补充材料已读取，请确认补充结果。",
                  items: prior.items,
                  warnings: [...prior.warnings, ...result.warnings],
                }
              : result,
            proposedItems: prior
              ? [
                  ...(latest.proposedItems || []),
                  ...result.items.filter((item) =>
                    item.sourceIds.some((id) =>
                      newlyRead.some((s) => s.id === id),
                    ),
                  ),
                ]
              : undefined,
            receipt: prior
              ? latest.receipt
              : { created: result.items.length, updated: 0, merged: 0 },
            itemIds: [
              ...(prior
                ? latest.itemIds ||
                  prior.items.map((_, i) => `${current.id}:${i}`)
                : []),
              ...(prior ? [] : result.items.map(() => crypto.randomUUID())),
            ],
            organizedSourceIds: sources.map((s) => s.id),
            retryUnread: false,
            error: "",
            association: { state: "pending", links: [], warnings: [] },
            updatedAt: new Date().toISOString(),
          };
          await save(ready);
          await relate(ready);
        }
      } catch (error) {
        const latest = packetsRef.current.find((p) => p.id === current.id);
        if (latest?.deletedAt) return;
        if (latest?.result) {
          await save({
            ...latest,
            status: "ready",
            retryUnread: false,
            error: message(error),
            association: {
              state: "error",
              links: [],
              warnings: [message(error)],
            },
            updatedAt: new Date().toISOString(),
          });
          return;
        }
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
    if (!loaded) {
      notify("正在恢复本机资料，请稍后再投递");
      return;
    }
    if (!files) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      if (file.size > 32 * 1024 * 1024) {
        notify(`${file.name} 超过32MB`);
        continue;
      }
      if (next.length >= 8) {
        notify("一次最多放入8个附件");
        break;
      }
      if (next.reduce((n, a) => n + a.size, 0) + file.size > 96 * 1024 * 1024) {
        notify("这一组附件合计不能超过96MB");
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
      if (!supportedFiles.test(file.name))
        notify(`${file.name} 已保存为附件；此格式暂不能提取内容`);
    }
    setAttachments(next);
    if (input.current) input.current.value = "";
    textarea.current?.focus();
  }
  async function submit() {
    if (submitLock.current || (!text.trim() && !attachments.length)) return;
    if (
      packetsRef.current.some(
        (p) =>
          !p.deletedAt &&
          p.text === text.trim() &&
          p.attachments.length === attachments.length &&
          p.attachments.every(
            (a, i) =>
              a.name === attachments[i]?.name &&
              a.size === attachments[i]?.size,
          ),
      ) &&
      !confirm("发现文字和附件清单相同的投递。仍然保留这次重复投递？")
    )
      return;
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
          captureTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          status: "pending",
          result: null,
          error: "",
          doneIds: [],
          updatedAt: at,
        };
      await save(packet);
      setFeedSignal((n) => n + 1);
      setCurrentCaptureId(packet.id);
      setText("");
      setAttachments([]);
      await writeDraft({ text: "", attachments: [] });
      if (window.desktop) {
        const state = await window.desktop.cloud("status");
        if (state.base)
          void runCloudAI(
            { kind: "organize", packetId: packet.id },
            true,
          ).catch((e) => notify(message(e)));
        else notify("已保存在本机；激活后可在独立云空间使用 AI");
      } else if (!apiKey && !health?.modelReady) setSettings(true);
    } catch (error) {
      notify(message(error));
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }
  async function retry(p: Packet) {
    if (window.desktop) {
      try {
        await runCloudAI({ kind: "organize", packetId: p.id }, true);
      } catch (e) {
        notify(message(e));
      }
      return;
    }
    // Explicit retry opts this device into processing an incoming cloud capture.
    p = { ...p, syncAutoOrganize: true };
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
  async function resolveProposal(
    packet: Packet,
    index: number,
    targetId: string,
    adoptDate: boolean,
  ) {
    const p = packetsRef.current.find((p) => p.id === packet.id);
    const candidate = p?.proposedItems?.[index];
    if (!p?.result || !candidate) return;
    const proposedItems = p.proposedItems!.filter((_, i) => i !== index);
    if (targetId === "discard") {
      await save({ ...p, proposedItems });
      notify("已忽略此补充候选，原材料保留");
      return;
    }
    const items = [...p.result.items],
      itemIds = [...(p.itemIds || items.map((_, i) => `${p.id}:${i}`))],
      itemState = { ...p.itemState };
    if (targetId === "new") {
      items.push(candidate);
      itemIds.push(crypto.randomUUID());
    } else {
      const position = itemIds.indexOf(targetId);
      if (position < 0) return notify("目标事项已不可用，请重新选择");
      const original = items[position];
      items[position] = {
        ...original,
        summary: original.summary + "\n补充：" + candidate.summary,
        facts: [...new Set([...original.facts, ...candidate.facts])],
        nextSteps: [
          ...new Set([...original.nextSteps, ...candidate.nextSteps]),
        ],
        uncertainties: [
          ...new Set([...original.uncertainties, ...candidate.uncertainties]),
        ],
        sourceIds: [
          ...new Set([...original.sourceIds, ...candidate.sourceIds]),
        ],
        evidence: [
          ...new Map(
            [...original.evidence, ...candidate.evidence].map((e) => [
              e.sourceId + e.quote,
              e,
            ]),
          ).values(),
        ],
        due: adoptDate && candidate.due ? candidate.due : original.due,
      };
      itemState[targetId] = {
        ...itemState[targetId],
        corrected: true,
        history: [
          ...(itemState[targetId]?.history || []),
          {
            at: new Date().toISOString(),
            field: "补充材料",
            before: original.summary,
            after: items[position].summary,
            source: candidate.sourceIds
              .map((id) => p.sources.find((s) => s.id === id)?.name || id)
              .join("、"),
          },
          ...(adoptDate && candidate.due
            ? [
                {
                  at: new Date().toISOString(),
                  field: "日期",
                  before: original.due?.date || "未设置",
                  after: candidate.due.date,
                  source: candidate.due.anchor,
                },
              ]
            : []),
        ],
      };
    }
    const receipt = p.receipt || {
      created: p.result.items.length,
      updated: 0,
      merged: 0,
    };
    await save({
      ...p,
      result: { ...p.result, items },
      itemIds: [...itemIds],
      itemState,
      proposedItems,
      receipt: {
        ...receipt,
        created: receipt.created + (targetId === "new" ? 1 : 0),
        updated: receipt.updated + (targetId === "new" ? 0 : 1),
        merged: receipt.merged + (targetId === "new" ? 0 : 1),
        lastAction:
          targetId === "new"
            ? "已确认新增事项"
            : "已确认补充到已有事项，来源与变更依据保留",
      },
      updatedAt: new Date().toISOString(),
    });
    notify(
      targetId === "new"
        ? "已新增确认的事项"
        : "已补充到指定事项，原来源与人工标题保留",
    );
  }
  async function erase(p: Packet) {
    if (
      !window.confirm(
        "将这次投递、原文、附件和整理结果移入最近删除？30 天内可恢复。",
      )
    )
      return;
    try {
      if (p.remote) {
        const response = await serviceRequest("packets/" + p.id, {
          method: "DELETE",
        });
        await save(response.packet);
        void sync();
      } else {
        const at = new Date().toISOString();
        await saveMany([
          {
            ...p,
            deletedAt: at,
            updatedAt: at,
          },
        ]);
      }
    } catch (error) {
      notify(message(error));
    }
  }
  async function connected(key: string, selected: string, persist: boolean) {
    setApiKey(key);
    setModel(selected);
    setRemember(persist);
    try {
      if (window.desktop) {
        await window.desktop.key(persist ? "save" : "remove", key);
        localStorage.setItem(
          CONFIG_KEY,
          JSON.stringify({ model: selected, rememberKey: false }),
        );
        return;
      }
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
    } catch (error) {
      if (window.desktop) {
        setRemember(false);
        throw new Error(
          "连接已生效，但密钥或配置未能安全保存：" + message(error),
        );
      }
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
  const visible = packets.filter((p) => !p.deletedAt),
    waiting = visible.filter(
      (p) => p.status === "pending" || p.status === "processing",
    ).length;
  const currentCapture = visible.find((p) => p.id === currentCaptureId);
  const receipts = useMemo(
    () => (
      <section className="delivery-receipts" aria-label="整理回执">
        {visible.slice(0, receiptLimit).map((p) => (
          <article className="delivery-receipt" key={p.id}>
            <span className="receipt-time">
              {new Date(p.capturedAt).toLocaleDateString("zh-CN", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <h2>
              {p.status === "ready"
                ? p.coverage?.some((c) => c.state === "failed")
                  ? "部分完成 · 有未读内容"
                  : "整理完成"
                : p.status === "error"
                  ? "整理未完成"
                  : workingId === p.id
                    ? progress || "正在整理"
                    : "已保存，等待连接后整理"}
            </h2>
            {!!p.coverage?.length && (
              <>
                <p>
                  读取成功 {p.coverage.filter((c) => c.state === "read").length}{" "}
                  处 · 未读{" "}
                  {p.coverage.filter((c) => c.state === "failed").length} 处
                </p>
                <details>
                  <summary>附件与包内文件读取清单</summary>
                  {p.coverage.map((c, i) => (
                    <p key={i}>
                      {c.state === "read" ? "✓" : "未读"} {c.name}：{c.detail}
                    </p>
                  ))}
                </details>
              </>
            )}
            {p.status === "ready" &&
              (p.coverage?.some((c) => c.state === "failed") ||
                (p.organizedSourceIds &&
                  p.sources.some(
                    (s) => !p.organizedSourceIds!.includes(s.id),
                  ))) && (
                <button
                  onClick={() =>
                    void save({
                      ...p,
                      status: "pending",
                      retryUnread: true,
                    })
                  }
                >
                  重试未读内容（保留已有修正）
                </button>
              )}
            <p>
              {p.result?.summary ||
                p.error ||
                p.text.slice(0, 160) ||
                p.attachments.map((a) => a.name).join("、")}
            </p>
            {p.result && (
              <>
                {p.receipt && (
                  <p>
                    新增 {p.receipt.created} 条事项 · 更新 {p.receipt.updated}{" "}
                    次 · 合并 {p.receipt.merged} 份补充材料
                    {p.receipt.lastAction && `；${p.receipt.lastAction}`}
                  </p>
                )}
                <p>
                  {Object.entries(categories)
                    .map(([k, label]) => {
                      const count = p.result!.items.filter(
                        (i) => i.kind === k,
                      ).length;
                      return count ? `${count} 条${label}` : "";
                    })
                    .filter(Boolean)
                    .join(" · ") || "未生成独立事项，原文保留"}
                </p>
                <button
                  onClick={() => {
                    goWorkspace("results", p.id);
                  }}
                >
                  查看这次整理出的内容
                </button>
              </>
            )}
            {!!p.proposedItems?.length && (
              <details open>
                <summary>补充整理结果 · {p.proposedItems.length} 条</summary>
                <p>
                  为避免重复事项，补充读取不会自动新增或覆盖。请选择新增、补充到已有事项，或忽略。
                </p>
                {p.proposedItems.map((item, i) => (
                  <form
                    className="proposal-form"
                    key={i}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      await resolveProposal(
                        p,
                        i,
                        String(data.get("target")),
                        data.get("date") === "on",
                      );
                    }}
                  >
                    <fieldset
                      className="result-body"
                      disabled={p.status !== "ready"}
                    >
                      <h3>{item.title}</h3>
                      <p>{item.summary}</p>
                      <p>
                        来源：
                        {item.sourceIds
                          .map(
                            (id) =>
                              p.sources.find((s) => s.id === id)?.name || id,
                          )
                          .join("、")}
                      </p>
                      {item.due && (
                        <p>
                          补充材料日期：{item.due.date} {item.due.time} ·{" "}
                          {item.due.anchor}
                        </p>
                      )}
                      <label>
                        处理方式
                        <select name="target" required>
                          <option value="">选择如何处理</option>
                          <option value="new">新增一个独立事项</option>
                          {p.result?.items.map((existing, index) => (
                            <option
                              key={p.itemIds?.[index] || index}
                              value={p.itemIds?.[index] || `${p.id}:${index}`}
                            >
                              补充到：{existing.title}
                            </option>
                          ))}
                          <option value="discard">忽略此候选，保留材料</option>
                        </select>
                      </label>
                      {item.due && (
                        <label>
                          <input name="date" type="checkbox" />
                          补充到已有事项时，采用本次材料中的日期
                        </label>
                      )}
                      <button type="submit">确认处理</button>
                    </fieldset>
                  </form>
                ))}
              </details>
            )}
            {p.result && (
              <details>
                <summary>本次事项与关键要求</summary>
                <p>
                  本次共 {p.result.items.length} 条事项；人工修正保持有效。
                  {p.error}
                </p>
                {p.result.items.map((item, i) => (
                  <div className="receipt-item" key={p.itemIds?.[i] || i}>
                    <h3>
                      {categories[item.kind]} · {item.title}
                    </h3>
                    <p>{item.summary}</p>
                    {!!item.facts.length && (
                      <p>原文要求：{item.facts.join("；")}</p>
                    )}
                    {item.due && (
                      <p>
                        日期：{item.due.date} {item.due.time} · 依据：
                        {item.due.anchor}
                      </p>
                    )}
                    <p>
                      重要程度初判：
                      {["低", "普通", "高"][item.importance ?? 1]} ·{" "}
                      {item.importanceReason || "暂无明确依据"}
                    </p>
                  </div>
                ))}
              </details>
            )}
            {!!p.sources.filter((s) => s.id !== "input").length && (
              <details>
                <summary>核对 / 修正提取与识别文字</summary>
                <p>
                  以下为提取文字或识别转写。原件保持不变；已有事项需要你在整理结果中纠正，也可按修正材料另存一次投递重新整理。
                </p>
                {p.sources
                  .filter((s) => s.id !== "input")
                  .map((s) => (
                    <details key={s.id}>
                      <summary>{s.name}</summary>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          await save({
                            ...p,
                            sources: p.sources.map((source) =>
                              source.id === s.id
                                ? {
                                    ...source,
                                    originalText:
                                      source.originalText || source.text,
                                    text: String(data.get("transcript") || ""),
                                  }
                                : source,
                            ),
                          });
                          notify("修正文字已保存；原件和首次转写保留");
                        }}
                      >
                        <textarea
                          name="transcript"
                          disabled={
                            p.status === "processing" || p.status === "pending"
                          }
                          aria-label={`修正 ${s.name}`}
                          defaultValue={s.text}
                          required
                          maxLength={120000}
                          style={{ width: "100%", minHeight: 180 }}
                        />
                        <button
                          type="submit"
                          disabled={
                            p.status === "processing" || p.status === "pending"
                          }
                        >
                          保存转写修正
                        </button>
                      </form>
                      {s.originalText && (
                        <details>
                          <summary>首次提取 / 识别版本</summary>
                          <pre>{s.originalText}</pre>
                        </details>
                      )}
                    </details>
                  ))}
                <button
                  disabled={p.status === "processing"}
                  onClick={async () => {
                    const next = {
                      ...p,
                      id: crypto.randomUUID(),
                      result: null,
                      proposedItems: undefined,
                      itemIds: undefined,
                      itemState: undefined,
                      doneIds: [],
                      association: undefined,
                      organizedSourceIds: undefined,
                      retryUnread: false,
                      status: "pending" as const,
                      deletedAt: undefined,
                      updatedAt: new Date().toISOString(),
                      capturedAt: new Date().toISOString(),
                    };
                    await save(next);
                    notify(
                      "已另存一次投递，将按原投递日期理解相对时间；原有事项保留",
                    );
                  }}
                >
                  按修正材料另存一次投递并整理
                </button>
              </details>
            )}
            {p.association?.links.length ? (
              <p>
                关联到已有事项 {p.association.links.length} 处。
                <button
                  onClick={() =>
                    void save({
                      ...p,
                      association: {
                        state: "ready",
                        links: [],
                        warnings: ["用户撤销了本次自动关联"],
                      },
                    })
                  }
                >
                  撤销本次关联
                </button>
              </p>
            ) : null}
            {!!p.association?.links.length && (
              <details>
                <summary>关联去向与变更依据</summary>
                {p.association.links.map((link) => {
                  const target = linkedItems.get(link.target),
                    from = linkedItems.get(link.from);
                  return (
                    <div key={link.id}>
                      <p>
                        {from?.item.title || "本次事项"} →{" "}
                        {target?.item.title || "目标已删除或暂不可用"} ·{" "}
                        {link.relation === "same"
                          ? "同一事项的补充材料"
                          : "相关事项"}
                      </p>
                      <p>
                        {link.title}
                        ；原始日期和来源分别保留，人工修正不会被自动覆盖。
                      </p>
                      {target && (
                        <button
                          onClick={() =>
                            goWorkspace("results", target.packet.id)
                          }
                        >
                          查看关联去向
                        </button>
                      )}
                    </div>
                  );
                })}
              </details>
            )}
            {p.association?.state === "error" && (
              <p>
                跨次关联尚未完成：{p.association.warnings.join("；")}
                <button
                  onClick={() =>
                    void save({
                      ...p,
                      association: { ...p.association!, state: "pending" },
                    })
                  }
                >
                  仅重试关联
                </button>
              </p>
            )}
            <details>
              <summary>原文、遗漏与操作</summary>
              <DeliverySources packet={p} save={save} notify={notify} />
              <p>
                已提取来源 {p.sources.filter((s) => s.id !== "input").length}{" "}
                个；
                {p.error ||
                  p.result?.warnings.join("；") ||
                  "请核对原文与日期，模型可能有遗漏。"}
              </p>
              {p.status === "error" && (
                <button onClick={() => void retry(p)}>重试整理</button>
              )}
              <button onClick={() => void erase(p)}>删除整次投递</button>
            </details>
          </article>
        ))}
        {visible.length > receiptLimit && (
          <button onClick={() => setReceiptLimit((n) => n + 20)}>
            再显示 20 次投递（共 {visible.length} 次）
          </button>
        )}
      </section>
    ),
    [
      packets,
      progress,
      workingId,
      workspace,
      receiptLimit,
      save,
      notify,
      health,
      apiKey,
      model,
    ],
  );

  return (
    <div
      className="bucket-app"
      onDragOver={(e) => {
        if (skinMarket) return;
        if (e.dataTransfer.types.length) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (skinMarket) return;
        setDrag(false);
        if (!loaded) {
          notify("正在恢复本机资料，请稍后再投递");
          return;
        }
        void addFiles(e.dataTransfer.files);
        const dropped =
          e.dataTransfer.getData("text/plain") ||
          e.dataTransfer.getData("text/uri-list");
        if (dropped) setText((t) => t + (t ? "\n" : "") + dropped);
        if (!e.dataTransfer.files.length && !dropped)
          notify(
            "来源应用没有提供可读取内容；请粘贴文字/截图，或保存文件后拖入",
          );
      }}
    >
      <header className="bucket-header">
        <a href={import.meta.env.BASE_URL} className="bucket-brand">
          <span>拾</span>
          拾序<small>SHIXU</small>
        </a>
        <button
          className="skin-market-entry"
          onClick={() => setSkinMarket(true)}
          aria-label="打开皮肤市场"
        >
          <Palette size={16} />
          <span>皮肤市场</span>
        </button>
        <button
          className="bucket-settings"
          aria-label="连接与设置"
          aria-expanded={settings}
          onClick={() => setSettings((open) => !open)}
        >
          <i
            className={
              apiKey || health?.modelReady || cloudReady ? "status-live" : ""
            }
          />
          <span>
            {new Date()
              .toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })
              .replace("/", "·")}{" "}
            {new Date()
              .toLocaleDateString("en-US", { weekday: "short" })
              .toUpperCase()}{" "}
            · {apiKey || health?.modelReady || cloudReady ? "AI ON" : "AI OFF"}
          </span>
        </button>
        <nav className="workspace-nav" aria-label="主工作区">
          <button
            aria-label="投递桶"
            aria-pressed={workspace === "capture"}
            onClick={() => goWorkspace("capture")}
          >
            <span>桶</span>
            <span className="nav-count">{visible.length}</span>
          </button>
          <button
            aria-label="整理结果"
            aria-pressed={workspace === "results"}
            onClick={() => {
              goWorkspace("results");
            }}
          >
            <span>世界</span>
            <span className="nav-count">✦</span>
          </button>
          <button
            aria-label="DDL"
            aria-pressed={workspace === "ddl"}
            onClick={() => goWorkspace("ddl")}
          >
            <span>DDL</span>
            <span className="nav-count">◷</span>
          </button>
        </nav>
      </header>
      <main className="bucket-main">
        <div hidden={workspace !== "ddl"}>
          <DDL
            reorder={reorderCards}
            active={workspace === "ddl"}
            packets={packets}
            save={save}
            notify={notify}
          />
        </div>
        <div hidden={workspace !== "results"}>
          <Results
            skin={activeSkin}
            reorder={reorderCards}
            onRecords={() => setRecordsOpen(true)}
            onChat={editWithAI}
            packets={packets}
            save={save}
            focusPacket={focusPacket}
            onFocusConsumed={clearFocus}
            notify={notify}
            purge={purgePacket}
          />
        </div>
        <div hidden={workspace !== "capture"}>
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
            <h1>
              什么都行，
              <br />
              <span className="hero-highlight">喂给它。</span>
            </h1>
            <SkinMascot
              key={activeSkin.id}
              skin={activeSkin}
              iceVoice={skinCollection.iceVoice}
              state={
                drag ? "drag" : submitting || workingId ? "feeding" : "idle"
              }
              suspended={skinMarket || settings || workspace !== "capture"}
              feedSignal={feedSignal}
            />
            <button
              className="skin-home-change"
              onClick={() => setSkinMarket(true)}
            >
              <Palette size={12} />
              {activeSkin.name} · 换个伙伴
            </button>
            <p className="count-line">
              它已经吃掉了 <b>{visible.length}</b> 件
            </p>
          </section>
          <section
            className={`bucket-composer ${drag ? "is-dragging" : ""}`}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDrag(false);
            }}
          >
            {dropVisible && (
              <div
                className={"bucket-drop-hint" + (!drag ? " is-leaving" : "")}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDrag(false);
                  if (!loaded) {
                    notify("正在恢复本机资料，请稍后再投递");
                    return;
                  }
                  void addFiles(e.dataTransfer.files);
                  const dropped =
                    e.dataTransfer.getData("text/plain") ||
                    e.dataTransfer.getData("text/uri-list");
                  if (dropped) setText((t) => t + (t ? "\n" : "") + dropped);
                  if (!e.dataTransfer.files.length && !dropped)
                    notify("未接收到可读取内容，请粘贴或保存后拖入");
                }}
              >
                <ArrowDown size={25} />
                <span>松手，放进桶里。</span>
              </div>
            )}
            <textarea
              ref={textarea}
              autoFocus={
                matchMedia("(hover: hover) and (pointer: fine)").matches
              }
              aria-label="往桶里放入内容"
              placeholder={"一句话、一个文件、一个念头…"}
              value={text}
              maxLength={60000}
              disabled={!loaded}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  void addFiles(e.clipboardData.files);
                  const pasted = e.clipboardData.getData("text/plain");
                  if (pasted) setText((t) => t + (t ? "\n" : "") + pasted);
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
                    <AttachmentPreview attachment={a} />
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
                hidden
                ref={input}
                onChange={(e) => void addFiles(e.target.files)}
              />
              <button
                className="bucket-primary bucket-send"
                aria-label="丢进去"
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
                喂！
              </button>
            </div>
          </section>
          <div className="bucket-under-composer">
            <span
              className={`model-status ${apiKey || health?.modelReady || cloudReady ? "is-connected" : ""}`}
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
                    : window.desktop
                      ? cloudActive
                        ? cloudReady
                          ? "服务端 AI 已启用"
                          : "已激活 · AI 暂不可用"
                        : "本机记录 · 激活后使用服务端 AI"
                      : "连接 DeepSeek 后，自动整理"}
              {waiting > 0 && online ? ` · ${waiting} 包等待处理` : ""}
            </span>
            <button
              className="bucket-model-cost"
              onClick={() => setSettings(true)}
              aria-label={
                window.desktop
                  ? "查看激活、同步与 AI 状态"
                  : "选择模型与查看费用"
              }
              aria-expanded={settings}
            >
              连接设置
            </button>
          </div>
          {currentCapture && (
            <section className="current-delivery" aria-label="这次投喂">
              <header>
                <h2>这次放进来的</h2>
                {currentCapture.result && (
                  <button
                    onClick={() => goWorkspace("results", currentCapture.id)}
                  >
                    到世界里看 <ArrowUpRight size={17} />
                  </button>
                )}
              </header>
              {(currentCapture.status === "pending" ||
                currentCapture.status === "processing") && (
                <div className="current-delivery-status" role="status">
                  <LoaderCircle className="bucket-spin" size={23} />
                  <span>
                    {currentCapture.status === "processing"
                      ? (workingId === currentCapture.id && progress) ||
                        "正在整理这次的材料…"
                      : !online
                        ? "已收好，联网后继续整理"
                        : !apiKey && !health?.modelReady
                          ? "已收好，连接后开始整理"
                          : "已收好，等它消化一下…"}
                  </span>
                </div>
              )}
              {currentCapture.status === "error" && (
                <div className="current-delivery-status" role="status">
                  <span>
                    {currentCapture.error || "这次没整理完，材料已经收好。"}
                  </span>
                  <button onClick={() => void retry(currentCapture)}>
                    重试
                  </button>
                </div>
              )}
              {currentCapture.result &&
                (currentCapture.result.items.length ? (
                  <Results
                    skin={activeSkin}
                    key={currentCapture.id}
                    compact
                    reorder={reorderCards}
                    onRecords={() => setRecordsOpen(true)}
                    onChat={editWithAI}
                    packets={[currentCapture]}
                    save={save}
                    focusPacket=""
                    onFocusConsumed={clearFocus}
                    notify={notify}
                    purge={purgePacket}
                  />
                ) : (
                  <p>
                    {currentCapture.result.summary ||
                      "已收好，暂时没有单独的事项。"}
                  </p>
                ))}
            </section>
          )}
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
              {!window.desktop && (
                <a href={`${location.pathname}?preview=bucket`}>
                  看看整理后的样子
                </a>
              )}
            </div>
          )}

          {!window.desktop && <InstallGuide />}
        </div>
        <footer className="bucket-footer">
          <Sparkles size={12} />
          <span>脑袋放轻一点。</span>
        </footer>
      </main>
      {recordsOpen && (
        <ItemDialog label="整理记录" onClose={() => setRecordsOpen(false)}>
          {receipts}
        </ItemDialog>
      )}
      {settings && (
        <Connection
          canSwitchCloud={() =>
            !working.current && !submitLock.current && !chatLocks.current.size
          }
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
      {skinMarket && (
        <SkinMarket
          collection={skinCollection}
          onChange={changeSkins}
          onClose={() => setSkinMarket(false)}
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
function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!attachment.blob || !/\.(png|jpe?g|gif|webp)$/i.test(attachment.name))
      return;
    const next = URL.createObjectURL(attachment.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [attachment]);
  return url ? (
    <img
      src={url}
      alt={`已接收 ${attachment.name}`}
      style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8 }}
    />
  ) : null;
}
