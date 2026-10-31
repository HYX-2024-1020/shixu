import { sha256 } from "./material.mjs";
import { encodePng } from "./image.mjs";

export const PDF_VISUAL_VERSION = "pdf-visual/1;pdfjs/6.2.108;canvas/1.0.13";
export function validatePdfVisualWindow(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== "offset,page,tile" ||
    !Object.values(value).every((n) => Number.isSafeInteger(n) && n >= 0) ||
    value.page < 1 ||
    value.page > 2147483647 ||
    value.tile < 1 ||
    value.tile > 64 ||
    value.offset > Number.MAX_SAFE_INTEGER - 8 * 1024 * 1024
  )
    throw Error("INVALID_PDF_VISUAL_WINDOW");
  return { page: value.page, tile: value.tile, offset: value.offset };
}
const noResource = class {
  fetch() {
    throw Error("PDF_EXTERNAL_RESOURCE_UNSUPPORTED");
  }
};
export async function readPdfVisual(bytes, result, window) {
  window = validatePdfVisualWindow(window);
  if (!window) throw Error("INVALID_PDF_VISUAL_WINDOW");
  result.readerVersion = PDF_VISUAL_VERSION;
  result.normalizationVersion = "pdf-108dpi-white-png/1";
  const missing = (code, range = { kind: "pdf", page: window.page }) => {
    result.uncovered.push({ ...range, code });
    if (!result.reasons.includes(code)) result.reasons.push(code);
  };
  const prefix = `${result.attachmentId.slice(0, 54)}_${sha256(result.attachmentId).slice(0, 12)}`;
  let loading,
    page,
    surface,
    document,
    factory,
    offset = window.offset;
  const addText = (text) => {
    let chunk = "",
      count = 0,
      part = 0;
    const flush = () => {
      if (!chunk) return;
      const sourceId = `${prefix}_vp${window.page}_t${part++}`;
      const range = {
        name: result.name,
        sourceId,
        start: offset,
        end: offset + count,
        kind: "pdf",
        page: window.page,
        part: part - 1,
        rotation: page.rotate,
      };
      result.covered.push(range);
      result.segments.push({
        sourceId,
        range,
        text: chunk,
        structure: { encoding: "pdf-content-order" },
      });
      offset += count;
      chunk = "";
      count = 0;
    };
    if (!text.trim()) return;
    for (const char of text) {
      chunk += char;
      if (++count === 120000) flush();
    }
    flush();
  };
  try {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw Error("FORMAT_MISMATCH");
    const { directory, BoundedCanvasFactory } = await import(
      "./pdf-canvas.mjs"
    );
    const { getDocument, OPS, takeRenderWarningCount } = await import(
      new URL("api.mjs", directory)
    );
    takeRenderWarningCount();
    const { WorkerMessageHandler, takeWorkerWarningCount } = await import(
      new URL("core.mjs", directory)
    );
    takeWorkerWarningCount();
    globalThis.pdfjsWorker = { WorkerMessageHandler };
    loading = getDocument({
      data: Uint8Array.from(bytes),
      verbosity: 0,
      stopAtErrors: true,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      useWasm: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      maxImageSize: 32_000_000,
      CanvasFactory: BoundedCanvasFactory,
      CMapReaderFactory: noResource,
      StandardFontDataFactory: noResource,
      WasmFactory: noResource,
      canvasMaxAreaInBytes: 128_000_000,
    });
    document = await loading.promise;
    if (window.page > document.numPages) throw Error("PDF_CURSOR_OUT_OF_RANGE");
    page = await document.getPage(window.page);
    factory = document.canvasFactory;
    // Keep text content and pixel coverage distinct. Only the first tile carries
    // text, so resuming an image tile cannot repeatedly publish/charge it.
    if (window.tile === 1) {
      const stream = page
        .streamTextContent({
          disableNormalization: true,
          includeMarkedContent: false,
        })
        .getReader();
      let text = "",
        units = 0,
        limited = false;
      try {
        for (;;) {
          const { value, done } = await stream.read();
          if (done) break;
          for (const item of value.items || []) {
            if (typeof item.str !== "string" || limited) continue;
            const part =
              item.str.replace(/\r\n?/g, "\n") + (item.hasEOL ? "\n" : "");
            units += part.length;
            if (units > 8 * 1024 * 1024) {
              limited = true;
              text = "";
            } else text += part;
          }
        }
      } finally {
        stream.releaseLock();
      }
      if (limited) missing("PDF_RESOURCE_LIMIT");
      else addText(text.endsWith("\n") ? text : text + "\n");
    }
    const viewport = page.getViewport({ scale: 1.5 }),
      width = Math.ceil(viewport.width),
      height = Math.ceil(viewport.height);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 16384 ||
      height > 16384 ||
      width * height > 32_000_000
    )
      throw Error("PDF_VISUAL_PIXEL_LIMIT");
    const columns = Math.ceil(width / 1024),
      totalTiles = columns * Math.ceil(height / 1024);
    if (totalTiles > 64) throw Error("PDF_VISUAL_PIXEL_LIMIT");
    if (window.tile > totalTiles) throw Error("PDF_CURSOR_OUT_OF_RANGE");
    const operators = await page.getOperatorList({ annotationMode: 0 });
    for (let n = 0; n < operators.fnArray.length; n++)
      if (operators.fnArray[n] === OPS.setFont) {
        const font = page.commonObjs.get(operators.argsArray[n][0]);
        if (font.missingFile && !font.isType3Font)
          throw Error("PDF_VISUAL_FONT_UNSUPPORTED");
      }
    const annotations = await page.getAnnotations({ intent: "display" });
    if (annotations.length) missing("PDF_ANNOTATION_UNREAD");
    surface = factory.create(width, height);
    await page.render({
      canvas: surface.canvas,
      canvasContext: surface.context,
      viewport,
      background: "rgb(255,255,255)",
      annotationMode: 0,
    }).promise;
    if (takeRenderWarningCount() + takeWorkerWarningCount())
      throw Error("PDF_VISUAL_RENDER_WARNING");
    const x = ((window.tile - 1) % columns) * 1024,
      y = Math.floor((window.tile - 1) / columns) * 1024;
    const tileWidth = Math.min(1024, width - x),
      tileHeight = Math.min(1024, height - y);
    const pixels = Buffer.from(
      surface.context.getImageData(x, y, tileWidth, tileHeight).data,
    );
    const png = encodePng(tileWidth, tileHeight, pixels),
      sourceId = `${prefix}_vp${window.page}_i${window.tile}`;
    const range = {
      name: result.name,
      kind: "image",
      sourceId,
      start: offset,
      end: offset + 1,
      page: window.page,
      rotation: page.rotate,
      tile: window.tile,
      totalTiles,
      x,
      y,
      width: tileWidth,
      height: tileHeight,
      imageWidth: width,
      imageHeight: height,
      imageHash: sha256(png),
      dpi: 108,
    };
    offset++;
    result.covered.push(range);
    result.segments.push({
      sourceId,
      range,
      text: `PDF页面视觉模型识别，第${window.page}页，第${window.tile}/${totalTiles}区域，108dpi，像素范围(${x},${y},${tileWidth},${tileHeight})`,
      image: {
        mime: "image/png",
        data: png.toString("base64"),
        hash: range.imageHash,
        width: tileWidth,
        height: tileHeight,
      },
    });
    result.pdfVisualPagination = {
      page: window.page,
      startTile: window.tile,
      totalTiles,
      totalPages: document.numPages,
      width,
      height,
      startOffset: window.offset,
      nextOffset: offset,
      next:
        window.tile < totalTiles
          ? { page: window.page, tile: window.tile + 1, offset }
          : window.page < document.numPages
            ? { page: window.page + 1, tile: 1, offset }
            : null,
    };
  } catch (error) {
    if (
      ["INVALID_PDF_VISUAL_WINDOW", "PDF_CURSOR_OUT_OF_RANGE"].includes(
        error.message,
      )
    )
      throw error;
    const code =
      error.name === "PasswordException"
        ? "PDF_ENCRYPTED_UNSUPPORTED"
        : /^(PDF_|FORMAT_MISMATCH)/.test(error.message)
          ? error.message
          : "PDF_VISUAL_RENDER_FAILED";
    missing(code);
    if (document) {
      result.pdfVisualPagination = {
        page: window.page,
        startTile: window.tile,
        totalTiles: window.tile,
        totalPages: document.numPages,
        startOffset: window.offset,
        nextOffset: offset,
        failedPage: true,
        next:
          window.page < document.numPages
            ? { page: window.page + 1, tile: 1, offset }
            : null,
      };
    }
  } finally {
    if (surface) factory.destroy(surface);
    page?.cleanup();
    await loading?.destroy();
  }
  const next = result.pdfVisualPagination?.next;
  if (next)
    missing("PDF_VISUAL_WINDOW_PENDING", {
      kind: "pdf",
      page: next.page,
      pageEnd: result.pdfVisualPagination.totalPages,
      tile: next.tile,
    });
  result.state = result.uncovered.length
    ? result.segments.length
      ? "partial"
      : result.reasons.some((c) => /UNSUPPORTED/.test(c))
        ? "unsupported"
        : "failed"
    : "read";
  return result;
}
