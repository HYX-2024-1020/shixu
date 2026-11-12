import type { Attachment, Packet } from "./types";

export function readableFileName(file: Attachment, packet?: Packet) {
  const suffix = file.name.match(/\.[a-z0-9]{1,8}$/i)?.[0] || "";
  const stem = file.name.slice(0, file.name.length - suffix.length);
  const opaque =
    /^[a-f0-9]{20,}$/i.test(stem) ||
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(stem) ||
    (stem.length >= 24 &&
      /^[A-Za-z0-9_-]+$/.test(stem) &&
      /[a-zA-Z]/.test(stem) &&
      /\d/.test(stem));
  if (!opaque || !packet) return file.name;
  const coverage = packet.readingCoverage?.find(
    (c) => c.attachmentId === file.id,
  );
  const ids = new Set(coverage?.covered.map((r) => r.sourceId) || []);
  const item = packet.result?.items.find((i) =>
    i.evidence.some((e) => ids.has(e.sourceId)),
  );
  const title = item?.title || packet.text.trim().split(/[\n。！？]/)[0];
  const index = packet.attachments.findIndex((a) => a.id === file.id) + 1;
  return (
    (title
      ? title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").slice(0, 28) + "·相关材料"
      : "投递材料") +
    index +
    suffix
  );
}
