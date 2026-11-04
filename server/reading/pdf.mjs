import { getDocument } from "./pdf-api.mjs";
import { WorkerMessageHandler } from "./pdf-core.mjs";
import { validatePdfWindow, PDF_WINDOW_PAGES } from "./pdf-window.mjs";
import { createPdfResources } from "./pdf-resources.mjs";
import { annotationRange, annotationText } from "./pdf-annotations.mjs";

export const PDF_READER_VERSION = "pdf-text/5;pdfjs/6.2.108;resources/1;annotations/1";
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
  const resources = createPdfResources();
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
    cMapPacked: true,
    BinaryDataFactory: resources.BinaryDataFactory,
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
        if (resources.failed) throw Error("PDF_RESOURCE_UNAVAILABLE");
        if (overLimit) {
          missing("PDF_RESOURCE_LIMIT", { kind: "pdf", page: pageNumber, pageEnd: document.numPages });
          break;
        }
        const range = { kind: "pdf", page: pageNumber, rotation: page.rotate };
        if(text.trim()&&!text.endsWith('\n'))units++;
        // Stage the whole page's body and annotation text before publishing
        // any prefix. Metadata never certifies an appearance in text mode.
        const annotations=await page.getAnnotations({intent:'any'}),notes=[];
        if(annotations.length>1000)throw Error('PDF_ANNOTATION_LIMIT');
        if(new Set(annotations.map(a=>a.id)).size!==annotations.length)throw Error('PDF_ANNOTATION_INVALID');
        for(const [index,annotation] of annotations.entries()) {
          const locator={...range,...annotationRange(annotation,index)},content=annotationText(annotation);
          units+=content.text.length;
          if(units>textUnitLimit)break;
          notes.push({range:locator,...content});
        }
        if(units>textUnitLimit) {
          missing('PDF_RESOURCE_LIMIT',{kind:'pdf',page:pageNumber,pageEnd:document.numPages});
          break;
        }
        if (text.trim()) {
          // Commit only a fully extracted page; an error cannot publish its
          // prefix. PDF content order is retained; no geometric table guesses.
          add(text.endsWith("\n") ? text : text + "\n", range, {
            encoding: "pdf-content-order",
            rotation: page.rotate,
          });
        }
        for(const note of notes) {
          if(note.text.trim())add(note.text,note.range,{encoding:'pdf-annotation',rotation:page.rotate});
          missing('PDF_ANNOTATION_UNREAD',note.range);
        }
        if(text.trim()||notes.some(n=>n.text.trim()))missing('PDF_VISUAL_UNREAD',range);
        else missing('PDF_NO_TEXT',range);
      } catch (e) {
        missing(
          ["PDF_RESOURCE_LIMIT","PDF_RESOURCE_UNAVAILABLE","PDF_ANNOTATION_LIMIT","PDF_ANNOTATION_INVALID"].includes(e.message) ? e.message : "PDF_PAGE_FAILED",
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
