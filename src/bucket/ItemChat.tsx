import { useRef, useState } from "react";
import type { ItemState } from "./types";
import LinkText from "./LinkText";
import { errorMessage } from "./error-message";
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
    options?: {
      scope: "item" | "account" | "packet" | "group" | "selected";
      readAttachments: boolean;
      groupId?: string;
      targets?: { packetId: string; itemId: string }[];
    },
  ) => Promise<void>;
  applyProposals?: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  return (
    <section className="item-supplement" aria-label="卡片对话">
      <h3>和 AI 说一声</h3>
      <p className="quiet">
        {window.desktop
          ? "可查找当前账号的卡片并核对必要附件，修改、新建或拆成独立卡。发送会产生费用；跨卡片与新增卡片先预览，确认后保存。"
          : "依据已保存事项和本轮指令处理；发送会产生调用费用。附件实际读取与跨卡片能力请在云端Windows客户端使用。"}
      </p>
      {!!meta.chatCreations && (
        <section className="chat-proposals">
          <h4>
            {meta.chatCreations.mode === "split"
              ? "待确认的拆分"
              : "待确认的新卡片"}
          </h4>
          <p>
            来源：{meta.chatCreations.beforeItem.title}。原件和来源引用保留；
            {meta.chatCreations.mode === "split"
              ? "确认后原卡移入最近删除，可恢复。"
              : "原卡保持原样。"}
          </p>
          {meta.chatCreations.patches.map((patch, index) => (
            <div key={index}>
              <b>{String(patch.title)}</b>
              <p>{String(patch.summary || "")}</p>
              <p>{proposalValue("facts", patch.facts || [])}</p>
              <p>
                截止：
                {patch.due === undefined && !meta.chatCreations!.beforeItem.due
                  ? "无截止时间"
                  : proposalValue(
                      "due",
                      patch.due === undefined
                        ? meta.chatCreations!.beforeItem.due
                        : patch.due,
                    )}
              </p>
              <p>
                状态：
                {proposalValue(
                  "status",
                  patch.status ??
                    meta.chatCreations!.beforeState.status ??
                    "active",
                )}
              </p>
            </div>
          ))}
          {applyProposals && (
            <button
              disabled={busy}
              onClick={async () => {
                if (locked.current) return;
                locked.current = true;
                setBusy(true);
                setError("");
                try {
                  await applyProposals();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  locked.current = false;
                  setBusy(false);
                }
              }}
            >
              确认保存这些卡片
            </button>
          )}
        </section>
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
                  setError(errorMessage(e));
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
            await send(text.trim(), {
              scope: "account",
              readAttachments: !!window.desktop,
            });
            setText("");
          } catch (e) {
            setError(errorMessage(e));
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
