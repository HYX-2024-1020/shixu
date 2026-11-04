import { readImage } from "./image.mjs";
import { sha256 } from "./material.mjs";
import { validateOfficeWindow } from "./office-window.mjs";
export const OFFICE_VISUAL_VERSION = "office-assets/1";
// One bounded text or image-tile window. The structural reader owns the checked
// package; no arbitrary path or host Office process is invoked here.
export async function officeWindowResult(
  result,
  { pkg, plan, format, window, totalText, windowCodepoints },
) {
  window = validateOfficeWindow(window);
  result.readerVersion = OFFICE_VISUAL_VERSION + ";" + result.readerVersion;
  result.normalizationVersion = "office-structure-original-image/1";
  const missing = (code, range = { kind: format }) => {
    result.uncovered.push({ ...range, code });
    if (!result.reasons.includes(code)) result.reasons.push(code);
  };
  for (const range of plan?.missing || []) missing(range.code, range);
  const images = plan?.images || [];
  let next = null,
    imagePagination;
  if (window.text) {
    if (window.offset > totalText) throw Error("INVALID_OFFICE_WINDOW");
    const end = Math.min(totalText, window.offset + windowCodepoints),
      segments = [];
    for (const segment of result.segments) {
      const r = segment.range,
        start = Math.max(window.offset, r.start),
        stop = Math.min(end, r.end);
      if (stop <= start) continue;
      const text = [...segment.text]
        .slice(start - r.start, stop - r.start)
        .join("");
      const sourceId =
        "ot_" +
        sha256(
          [result.attachmentId, segment.sourceId, start, stop].join("\0"),
        ).slice(0, 48);
      const range = { ...r, sourceId, start, end: stop };
      segments.push({ ...segment, sourceId, text, range });
    }
    result.segments = segments;
    result.covered = segments.map((s) => s.range);
    next =
      end < totalText
        ? { ...window, offset: end }
        : images.length
          ? { text: 0, image: 0, tile: 1, offset: end }
          : null;
  } else {
    if (
      !pkg ||
      !images.length ||
      window.image >= images.length ||
      window.offset < totalText
    )
      throw Error("INVALID_OFFICE_WINDOW");
    result.segments = [];
    result.covered = [];
    const ref = images[window.image],
      body = pkg.read(ref.mediaPart);
    const attachmentId =
      "oi_" +
      sha256(
        [result.attachmentId, window.image, ref.part, ref.mediaPart].join("\0"),
      ).slice(0, 48);
    const child = {
      attachmentId,
      name: "image." + ref.extension,
      contentHash: sha256(body),
      segments: [],
      covered: [],
      uncovered: [],
      reasons: [],
      state: "read",
    };
    await readImage(body, child, { tile: window.tile });
    imagePagination = child.imagePagination;
    if (child.decoderMetrics) result.decoderMetrics = child.decoderMetrics;
    for (const segment of child.segments) {
      const range = {
        ...segment.range,
        ...ref,
        kind: "image",
        officeKind: format,
        name: result.name,
        start: window.offset,
        end: window.offset + 1,
      };
      result.covered.push(range);
      result.segments.push({
        ...segment,
        range,
        text:
          segment.text +
          "\nOffice内嵌原图资源；" +
          (ref.hiddenSheet
            ? "位于隐藏工作表（" + ref.hiddenSheet + "）；"
            : "") +
          "来源为" +
          ref.part +
          " → " +
          ref.mediaPart +
          "，不代表文档裁剪、变换或页面布局。",
      });
    }
    for (const r of child.uncovered)
      missing(r.code, { ...ref, kind: "image", officeKind: format });
    const offset = window.offset + result.covered.length;
    next = imagePagination?.nextTile
      ? { ...window, tile: imagePagination.nextTile, offset }
      : window.image + 1 < images.length
        ? { text: 0, image: window.image + 1, tile: 1, offset }
        : null;
    missing("OFFICE_DRAWING_LAYOUT_UNREAD", { ...ref, kind: format });
    result.officeImageParts = [
      {
        image: window.image + 1,
        totalImages: images.length,
        mediaPart: ref.mediaPart,
        part: ref.part,
        checked: window.tile,
        total: imagePagination?.totalTiles || 0,
      },
    ];
  }
  result.officePagination = {
    start: window,
    next,
    totalText,
    nextOffset: result.covered.at(-1)?.end ?? window.offset,
    totalImages: images.length,
    ...(imagePagination ? { image: imagePagination } : {}),
    ...(!window.text && !imagePagination ? { failedImage: true } : {}),
  };
  if (next)
    missing("OFFICE_WINDOW_PENDING", {
      kind: format,
      ...(next.text
        ? { textFrom: next.offset, textTotal: totalText }
        : { ...images[next.image], image: next.image + 1, tile: next.tile }),
    });
  // Only exact referenced media assets are read. Other original object/layout
  // omissions stay explicit; never mark an entire drawing or sheet rendered.
  const media = new Set(images.map((i) => i.mediaPart));
  result.uncovered = result.uncovered.filter(
    (r) =>
      !(
        (r.code === "DOCX_OBJECT_UNREAD" || r.code === "XLSX_OBJECT_UNREAD") &&
        media.has(r.part)
      ),
  );
  result.reasons = [...new Set(result.uncovered.map((r) => r.code))];
  result.state = result.uncovered.length
    ? result.segments.length
      ? "partial"
      : result.reasons.some((c) => /UNSUPPORTED|UNREAD/.test(c))
        ? "unsupported"
        : "partial"
    : result.segments.length
      ? "read"
      : "failed";
  return result;
}
