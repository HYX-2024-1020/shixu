import { useEffect, useState } from "react";
import {
  FileText,
  Download,
  Trash2,
  RotateCcw,
  MoreHorizontal,
  Eye,
} from "lucide-react";
import type { Attachment, Packet } from "./types";
import { apiUrl } from "./service";
import AttachmentPreview from "./AttachmentPreview";
import LinkText from "./LinkText";

function Original({
  attachment: a,
  packet,
  save,
  notify,
  selected,
  onSelect,
}: {
  attachment: Attachment;
  packet: Packet;
  save: (packet: Packet) => Promise<void>;
  notify: (message: string) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!a.blob) return;
    const objectUrl = URL.createObjectURL(a.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [a.blob]);
  const href =
    url ||
    (packet.remote ? apiUrl("attachments/" + encodeURIComponent(a.id)) : "");
  return (
    <div className={`source-file ${a.deletedAt ? "source-deleted" : ""}`}>
      <button
        aria-label={a.name}
        className="source-preview-tab"
        aria-pressed={selected}
        disabled={!!a.deletedAt}
        onClick={onSelect}
      >
        {a.type.startsWith("image/") && url ? (
          <img src={url} alt="" />
        ) : (
          <FileText size={20} />
        )}
        {a.name}
        {!a.deletedAt && (
          <span className="preview-hint">
            <Eye size={16} />
            预览
          </span>
        )}
        {a.deletedAt && <em>已移入最近删除</em>}
      </button>
      <details className="source-options">
        <summary aria-label={"更多材料操作 " + a.name}>
          <MoreHorizontal size={20} />
        </summary>
        <div>
          {!a.deletedAt && (
            <a
              href={href || undefined}
              download={a.name}
              aria-label={`保存 ${a.name}`}
              onClick={(e) => {
                if (!href) {
                  e.preventDefault();
                  notify("原件不在此设备");
                }
              }}
            >
              <Download size={19} />
            </a>
          )}
          <button
            aria-label={
              a.deletedAt ? `恢复附件 ${a.name}` : `删除原件 ${a.name}`
            }
            title={a.deletedAt ? "恢复附件" : "删除原件"}
            onClick={async () => {
              if (
                !a.deletedAt &&
                !confirm("将这次投递中的原件放入最近删除？整理结果保留。")
              )
                return;
              try {
                await save({
                  ...packet,
                  attachments: packet.attachments.map((b) =>
                    b.id === a.id
                      ? {
                          ...b,
                          deletedAt: a.deletedAt
                            ? undefined
                            : new Date().toISOString(),
                          restoredAt: a.deletedAt
                            ? new Date().toISOString()
                            : b.restoredAt,
                        }
                      : b,
                  ),
                });
                notify(a.deletedAt ? "附件已恢复" : "附件已移入最近删除");
              } catch (error) {
                notify((error as Error).message);
              }
            }}
          >
            {a.deletedAt ? <RotateCcw size={18} /> : <Trash2 size={18} />}
          </button>
          {a.deletedAt && (
            <button
              aria-label={"永久删除附件 " + a.name}
              title="永久删除附件"
              onClick={async () => {
                if (
                  !confirm(
                    "永久删除这次投递中的原件？此操作不可恢复，整理结果和其他投递仍保留。",
                  )
                )
                  return;
                try {
                  await save({
                    ...packet,
                    attachments: packet.attachments.filter(
                      (b) => b.id !== a.id,
                    ),
                  });
                  await window.desktop?.store("cleanup");
                  notify("已永久删除这次投递的附件");
                } catch (error) {
                  notify((error as Error).message);
                }
              }}
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

export default function DeliverySources({
  packet,
  save,
  notify,
}: {
  packet: Packet;
  save: (packet: Packet) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const active =
    packet.attachments.find((a) => a.id === selected && !a.deletedAt) ||
    packet.attachments.find((a) => !a.deletedAt);
  return (
    <section className="delivery-sources" aria-label="这次投递的原文与附件">
      <h3>一起放进来的</h3>
      <div className="source-files">
        {packet.attachments.map((a) => (
          <Original
            key={a.id}
            attachment={a}
            packet={packet}
            save={save}
            notify={notify}
            selected={active?.id === a.id}
            onSelect={() => setSelected(a.id)}
          />
        ))}
      </div>
      {active && (
        <AttachmentPreview
          key={active.id}
          attachment={active}
          packet={packet}
        />
      )}
      {packet.text.trim() && (
        <details
          className="delivery-original"
          open={!packet.attachments.length}
        >
          <summary>输入原文</summary>
          <pre>
            <LinkText text={packet.text} />
          </pre>
        </details>
      )}
      {!packet.text.trim() && !packet.attachments.length && (
        <p>这次投递没有保留原件。</p>
      )}
    </section>
  );
}
