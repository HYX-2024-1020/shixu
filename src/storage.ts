import {
  DEFAULT_PREFS,
  type Entry,
  type Preferences,
  type Snapshot,
} from "./types";
import { validDate } from "./organize";

let database: Promise<IDBDatabase> | undefined;
let namespace = "shixu";
export function setNamespace(value: string) {
  if (namespace !== value) {
    namespace = value;
    database?.then((d) => d.close());
    database = undefined;
  }
}
function db() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(namespace, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("entries", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(new Error("无法打开本机存储，请检查浏览器是否允许保存网站数据"));
    };
  });
  return database;
}
export async function readAll(): Promise<{
  entries: Entry[];
  preferences: Preferences;
}> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["entries", "settings"], "readonly");
    const entries = tx.objectStore("entries").getAll();
    const prefs = tx.objectStore("settings").get("preferences");
    tx.oncomplete = () =>
      resolve({
        entries: entries.result,
        preferences: { ...DEFAULT_PREFS, ...prefs.result },
      });
    tx.onerror = () => reject(new Error("读取数据失败"));
  });
}
export async function writeEntries(entries: Entry[], removeIds: string[] = []) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("entries", "readwrite");
    const store = tx.objectStore("entries");
    entries.forEach((entry) => store.put(entry));
    removeIds.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error("保存失败，可能存储空间不足。请先导出备份。"));
  });
}
export async function mergeEntries(entries: Entry[]) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("entries", "readwrite");
    const store = tx.objectStore("entries");
    for (const entry of entries) {
      const request = store.get(entry.id);
      request.onsuccess = () => {
        const previous = request.result as Entry | undefined;
        if (!previous || entry.updatedAt > previous.updatedAt) store.put(entry);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("合并数据失败，本机内容已保留"));
  });
}
export async function writePreferences(preferences: Preferences) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("settings", "readwrite");
    tx.objectStore("settings").put(preferences, "preferences");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("设置保存失败"));
  });
}
export function validateBackup(value: unknown): Snapshot {
  if (!value || typeof value !== "object") throw new Error("备份格式不正确");
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    !Array.isArray(data.entries) ||
    data.entries.length > 10000
  )
    throw new Error("不支持此备份版本，或条目数超过 10000");
  const ids = new Set<string>();
  const entries = data.entries.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("备份存在无效事项");
    const x = item as Record<string, unknown>;
    const str = (key: string, max = 20000): string => {
      if (typeof x[key] !== "string" || (x[key] as string).length > max)
        throw new Error(`备份的 ${key} 无效`);
      return x[key] as string;
    };
    const id = str("id", 100);
    if (!id || ids.has(id)) throw new Error("备份存在重复或空的事项 ID");
    ids.add(id);
    const title = str("title", 150);
    if (!title.trim()) throw new Error("事项标题不能为空");
    const due = str("due", 10);
    if (due && !validDate(due)) throw new Error("备份存在无效日期");
    const time = str("time", 5);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("备份存在无效时间");
    if (
      !["task", "notice", "project", "idea", "habit"].includes(
        String(x.kind),
      ) ||
      !["high", "normal", "low"].includes(String(x.priority)) ||
      !["inbox", "active", "done", "archived"].includes(String(x.status))
    )
      throw new Error("备份存在无效类别或状态");
    if (
      !Array.isArray(x.tags) ||
      x.tags.length > 12 ||
      !x.tags.every((t) => typeof t === "string" && t.length <= 40)
    )
      throw new Error("备份存在无效标签");
    if (
      !Array.isArray(x.checkins) ||
      !x.checkins.every((d) => typeof d === "string" && validDate(d)) ||
      x.checkins.length > 10000
    )
      throw new Error("备份存在无效打卡");
    const createdAt = str("createdAt", 50),
      updatedAt = str("updatedAt", 50);
    if (
      Number.isNaN(Date.parse(createdAt)) ||
      Number.isNaN(Date.parse(updatedAt))
    )
      throw new Error("备份时间无效");
    return {
      id,
      title,
      content: str("content"),
      due,
      time,
      kind: x.kind,
      priority: x.priority,
      status: x.status,
      dateHint: str("dateHint", 200),
      confirmedDate: x.confirmedDate === true,
      tags: x.tags,
      project: str("project", 100),
      createdAt,
      updatedAt,
      checkins: [...new Set(x.checkins)],
      ...(typeof x.completedAt === "string" &&
      !Number.isNaN(Date.parse(x.completedAt))
        ? { completedAt: x.completedAt }
        : {}),
      ...(typeof x.deletedAt === "string" &&
      !Number.isNaN(Date.parse(x.deletedAt))
        ? { deletedAt: x.deletedAt }
        : {}),
    } as Entry;
  });
  // Only portable presentation preferences are imported; never accept remote endpoints from a file.
  const p =
    data.preferences && typeof data.preferences === "object"
      ? (data.preferences as Record<string, unknown>)
      : {};
  return {
    version: 1,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    entries,
    preferences: {
      ...DEFAULT_PREFS,
      name: typeof p.name === "string" ? p.name.slice(0, 30) : "同学",
      dailyGoal:
        typeof p.dailyGoal === "number"
          ? Math.min(20, Math.max(1, Math.floor(p.dailyGoal)))
          : 3,
      theme: ["dark", "system"].includes(String(p.theme))
        ? (p.theme as "dark" | "system")
        : "light",
    },
  };
}
export async function encryptBackup(
  snapshot: Snapshot,
  password: string,
): Promise<string> {
  if (password.length < 8) throw new Error("备份密码至少需要 8 个字符");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(snapshot)),
  );
  return JSON.stringify({
    format: "shixu-encrypted-v1",
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  });
}
async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
function toBase64(bytes: Uint8Array) {
  let result = "";
  for (const b of bytes) result += String.fromCharCode(b);
  return btoa(result);
}
function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function decryptBackup(
  data: Record<string, string>,
  password: string,
): Promise<Snapshot> {
  try {
    const salt = fromBase64(data.salt),
      iv = fromBase64(data.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error();
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      fromBase64(data.data),
    );
    return validateBackup(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new Error("无法解密：密码不正确或备份文件已损坏");
  }
}
