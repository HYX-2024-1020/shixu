import { useRef, useState } from "react";
import type { ItemState } from "./types";
import LinkText from "./LinkText";
function proposalValue(field: string, value: unknown): string {
  if (["starred", "pinned", "dueCleared"].includes(field))
    return value ? "是" : "否";
  if (field === "status")
    return (
      (
        { active: "待处理", progress: "进行中", done: "已完成" } as Record<
          string,
          string
        >
      )[String(value)] || String(value)
    );
  if (field === "kind")
    return (
      (
        {
          task: "任务",
          event: "日程",
          notice: "通知",
          note: "资料",
          habit: "习惯",
          idea: "想法",
          other: "其他",
        } as Record<string, string>
      )[String(value)] || String(value)
    );
  if (field === "due" && value && typeof value === "object") {
    const due = value as Record<string, unknown>;
    return (
      [
        due.date,
        due.time,
        due.endDate && "至",
        due.endDate,
        due.endTime,
        due.inferred && "（含推定，请核对）",
      ]
        .filter(Boolean)
        .join(" ") || "清除截止时间"
    );
  }
  if (Array.isArray(value)) return value.join("；");
  return value == null ? "清除" : String(value);
}
export default function ItemChat({
  meta,
  send,
  applyProposals,
}: {
  meta: ItemState;
  send: (
    text: string,
    options?: { scope: "item" | "account"; readAttachments: boolean },
  ) => Promise<void>;
  applyProposals?: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const [scope, setScope] = useState<"item" | "account">("item");
  const [readAttachments, setReadAttachments] = useState(!!window.desktop);
  return (
    <section className="item-supplement" aria-label="卡片对话">
      <h3>和 AI 说一声</h3>
      <p className="quiet">
        {window.desktop
          ? "可核对本卡片附件，或查询当前账号的其他卡片；发送会产生调用费用。跨卡片修改先列建议，确认后才执行。"
          : "依据已保存事项和本轮指令处理；发送会产生调用费用。附件实际读取与跨卡片能力请在云端Windows客户端使用。"}
      </p>
      {!!window.desktop && (
        <div className="chat-scope-controls">
          <label>
            查询范围
            <select
              aria-label="卡片AI查询范围"
              value={scope}
              onChange={(e) => setScope(e.target.value as "item" | "account")}
            >
              <option value="item">当前卡片</option>
              <option value="account">当前账号的卡片</option>
            </select>
          </label>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={readAttachments}
              onChange={(e) => setReadAttachments(e.target.checked)}
            />
            核对当前卡片附件实际内容
          </label>
        </div>
      )}
      {!!meta.chatProposals?.items.length && (
        <section className="chat-proposals">
          <h4>待确认的跨卡片修改</h4>
          <p>
            以下建议尚未执行。请核对对象和变化，确认后保存；资料有变化时会要求重新核对。
          </p>
          {meta.chatProposals.items.map((item) => (
            <div key={item.packetId + item.itemId}>
              <b>{item.title}</b>
              {Object.entries(item.patch).map(([field, value]) => (
                <p key={field}>
                  {(
                    {
                      title: "标题",
                      summary: "摘要",
                      facts: "关键要求",
                      kind: "类别",
                      group: "分组",
                      status: "完成状态",
                      starred: "星标",
                      pinned: "置顶",
                      importance: "重要程度",
                      due: "截止时间",
                      dueCleared: "清除截止时间",
                    } as Record<string, string>
                  )[field] || field}
                  ：{proposalValue(field, value)}
                </p>
              ))}
            </div>
          ))}
          {applyProposals && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await applyProposals();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认保存这些修改
            </button>
          )}
        </section>
      )}
      {!!meta.additions?.length && (
        <details>
          <summary>之前保存的补充</summary>
          {meta.additions.map((note) => (
            <p key={note.id}>{note.text}</p>
          ))}
        </details>
      )}
      <div className="item-chat-messages" aria-live="polite">
        {meta.chat?.map((message) => (
          <div key={message.id} className={"chat-message chat-" + message.role}>
            <b>{message.role === "user" ? "你" : "拾序"}</b>
            <p>
              <LinkText text={message.text} />
            </p>
          </div>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim() || locked.current) return;
          locked.current = true;
          setBusy(true);
          setError("");
          try {
            await send(text.trim(), { scope, readAttachments });
            setText("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            locked.current = false;
            setBusy(false);
          }
        }}
      >
        <textarea
          aria-label="给 AI 的指令"
          placeholder="比如：这应该是通知，移到通知分区；分到人工智能课程；帮我改短一点…"
          value={text}
          maxLength={4000}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!text.trim() || busy}>
          {busy ? "正在处理…" : error ? "重试" : "发送"}
        </button>
      </form>
    </section>
  );
}
