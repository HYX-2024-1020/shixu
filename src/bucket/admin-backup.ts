import type { Packet, Attachment } from "./types";
import type { UsageRecord } from "../../shared/usage.mjs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export interface BrowserSnapshot {
  packets: Packet[];
  usage: UsageRecord[];
  draft: { text: string; attachments: Attachment[] };
}
const LIMIT = 100 * 1024 * 1024;
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");
const id = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,150}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
function invalid(): never {
  throw new Error("备份内容不完整或格式不支持，未改动本机资料");
}
function attachments(v: unknown): asserts v is Attachment[] {
  if (
    !Array.isArray(v) ||
    v.some(
      (a) =>
        !object(a) ||
        !id(a.id) ||
        typeof a.name !== "string" ||
        typeof a.type !== "string" ||
        !Number.isSafeInteger(a.size) ||
        a.size < 0,
    )
  )
    invalid();
}
function validate(v: unknown): asserts v is BrowserSnapshot {
  if (
    !object(v) ||
    v.format !== "shixu-admin-test-v1" ||
    !Array.isArray(v.packets) ||
    !Array.isArray(v.usage) ||
    !object(v.draft) ||
    typeof v.draft.text !== "string"
  )
    invalid();
  attachments(v.draft.attachments);
  const seen = new Set();
  for (const p of v.packets) {
    if (
      !object(p) ||
      !id(p.id) ||
      seen.has(p.id) ||
      typeof p.text !== "string" ||
      typeof p.capturedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.captureDate) ||
      typeof p.updatedAt !== "string" ||
      typeof p.error !== "string" ||
      !["pending", "processing", "ready", "error"].includes(p.status)
    )
      invalid();
    seen.add(p.id);
    attachments(p.attachments);
    if (
      !Array.isArray(p.sources) ||
      p.sources.some(
        (s: any) =>
          !object(s) ||
          typeof s.id !== "string" ||
          typeof s.name !== "string" ||
          typeof s.text !== "string",
      ) ||
      !Array.isArray(p.doneIds) ||
      p.doneIds.some((n: any) => !Number.isInteger(n))
    )
      invalid();
    if (p.itemIds !== undefined && !strings(p.itemIds)) invalid();
    if (p.organizedSourceIds !== undefined && !strings(p.organizedSourceIds))
      invalid();
    if (
      p.coverage !== undefined &&
      (!Array.isArray(p.coverage) ||
        p.coverage.some(
          (c: any) =>
            !object(c) ||
            !strings(c.sourceIds) ||
            typeof c.detail !== "string" ||
            typeof c.name !== "string",
        ))
    )
      invalid();
    if (
      p.association !== undefined &&
      (!object(p.association) ||
        !Array.isArray(p.association.links) ||
        !strings(p.association.warnings) ||
        p.association.links.some(
          (l: any) =>
            !object(l) ||
            typeof l.from !== "string" ||
            typeof l.target !== "string" ||
            (l.contextRefs !== undefined && !strings(l.contextRefs)),
        ))
    )
      invalid();
    if (p.result !== null) {
      const r = p.result;
      if (
        !object(r) ||
        typeof r.summary !== "string" ||
        !strings(r.warnings) ||
        !Array.isArray(r.items)
      )
        invalid();
      for (const item of r.items) {
        if (
          !object(item) ||
          ![
            "task",
            "idea",
            "habit",
            "note",
            "event",
            "notice",
            "other",
          ].includes(item.kind) ||
          typeof item.title !== "string" ||
          typeof item.summary !== "string" ||
          !strings(item.facts) ||
          !strings(item.nextSteps) ||
          !strings(item.uncertainties) ||
          !strings(item.sourceIds) ||
          !Array.isArray(item.evidence) ||
          item.evidence.some(
            (e: any) =>
              !object(e) ||
              typeof e.sourceId !== "string" ||
              typeof e.quote !== "string",
          )
        )
          invalid();
        if (
          item.due !== null &&
          (!object(item.due) ||
            typeof item.due.date !== "string" ||
            typeof item.due.time !== "string" ||
            typeof item.due.anchor !== "string" ||
            typeof item.due.sourceId !== "string")
        )
          invalid();
      }
    }
    if (p.itemState !== undefined) {
      if (!object(p.itemState)) invalid();
      for (const [key, s] of Object.entries(p.itemState)) {
        if (!id(key) || !object(s)) invalid();
        for (const prop of ["chat", "additions", "history"])
          if (
            s[prop] !== undefined &&
            (!Array.isArray(s[prop]) ||
              s[prop].some(
                (x: any) =>
                  !object(x) ||
                  Object.values(x).some((y) => typeof y !== "string"),
              ))
          )
            invalid();
        if (s.checkins !== undefined && !strings(s.checkins)) invalid();
        for (const prop of [
          "status",
          "completedAt",
          "deletedAt",
          "group",
          "origin",
          "purgedAt",
        ])
          if (s[prop] !== undefined && typeof s[prop] !== "string") invalid();
        for (const prop of ["order", "importance"])
          if (s[prop] !== undefined && typeof s[prop] !== "number") invalid();
      }
    }
  }
  const usageIds = new Set();
  for (const u of v.usage) {
    if (
      !object(u) ||
      !id(u.id) ||
      usageIds.has(u.id) ||
      typeof u.packetId !== "string" ||
      typeof u.startedAt !== "string" ||
      typeof u.model !== "string" ||
      typeof u.requestedModel !== "string" ||
      !["pending", "reported", "unreported"].includes(u.state)
    )
      invalid();
    usageIds.add(u.id);
    if (
      u.usage !== null &&
      (!object(u.usage) ||
        ["prompt", "completion", "total"].some(
          (k) => typeof u.usage[k] !== "number",
        ))
    )
      invalid();
    if (
      u.cost !== null &&
      (!object(u.cost) ||
        typeof u.cost.min !== "number" ||
        typeof u.cost.max !== "number")
    )
      invalid();
  }
}
export async function encodeSnapshot(
  value: BrowserSnapshot,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  async function clean(list: Attachment[]) {
    return Promise.all(
      list.map(async ({ blob, ...a }) => {
        if (!blob) throw new Error(`原件缺失：${a.name}，备份未完成`);
        total += blob.size;
        if (total > LIMIT) throw new Error("手机备份原件合计上限为 100MB");
        files[`files/${a.id}`] = new Uint8Array(await blob.arrayBuffer());
        return a;
      }),
    );
  }
  const packets = await Promise.all(
    value.packets.map(async (p) => ({
      ...p,
      attachments: await clean(p.attachments),
    })),
  );
  const draft = {
    ...value.draft,
    attachments: await clean(value.draft.attachments),
  };
  // Only content stores are exported; connection settings and API keys are never read.
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "shixu-admin-test-v1",
      exportedAt: new Date().toISOString(),
      packets,
      usage: value.usage,
      draft,
    }),
  );
  if (total + files["manifest.json"].length > LIMIT)
    throw new Error("备份超过手机恢复容量上限 100MB");
  return zipSync(files, { level: 1 });
}
export function decodeSnapshot(bytes: Uint8Array): BrowserSnapshot {
  if (bytes.length > LIMIT) throw new Error("备份文件超过 100MB");
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (e) => {
      total += e.originalSize;
      if (e.originalSize < 0 || total > LIMIT)
        throw new Error("备份展开后超过 100MB，未改动本机资料");
      return true;
    },
  });
  if (!files["manifest.json"]) invalid();
  const value: unknown = JSON.parse(strFromU8(files["manifest.json"]));
  validate(value);
  function hydrate(list: Attachment[]) {
    return list.map((a) => {
      const data = files[`files/${a.id}`];
      if (!data || data.length !== a.size) invalid();
      return {
        ...a,
        blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: a.type }),
      };
    });
  }
  return {
    packets: value.packets.map((p) => ({
      ...p,
      remote: false,
      remoteDirty: false,
      syncAutoOrganize: false,
      attachments: hydrate(p.attachments),
      status: p.status === "ready" ? "ready" : "error",
      error:
        p.status === "ready"
          ? p.error
          : "从备份恢复，尚未整理的内容请在整理记录里手动重试",
      association:
        p.association && ["pending", "processing"].includes(p.association.state)
          ? {
              ...p.association,
              state: "error",
              warnings: ["备份恢复后不会自动付费关联，可按需手动重试"],
            }
          : p.association,
    })),
    usage: value.usage.map((u) =>
      u.state === "pending" ? { ...u, state: "unreported" } : u,
    ),
    draft: { ...value.draft, attachments: hydrate(value.draft.attachments) },
  };
}
