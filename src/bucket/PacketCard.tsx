import { useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronDown,
  FileText,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  Sprout,
  Trash2,
} from "lucide-react";
import type { Packet, BucketItem } from "./types";
import ItemDialog from "./ItemDialog";
import AttachmentPreview from "./AttachmentPreview";
import { usageTotals, money, type UsageRecord } from "../../shared/usage.mjs";
import { modelLabel } from "./model-api";
const LABELS = {
  task: "待办",
  idea: "灵感",
  habit: "习惯",
  note: "资料",
  event: "日程",
  notice: "通知",
  other: "其他",
};
const ICONS = {
  task: Check,
  idea: Lightbulb,
  habit: Sprout,
  note: FileText,
  event: FileText,
  notice: FileText,
  other: FileText,
};
export default function PacketCard({
  packet,
  usage,
  itemIndexes,
  progress,
  onRetry,
  onToggle,
  onDelete,
  onRelate,
  notify,
}: {
  packet: Packet;
  usage: UsageRecord[];
  itemIndexes?: number[];
  progress: string;
  onRetry: () => void;
  onToggle: (index: number) => void;
  onDelete: () => void;
  onRelate?: () => void;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [expanded, setExpanded] = useState<number | null>(null);
  const total = usageTotals(usage);
  const [previewId, setPreviewId] = useState("");
  function download(id: string) {
    setPreviewId(id);
  }
  const at = new Date(packet.capturedAt),
    when = at.toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <article
      className={`bucket-packet packet-${packet.status}`}
      data-association-state={packet.association?.state}
    >
      <div className="packet-stamp">
        <span>
          {packet.status === "ready"
            ? "已收好"
            : packet.status === "processing"
              ? "正在整理"
              : packet.status === "error"
                ? "这次还没整理好"
                : "已接住"}
          <i /> {when}
        </span>
        <button
          className="packet-original"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          原文与附件
          <ChevronDown size={13} className={open ? "turned" : ""} />
        </button>
      </div>
      {total.calls > 0 && (
        <p className="packet-cost">
          {[...new Set(usage.map((r) => modelLabel(r.requestedModel)))].join(
            " / ",
          )}{" "}
          · {total.calls} 次调用 ·{" "}
          {total.unpriced === total.calls
            ? "费用待核对"
            : `本次约 ¥${money(total.min)}–${money(total.max)}${total.unpriced ? "，部分待核对" : ""}`}
        </p>
      )}
      {packet.status === "ready" && packet.result ? (
        <>
          <p className="packet-summary">{packet.result.summary}</p>
          <div className="bucket-items">
            {packet.result.items.map((item, index) => {
              if (itemIndexes && !itemIndexes.includes(index)) return null;
              const Icon = ICONS[item.kind],
                done = packet.doneIds.includes(index);
              return (
                <section
                  className={`bucket-item kind-${item.kind} ${done ? "item-done" : ""}`}
                  key={index}
                >
                  <div className="bucket-item-line">
                    {item.kind === "task" ? (
                      <button
                        className={`bucket-check ${done ? "checked" : ""}`}
                        aria-label={`${done ? "取消完成" : "完成"}：${item.title}`}
                        onClick={() => onToggle(index)}
                      >
                        {done ? <Check size={13} /> : null}
                      </button>
                    ) : (
                      <span className="bucket-kind-icon">
                        <Icon size={16} />
                      </span>
                    )}
                    <button
                      className="bucket-item-title"
                      onClick={() =>
                        setExpanded(expanded === index ? null : index)
                      }
                      aria-expanded={expanded === index}
                    >
                      <span className="bucket-kind-label">
                        {LABELS[item.kind]}
                      </span>
                      <strong>{item.title}</strong>
                      {item.due && (
                        <span className="bucket-due">
                          {Number(item.due.date.slice(5, 7))}月
                          {Number(item.due.date.slice(8))}日
                          {item.due.time && ` ${item.due.time}`}
                        </span>
                      )}
                      <ChevronDown
                        size={14}
                        className={expanded === index ? "turned" : ""}
                      />
                    </button>
                  </div>
                  {item.facts.length > 0 && (
                    <ul className="item-facts">
                      {item.facts
                        .slice(0, expanded === index ? 12 : 3)
                        .map((fact, i) => (
                          <li key={i}>{fact}</li>
                        ))}
                    </ul>
                  )}
                  {!item.facts.length && item.summary && (
                    <p className="item-short-summary">{item.summary}</p>
                  )}
                  {["idea", "habit"].includes(item.kind) &&
                    item.nextSteps.length > 0 &&
                    expanded !== index && (
                      <p className="item-first-step">
                        <span>可以试试</span>
                        {item.nextSteps[0]}
                        <small>AI 建议</small>
                      </p>
                    )}
                  {item.sourceIds
                    .filter((id) => packet.attachments.some((a) => a.id === id))
                    .map((id) => (
                      <button
                        className="item-file-pill"
                        key={id}
                        onClick={() => download(id)}
                      >
                        <FileText size={12} />
                        {packet.attachments.find((a) => a.id === id)!.name}
                        <ArrowDown size={11} />
                      </button>
                    ))}
                  {expanded === index && (
                    <ItemDetails
                      item={item}
                      packet={packet}
                      onDownload={download}
                    />
                  )}
                </section>
              );
            })}
          </div>
          {packet.result.items.length === 0 && (
            <p className="packet-note">
              这次没有提取出可靠的独立事项，原内容已保留。
            </p>
          )}
          {packet.result.warnings.length > 0 && (
            <p className="packet-note">{packet.result.warnings.join("；")}</p>
          )}
          {packet.association?.state === "pending" && (
            <p className="packet-note">
              {progress || "正在核对已有事项，整理结果已先保留。"}
            </p>
          )}
          {packet.association?.state === "error" && (
            <div className="association-warning">
              <p>
                这次内容已经收好，跨次关联未完成：
                {packet.association.warnings.join("；")}
              </p>
              {onRelate && (
                <button onClick={onRelate}>
                  <RotateCcw size={13} />
                  仅重试关联
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="packet-waiting">
          {packet.status === "processing" ? (
            <LoaderCircle size={20} className="bucket-spin" />
          ) : (
            <span className="waiting-dot" />
          )}
          <div>
            <h3>
              {packet.status === "processing"
                ? progress || "正在理解这一包内容…"
                : packet.status === "error"
                  ? packet.error
                  : "先替你放好了"}
            </h3>
            <p>
              {packet.status === "pending"
                ? packet.remote
                  ? "已经交给个人服务，完成后会自动出现在这里。"
                  : "连接 DeepSeek 后会自动整理。你可以继续往里丢。"
                : packet.status === "processing"
                  ? "原文和附件已经保存，不用在这里等着。"
                  : "原文和附件都还在，没有保存不完整的结果。"}
            </p>
          </div>
          {packet.status === "error" && (
            <button className="packet-retry" onClick={onRetry}>
              <RotateCcw size={14} />
              重试
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="packet-source">
          <p className="source-caption">当时放进来的内容</p>
          {packet.text && <pre>{packet.text}</pre>}
          {packet.attachments.map((a) => (
            <button
              className="source-file"
              onClick={() => download(a.id)}
              key={a.id}
            >
              <FileText size={15} />
              <span>{a.name}</span>
              <ArrowDown size={14} />
            </button>
          ))}
          {packet.sources
            .filter((s) => s.id !== "input")
            .map((s) => (
              <details className="source-extracted" key={s.id}>
                <summary>提取文字 · {s.name}</summary>
                <pre>{s.text}</pre>
              </details>
            ))}
          <button className="packet-delete" onClick={onDelete}>
            <Trash2 size={13} />
            删除这一包
          </button>
        </div>
      )}
      {previewId && packet.attachments.find((a) => a.id === previewId) && (
        <ItemDialog label="同行材料" onClose={() => setPreviewId("")}>
          <AttachmentPreview
            key={previewId}
            attachment={packet.attachments.find((a) => a.id === previewId)!}
            packet={packet}
          />
        </ItemDialog>
      )}
    </article>
  );
}
function ItemDetails({
  item,
  packet,
  onDownload,
}: {
  item: BucketItem;
  packet: Packet;
  onDownload: (id: string) => void;
}) {
  return (
    <div className="item-details">
      {item.nextSteps.length > 0 && (
        <div className="item-suggestions">
          <h4>
            可以这样开始 <span>AI 建议</span>
          </h4>
          <ul>
            {item.nextSteps.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="item-evidence">
        <h4>原文依据</h4>
        {item.evidence.map((e, i) => (
          <blockquote key={i}>
            <span>
              {packet.sources.find((s) => s.id === e.sourceId)?.name || "原文"}
            </span>
            {e.quote}
          </blockquote>
        ))}
      </div>
      {item.sourceIds
        .filter((id) => packet.attachments.some((a) => a.id === id))
        .map((id) => (
          <button
            className="item-source-link"
            key={id}
            onClick={() => onDownload(id)}
          >
            <FileText size={13} />
            {packet.attachments.find((a) => a.id === id)!.name}
            <ArrowDown size={12} />
          </button>
        ))}
    </div>
  );
}
