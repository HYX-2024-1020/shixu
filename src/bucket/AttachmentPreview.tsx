import { useEffect, useRef, useState } from "react";
import type { Attachment, Packet } from "./types";
import { apiUrl } from "./service";

export default function AttachmentPreview({
  attachment,
  packet,
}: {
  attachment: Attachment;
  packet: Packet;
}) {
  const [blob, setBlob] = useState<Blob>();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdf =
    /\.pdf$/i.test(attachment.name) || attachment.type === "application/pdf";
  const image =
    attachment.type.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp)$/i.test(attachment.name);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data =
          attachment.blob ||
          (packet.remote
            ? await fetch(
                apiUrl("attachments/" + encodeURIComponent(attachment.id)),
                { signal: controller.signal },
              ).then((r) => {
                if (!r.ok) throw new Error("暂时无法读取原件");
                return r.blob();
              })
            : undefined);
        if (!controller.signal.aborted) {
          setBlob(data);
          if (!data) setLoading(false);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [attachment.blob, attachment.id, packet.remote]);
  useEffect(() => {
    if (!blob) return;
    const value = URL.createObjectURL(blob);
    setUrl(value);
    let cancelled = false;
    if (!pdf && !image) {
      (async () => {
        const cached = packet.sources.filter(
          (s) =>
            s.name === attachment.name ||
            s.name.startsWith(attachment.name + " ·") ||
            s.name.startsWith(attachment.name + " /"),
        );
        let content = cached.map((s) => `${s.name}\n${s.text}`).join("\n\n");
        if (
          /\.(txt|md|csv|json|log|tsv|js|jsx|ts|tsx|py|c|cpp|h|java|rs|go|html|css|xml|yaml|yml|sql)$/i.test(
            attachment.name,
          )
        ) {
          const buffer = await blob.slice(0, 512 * 1024).arrayBuffer();
          content = new TextDecoder().decode(buffer);
          if ((content.match(/\ufffd/g) || []).length > 3)
            content = new TextDecoder("gb18030").decode(buffer);
        } else if (!content && /\.docx$/i.test(attachment.name)) {
          const { extractFile } = await import("../files");
          content = await extractFile(new File([blob], attachment.name));
        }
        if (!cancelled) {
          setText(content.slice(0, 60000));
          setLoading(false);
        }
      })().catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    }
    return () => {
      cancelled = true;
      URL.revokeObjectURL(value);
    };
  }, [blob, pdf, image, attachment.name, packet.sources]);
  useEffect(() => {
    if (!pdf || !blob) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    let cancelRender: (() => void) | undefined;
    setLoading(true);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
      dispose = () => {
        void task.destroy();
      };
      if (cancelled) {
        dispose();
        return;
      }
      const doc = await task.promise;
      if (cancelled) return;
      setPages(doc.numPages);
      const sheet = await doc.getPage(page);
      if (cancelled || !canvas.current) return;
      const viewport = sheet.getViewport({
        scale: Math.min(2, 1200 / sheet.getViewport({ scale: 1 }).width),
      });
      const target = canvas.current;
      target.width = viewport.width;
      target.height = viewport.height;
      const render = sheet.render({ canvas: target, viewport });
      cancelRender = () => render.cancel();
      await render.promise;
      if (!cancelled) setLoading(false);
    })().catch((e) => {
      if (!cancelled) {
        setError((e as Error).message);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      cancelRender?.();
      dispose?.();
    };
  }, [blob, pdf, page]);
  return (
    <div
      className={`attachment-preview ${zoom ? "preview-zoomed" : ""}`}
      aria-label={`预览 ${attachment.name}`}
    >
      <header className="preview-toolbar">
        <strong>{attachment.name}</strong>
        {image && (
          <button onClick={() => setZoom((v) => !v)}>
            {zoom ? "适应窗口" : "放大原图"}
          </button>
        )}
      </header>
      {loading && <p role="status">正在打开材料…</p>}
      {image && url && (
        <img
          className="preview-image"
          src={url}
          alt={attachment.name}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError("图片暂时无法显示");
            setLoading(false);
          }}
        />
      )}
      {pdf && (
        <>
          <div className="preview-pages">
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((n) => n - 1)}
            >
              上一页
            </button>
            <span>
              {page} / {pages || "…"}
            </span>
            <button
              disabled={page >= pages || loading}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </button>
          </div>
          <canvas
            ref={canvas}
            aria-label={`PDF 第 ${page} 页`}
            hidden={!!error}
          />
        </>
      )}
      {!image && !pdf && text && (
        <>
          <span className="preview-format">文字预览</span>
          <pre>{text}</pre>
        </>
      )}
      {error && <p>{error}</p>}
      {!loading && !error && !image && !pdf && !text && (
        <p>此格式暂不支持直接预览，可保存原件后打开。</p>
      )}
      {!loading && !blob && !error && <p>原件不在此设备。</p>}
    </div>
  );
}
