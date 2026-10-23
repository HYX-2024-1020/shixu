import { useRef, useState } from "react";
import type { ItemState } from "./types";
import LinkText from "./LinkText";
export default function ItemChat({
  meta,
  send,
}: {
  meta: ItemState;
  send: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  return (
    <section className="item-supplement" aria-label="卡片对话">
      <h3>和 AI 说一声</h3>
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
            await send(text.trim());
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
          maxLength={6000}
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
