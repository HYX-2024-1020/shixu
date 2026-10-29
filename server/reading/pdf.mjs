import { getDocument } from "./pdf-api.mjs";
import { WorkerMessageHandler } from "./pdf-core.mjs";
import { validatePdfWindow, PDF_WINDOW_PAGES } from "./pdf-window.mjs";

export const PDF_READER_VERSION = "pdf-text/3;pdfjs/6.2.108";
// A resource ceiling, not a document/page limit. Unvisited pages are reported.
export const PDF_TEXT_UNITS = 8 * 1024 * 1024;

// Production invokes this ONLY inside the broker's restricted process. The
// API/worker pair runs in that same process; it has no canvas/native modules,
// host fonts, URL loader, credentials, scripting manager or rendering calls.
export async function readPdf(bytes, { add, missing, textUnitLimit = PDF_TEXT_UNITS, window }) {
  window = validatePdfWindow(window);
  if (!Number.isSafeInteger(textUnitLimit) || textUnitLimit < 1 || textUnitLimit > PDF_TEXT_UNITS)
    throw Error("INVALID_PDF_TEXT_LIMIT");
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    missing("FORMAT_MISMATCH");
    return;
  }
  globalThis.pdfjsWorker = { WorkerMessageHandler };
  const loading = getDocument({
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
    // Unsupported CMaps/fonts must fail a page instead of consulting the host.
    CMapReaderFactory: class {
      fetch() {
        throw Error("PDF_CMAP_UNAVAILABLE");
      }
    },
    StandardFontDataFactory: class {
      fetch() {
        throw Error("PDF_FONT_UNAVAILABLE");
      }
    },
  });
  let document;
  let units = 0;
  let pagination;
  try {
    document = await loading.promise;
    const first = window?.page || 1;
    if (first > document.numPages) throw Error("PDF_CURSOR_OUT_OF_RANGE");
    const last = window ? Math.min(document.numPages, first + PDF_WINDOW_PAGES - 1) : document.numPages;
    pagination = { startPage:first, nextPage:first, totalPages:document.numPages };
    for (let pageNumber = first; pageNumber <= last; pageNumber++) {
      // No fixed total page cap. Expanded text and the broker's total memory,
      // output and execution ceilings remain independent safety boundaries.
      if (units >= textUnitLimit) {
        missing("PDF_RESOURCE_LIMIT", {
          kind: "pdf",
          page: pageNumber,
          pageEnd: document.numPages,
        });
        break;
      }
      let page;
      try {
        page = await document.getPage(pageNumber);
        const stream = page
          .streamTextContent({
            disableNormalization: true,
            includeMarkedContent: false,
          })
          .getReader();
        let text = "", overLimit = false;
        try {
          for (;;) {
            const { value, done } = await stream.read();
            if (done) break;
            // Drain the current page without retaining more text once limited.
            // Cancelling this in-process PDF.js stream races queued enqueue
            // messages and can terminate Node before a trusted prefix is sent.
            if (overLimit) continue;
            for (const item of value.items) {
              if (typeof item.str !== "string") continue;
              const part =
                item.str.replace(/\r\n?/g, "\n") + (item.hasEOL ? "\n" : "");
              units += part.length;
              if (units > textUnitLimit) {
                overLimit = true;
                text = "";
                break;
              }
              text += part;
            }
          }
        } finally {
          stream.releaseLock();
        }
        if (overLimit) {
          missing("PDF_RESOURCE_LIMIT", { kind: "pdf", page: pageNumber, pageEnd: document.numPages });
          break;
        }
        const range = { kind: "pdf", page: pageNumber, rotation: page.rotate };
        if (text.trim()) {
          // Commit only a fully extracted page; an error cannot publish its
          // prefix. PDF content order is retained; no geometric table guesses.
          add(text.endsWith("\n") ? text : text + "\n", range, {
            encoding: "pdf-content-order",
            rotation: page.rotate,
          });
          missing("PDF_VISUAL_UNREAD", range);
        } else missing("PDF_NO_TEXT", range);
      } catch (e) {
        missing(
          e.message === "PDF_RESOURCE_LIMIT" ? e.message : "PDF_PAGE_FAILED",
          {
            kind: "pdf",
            page: pageNumber,
            ...(e.message === "PDF_RESOURCE_LIMIT"
              ? { pageEnd: document.numPages }
              : {}),
          },
        );
        if (e.message === "PDF_RESOURCE_LIMIT") break;
      } finally {
        page?.cleanup();
      }
      pagination.nextPage = pageNumber + 1;
    }
    if (pagination.nextPage > document.numPages) pagination.nextPage = null;
    else if (pagination.nextPage > last)
      missing("PDF_WINDOW_PENDING", {kind:"pdf",page:pagination.nextPage,pageEnd:document.numPages});
  } catch (e) {
    missing(
      e.name === "PasswordException"
        ? "PDF_ENCRYPTED_UNSUPPORTED"
        : "PDF_INVALID",
      { kind: "pdf" },
    );
  } finally {
    await loading.destroy();
  }
  return window ? pagination : undefined;
}
