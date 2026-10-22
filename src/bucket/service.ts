import type { Packet } from "./types";
export interface Health {
  application: "shixu-bucket";
  authenticated: boolean;
  needsPassword: boolean;
  modelReady: boolean;
  model: string;
}
export const apiUrl = (path: string) =>
  `${import.meta.env.BASE_URL}api/${path}`;
export async function serviceRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal || AbortSignal.timeout(25000),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "个人服务返回格式不正确" }));
  if (!response.ok)
    throw new Error(data.error || `个人服务返回 ${response.status}`);
  return data;
}
export async function detectService(): Promise<Health | null> {
  try {
    const data = await serviceRequest("health", {
      signal: AbortSignal.timeout(5000),
    });
    return data.application === "shixu-bucket" ? data : null;
  } catch {
    return null;
  }
}
export async function uploadPacket(packet: Packet): Promise<Packet> {
  const form = new FormData();
  form.append(
    "packet",
    JSON.stringify({
      ...packet,
      attachments: packet.attachments.map(({ blob, ...a }) => a),
      result: null,
    }),
  );
  for (const attachment of packet.attachments) {
    if (!attachment.blob)
      throw new Error(`原文件 ${attachment.name} 不在此设备，请从原设备重试`);
    form.append("file:" + attachment.id, attachment.blob, attachment.name);
  }
  return (await serviceRequest("packets", { method: "POST", body: form }))
    .packet;
}
export async function exportPackets(packets: Packet[]) {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const packet of packets.filter((p) => !p.deletedAt))
    for (const a of packet.attachments) {
      let blob = a.blob;
      if (!blob && packet.remote) {
        const response = await fetch(
          apiUrl("attachments/" + encodeURIComponent(a.id)),
          { credentials: "same-origin" },
        );
        if (!response.ok) throw new Error(`无法备份原文件：${a.name}`);
        blob = await response.blob();
      }
      if (!blob) throw new Error(`原文件缺失：${a.name}`);
      total += blob.size;
      if (total > 100 * 1024 * 1024)
        throw new Error("备份附件超过100MB，请使用个人服务器的数据目录备份");
      files[`files/${a.id}`] = new Uint8Array(await blob.arrayBuffer());
    }
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: "shixu-bucket-v1",
        exportedAt: new Date().toISOString(),
        packets: packets
          .filter((p) => !p.deletedAt)
          .map((p) => ({
            ...p,
            attachments: p.attachments.map(({ blob, ...a }) => a),
          })),
      },
      null,
      2,
    ),
  );
  const zipped = zipSync(files, { level: 1 }),
    blob = new Blob([zipped as Uint8Array<ArrayBuffer>], {
      type: "application/zip",
    }),
    url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `shixu-bucket-${new Date().toISOString().slice(0, 10)}.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
