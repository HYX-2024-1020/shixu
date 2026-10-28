import { getDocument } from "./pdf-api.mjs";
import { WorkerMessageHandler } from "./pdf-core.mjs";

export const PDF_READER_VERSION = "pdf-text/1;pdfjs/6.2.108";
// A resource ceiling, not a document/page limit. Unvisited pages are reported.
export const PDF_TEXT_UNITS = 8 * 1024 * 1024;

// Production invokes this ONLY inside the broker's restricted process. The
// API/worker pair runs in that same process; it has no canvas/native modules,
// host fonts, URL loader, credentials, scripting manager or rendering calls.
export async function readPdf(bytes, { add, missing }) {
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
  try {
    document = await loading.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      // No fixed total page cap. Expanded text and the broker's total memory,
      // output and execution ceilings remain independent safety boundaries.
      if (units >= PDF_TEXT_UNITS) {
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
        let text = "";
        try {
          for (;;) {
            const { value, done } = await stream.read();
            if (done) break;
            for (const item of value.items) {
              if (typeof item.str !== "string") continue;
              const part =
                item.str.replace(/\r\n?/g, "\n") + (item.hasEOL ? "\n" : "");
              units += part.length;
              if (units > PDF_TEXT_UNITS) throw Error("PDF_RESOURCE_LIMIT");
              text += part;
            }
          }
        } finally {
          await stream.cancel().catch(() => {});
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
    }
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
}
