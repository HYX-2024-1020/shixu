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
  groups = [],
  selectedTargets = [],
  expansionTargets = [],
  mergeProposal,
}: {
  meta: ItemState;
  groups?: { id: string; name: string }[];
  selectedTargets?: { packetId: string; itemId: string; title: string }[];
  expansionTargets?: { packetId: string; itemId: string; title: string }[];
  mergeProposal?: () => Promise<void>;
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
  const [scope, setScope] = useState("item");
  const [expansion, setExpansion] = useState("");
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
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="item">当前卡片</option>
              <option value="packet">同次投递</option>
              {groups.map((g) => (
                <option key={g.id} value={"group:" + g.id}>
                  小组：{g.name}
                </option>
              ))}
              <option value="selected" disabled={!selectedTargets.length}>
                选定卡片（{selectedTargets.length}）
              </option>
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
      {!!meta.chatMerge && (
        <section className="chat-proposals">
          <h4>待确认的真正合并：{meta.chatMerge.title}</h4>
          <p>
            合并后显示一张主卡，每个子项的日期、完成状态、原件与来源独立保留；可撤销。
          </p>
          {meta.chatMerge.targets.map((t) => (
            <p key={t.packetId + t.itemId}>{t.title}</p>
          ))}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await mergeProposal?.();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            核对并确认合并
          </button>
        </section>
      )}
      {!!expansion && (
        <section className="chat-proposals">
          <h4>需要扩大处理范围</h4>
          <p>
            当前卡范围不足。以下是同次投递或当前小组内可供核对的目标，尚未发送给AI：
          </p>
          {expansionTargets.map((t) => (
            <p key={t.packetId + t.itemId}>{t.title}</p>
          ))}
          <button
            disabled={busy || expansionTargets.length < 2}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await send(expansion, {
                  scope: "selected",
                  targets: expansionTargets.map(({ packetId, itemId }) => ({
                    packetId,
                    itemId,
                  })),
                  readAttachments,
                });
                setExpansion("");
                setText("");
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            确认以上目标并继续
          </button>
          <button onClick={() => setExpansion("")}>取消</button>
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
          if (
            window.desktop &&
            scope === "item" &&
            /合并|其他卡片|同组|同次投递|全部卡片/.test(text)
          ) {
            setExpansion(text.trim());
            return;
          }
          locked.current = true;
          setBusy(true);
          setError("");
          try {
            const kind = scope.startsWith("group:")
              ? "group"
              : (scope as "item" | "account" | "packet" | "selected");
            await send(text.trim(), {
              scope: kind,
              readAttachments,
              ...(kind === "group" ? { groupId: scope.slice(6) } : {}),
              ...(kind === "selected"
                ? {
                    targets: selectedTargets.map(({ packetId, itemId }) => ({
                      packetId,
                      itemId,
                    })),
                  }
                : {}),
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
