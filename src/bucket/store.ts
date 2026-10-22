import type { Packet, Attachment } from "./types";
import type { UsageRecord } from "../../shared/usage.mjs";
const name = new URLSearchParams(location.search).has("preview")
  ? new URLSearchParams(location.search).get("preview") === "relations"
    ? "shixu-bucket-demo-relations"
    : "shixu-bucket-demo"
  : "shixu-bucket";
let promise: Promise<IDBDatabase> | null = null;
function database() {
  return (promise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("packets"))
        request.result.createObjectStore("packets", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("draft"))
        request.result.createObjectStore("draft");
      if (!request.result.objectStoreNames.contains("usage"))
        request.result.createObjectStore("usage", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () =>
      reject(new Error("请关闭其他旧版拾序标签页后刷新，原有资料会保留"));
    request.onerror = () =>
      reject(new Error("浏览器无法保存内容，请检查网站数据权限"));
  }));
}
export async function allUsage(): Promise<UsageRecord[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("usage", "readonly"),
      r = tx.objectStore("usage").getAll();
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(new Error("读取用量记录失败"));
  });
}
export async function putUsage(record: UsageRecord) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("usage", "readwrite");
    tx.objectStore("usage").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error("用量记录未保存，请到官方控制台核对账单"));
  });
}
export async function allPackets(): Promise<Packet[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("packets", "readonly"),
      r = tx.objectStore("packets").getAll();
    tx.oncomplete = () =>
      resolve(
        r.result.sort((a: Packet, b: Packet) =>
          b.capturedAt.localeCompare(a.capturedAt),
        ),
      );
    tx.onerror = () => reject(new Error("读取桶里的内容失败"));
  });
}
export async function putPacket(packet: Packet) {
  return putPackets([packet]);
}
export async function putPackets(packets: Packet[]) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("packets", "readwrite");
    for (const packet of packets) tx.objectStore("packets").put(packet);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("保存失败，请检查设备剩余空间"));
  });
}
export async function removePacket(id: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("packets", "readwrite");
    tx.objectStore("packets").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("删除失败"));
  });
}
export async function readDraft(): Promise<{
  text: string;
  attachments: Attachment[];
}> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("draft", "readonly"),
      r = tx.objectStore("draft").get("current");
    tx.oncomplete = () => resolve(r.result || { text: "", attachments: [] });
    tx.onerror = () => reject(new Error("读取输入草稿失败"));
  });
}
export async function writeDraft(value: {
  text: string;
  attachments: Attachment[];
}) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("draft", "readwrite");
    tx.objectStore("draft").put(value, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("草稿未能保存，请先投递后再关闭页面"));
  });
}
