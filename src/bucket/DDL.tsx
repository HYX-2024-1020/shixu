import { itemDeadlineTime } from "../../shared/deadline-time.mjs";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  absoluteItem,
  deadlineSections,
  parseDeadline,
  setDeadline,
  deadlineLabel,
} from "../../shared/deadlines.mjs";
import { localDate } from "../organize";
import type { Packet, ItemState } from "./types";
import DeliverySources from "./DeliverySources";
import { leaveCard, resetCard } from "./motion";
import { useCardMotion } from "./useCardMotion";
import "./ddl.css";

const stops = [1, 3, 7, 14, 30];
export default function DDL({
  packets,
  save,
  notify,
  active: isActive,
}: {
  packets: Packet[];
  active: boolean;
  save: (p: Packet) => Promise<void>;
  notify: (s: string) => void;
}) {
  const [now, setNow] = useState(new Date());
  const [windowIndex, setWindowIndex] = useState(2);
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState("");
  const motionRoot = useCardMotion();
  const [limit, setLimit] = useState(60);
  const lock = useRef(false);
  const latest = useRef(packets);
  latest.current = packets;
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => {
    if (isActive) setNow(new Date());
  }, [isActive]);
  if (!isActive) return null;
  const day = localDate(now);
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const rows = packets.flatMap((p) =>
    (p.result?.items || []).map((raw, index) => {
      const id = p.itemIds?.[index] || `${p.id}:${index}`;
      const meta = p.itemState?.[id] || {};
      const item = absoluteItem(raw, p.captureDate, p.sources, meta.chat);
      const clockInfo = itemDeadlineTime(item, p.sources, meta.chat);
      return {
        clockInfo,
        id,
        index,
        p,
        item,
        meta,
        kind: item.kind,
        date: item.due?.date || "",
        startDate: item.due?.startDate,
        time: clockInfo.time,
        done: meta.status === "done" || p.doneIds.includes(index),
        deleted: p.deletedAt || meta.deletedAt,
      };
    }),
  );
  type Row = (typeof rows)[number];
  const sections = deadlineSections(rows, day, clock, stops[windowIndex]);
  const active =
    sections.overdue.length +
    sections.today.length +
    sections.soon.length +
    sections.later.length +
    sections.unsure.length;
  async function mutate(
    row: Row,
    changes: Partial<ItemState>,
    due?: ReturnType<typeof parseDeadline> | null,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (changes.status === "done") {
        setChecking(row.id);
        await new Promise((resolve) => setTimeout(resolve, 230));
        await leaveCard(row.id, false);
      } else if (changes.status === "active") {
        await leaveCard(row.id, false);
      }
      const p = latest.current.find((p) => p.id === row.p.id);
      if (!p?.result || p.deletedAt) throw new Error("事项已变动，请重新打开");
      const index = p.itemIds?.indexOf(row.id) ?? row.index;
      if (index < 0 || p.itemState?.[row.id]?.deletedAt)
        throw new Error("事项已变动，请重新打开");
      const meta = p.itemState?.[row.id] || {};
      const done = new Set(p.doneIds);
      if (changes.status === "done") done.add(index);
      if (changes.status === "active") done.delete(index);
      const result = { ...p.result, items: [...p.result.items] };
      if (due !== undefined) {
        const previous = result.items[index];
        result.items[index] = setDeadline(previous, due, p.captureDate);
        changes = {
          ...changes,
          corrected: true,
          history: [
            ...(meta.history || []),
            {
              at: new Date().toISOString(),
              field: "due",
              before: JSON.stringify(previous.due),
              after: JSON.stringify(due),
              source: "DDL 人工确认",
            },
          ],
        };
      }
      await save({
        ...p,
        result,
        doneIds: [...done],
        itemState: { ...p.itemState, [row.id]: { ...meta, ...changes } },
        updatedAt: new Date().toISOString(),
      });
      notify(
        due === undefined
          ? changes.status === "done"
            ? "完成一项，痛快。可在已完成里捞回来"
            : "已捞回未完成列表"
          : "截止时间已保存",
      );
    } catch (error) {
      notify((error as Error).message);
    } finally {
      resetCard(row.id);
      setChecking("");
      lock.current = false;
      setBusy(false);
    }
  }
  function card(row: Row) {
    const { item, p, id } = row;
    return (
      <article className="ddl-item" key={id} data-motion-id={id}>
        <button
          className="time-rail"
          aria-label={`核对截止时间：${item.title}`}
          onClick={() => setOpen(open === id ? "" : id)}
        >
          {item.due?.startDate && (
            <>
              <span>时间段 · 开始</span>
              <b>{item.due.startDate}</b>
              <span>{item.due.startTime || "00:00"} → 结束</span>
            </>
          )}
          <span>{row.date || "日期待确认"}</span>
          <b>{row.time || "23:59"}</b>
          <small>核对时间 ↗</small>
        </button>
        <div className="ddl-body">
          <div className="ddl-row">
            <button
              className={
                "completion-orbit" + (checking === id ? " is-checking" : "")
              }
              aria-pressed={row.done}
              disabled={busy}
              aria-label={`${row.done ? "撤销完成" : "标记完成"}：${item.title}`}
              onClick={() =>
                void mutate(row, {
                  status: row.done ? "active" : "done",
                  completedAt: row.done ? "" : new Date().toISOString(),
                })
              }
            >
              {(row.done || checking === id) && <Check size={19} />}
            </button>
            <button
              className="ddl-copy"
              aria-expanded={open === id}
              onClick={() => setOpen(open === id ? "" : id)}
            >
              <h3>{item.title}</h3>
              {(row.meta.group || item.group) && (
                <span className="ddl-course">
                  {row.meta.group || item.group}
                </span>
              )}
              <p>
                <span className="req-tag">交付</span>
                {item.summary || item.facts[0] || "点开查看完整要求"}
              </p>
              <small>
                源自 {p.sources.map((s) => s.name).join("、") || "我的补充"} ·
                原文已保留
              </small>
            </button>
          </div>
          {open === id && (
            <div className="ddl-panel">
              <h4>完整要求 · 时间依据</h4>
              {item.due && (
                <p className="ddl-absolute-time">{deadlineLabel(item.due)}</p>
              )}
              {item.due?.dateInferred && (
                <p className="ddl-date-inference">
                  日期依据：{item.due.dateReason}
                </p>
              )}
              {row.clockInfo.timeInferred && (
                <p className="ddl-time-inference">
                  安排时刻：{row.clockInfo.timeReason}
                </p>
              )}
              {item.facts.map((fact, i) => (
                <p key={i}>{fact}</p>
              ))}
              {item.evidence.map((e, i) => (
                <blockquote key={i}>{e.quote}</blockquote>
              ))}
              {item.uncertainties.map((text, i) => (
                <p key={i}>待确认：{text}</p>
              ))}
              <form
                className="ddl-verify"
                key={`${id}:${row.date}:${row.time}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  try {
                    const text = String(data.get("date") || "");
                    const due = text
                      ? parseDeadline(
                          text,
                          localDate(),
                          String(data.get("time") || ""),
                        )
                      : null;
                    void mutate(row, {}, due);
                  } catch (error) {
                    notify((error as Error).message);
                  }
                }}
              >
                <label>
                  日期或相对日期
                  <input
                    name="date"
                    aria-label="截止日期"
                    defaultValue={
                      item.due?.startDate
                        ? deadlineLabel(item.due).replace(" → ", " 至 ")
                        : row.date
                    }
                    placeholder="26号 / 10月26日 / 26-28 / 明天14:00到16:00"
                  />
                </label>
                <label>
                  时刻（留空按 23:59 安排）
                  <input
                    type="time"
                    name="time"
                    aria-label="截止时刻"
                    defaultValue={item.due?.startDate ? "" : row.time}
                  />
                </label>
                <button disabled={busy}>保存时间</button>
              </form>
              <DeliverySources packet={p} save={save} notify={notify} />
            </div>
          )}
        </div>
      </article>
    );
  }
  const section = (title: string, list: Row[]) =>
    list.length > 0 && (
      <section className="ddl-section">
        <h2>
          <span>{title}</span>
          <small>{list.length} 项</small>
        </h2>
        {list.slice(0, limit).map(card)}
      </section>
    );
  return (
    <section
      ref={motionRoot}
      className="ddl-workspace"
      aria-label="DDL 截止事项"
    >
      <header className="ddl-head">
        <img src={`${import.meta.env.BASE_URL}mascot.png`} alt="" />
        <div>
          <h1>
            最近要交什么，
            <br />
            一眼<span>看清。</span>
          </h1>
          <p>优先采用原文时刻；未写时刻也会安排，点一下可核对、修改。</p>
        </div>
      </header>
      <div className="ddl-stats">
        <span>
          <b>{active}</b> 项待办
        </span>
        <span>
          <b>{sections.today.length}</b> 项今天截止
        </span>
        <span>
          <b>{sections.overdue.length}</b> 项已逾期
        </span>
      </div>
      <div className="ddl-timeline">
        <label htmlFor="ddl-window">
          TIME WINDOW · 看未来 <b>{stops[windowIndex]}</b> 天
        </label>
        <input
          id="ddl-window"
          aria-label="DDL 时间窗"
          type="range"
          min="0"
          max="4"
          value={windowIndex}
          onChange={(e) => setWindowIndex(Number(e.target.value))}
        />
        <div>
          {stops.map((n, i) => (
            <button
              key={n}
              aria-pressed={i === windowIndex}
              onClick={() => setWindowIndex(i)}
            >
              {n} 天
            </button>
          ))}
        </div>
      </div>
      {sections.overdue.length > 0 && (
        <details className="ddl-overdue">
          <summary>已逾期 · {sections.overdue.length} 项 · 点开看看</summary>
          {sections.overdue.slice(0, limit).map(card)}
        </details>
      )}
      {section("今天截止", sections.today)}
      {section(`未来 ${stops[windowIndex]} 天`, sections.soon)}
      {section(`${stops[windowIndex]} 天之后`, sections.later)}
      {!sections.today.length && !sections.soon.length && (
        <p className="ddl-empty">
          {active === 0
            ? sections.done.length
              ? "全都完成了，轻松一下。"
              : "还没有截止事项，把通知丢进桶里，或在下方补充。"
            : "这个时间窗里没有待交事项。"}
        </p>
      )}
      {sections.unsure.length > 0 && (
        <details className="ddl-secondary">
          <summary>日期待确认 · {sections.unsure.length} 项</summary>
          {sections.unsure.slice(0, limit).map(card)}
        </details>
      )}
      {sections.done.length > 0 && (
        <details className="ddl-secondary">
          <summary>已完成 · {sections.done.length} 项 · 可捞回来</summary>
          {sections.done.slice(0, limit).map(card)}
        </details>
      )}
      {Object.values(sections).some((rows) => rows.length > limit) && (
        <button onClick={() => setLimit(limit + 60)}>再看一些 DDL</button>
      )}
      <details className="ddl-secondary">
        <summary>＋ 自己补充一项 DDL</summary>
        <form
          className="ddl-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            const form = e.currentTarget,
              data = new FormData(form),
              title = String(data.get("title") || "").trim();
            if (!title) return;
            try {
              const captureDate = localDate(),
                now = new Date().toISOString();
              let due;
              try {
                due = parseDeadline(
                  String(data.get("date")),
                  captureDate,
                  String(data.get("time") || ""),
                );
              } catch {
                due = null;
              }
              lock.current = true;
              setBusy(true);
              const id = crypto.randomUUID(),
                itemId = crypto.randomUUID(),
                text = `${title}；截止 ${data.get("date")} ${data.get("time") || ""}；${data.get("requirements") || ""}`;
              await save({
                id,
                text,
                sources: [{ id: "manual", name: "我的补充", text }],
                attachments: [],
                capturedAt: now,
                captureDate,
                captureTimezone:
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                status: "ready",
                result: {
                  summary: "手动补充 DDL",
                  warnings: [],
                  items: [
                    absoluteItem(
                      {
                        kind: "task",
                        title,
                        summary: String(data.get("requirements") || ""),
                        facts: [],
                        nextSteps: [],
                        uncertainties: due
                          ? []
                          : [`时间待确认：${data.get("date")}`],
                        evidence: [{ sourceId: "manual", quote: text }],
                        sourceIds: ["manual"],
                        due,
                      },
                      captureDate,
                    ),
                  ],
                },
                itemIds: [itemId],
                itemState: { [itemId]: { origin: "manual", corrected: true } },
                error: "",
                doneIds: [],
                updatedAt: now,
              });
              form.reset();
              notify("DDL 已补充");
            } catch (error) {
              notify((error as Error).message);
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <label>
            事项标题
            <input name="title" required maxLength={150} />
          </label>
          <label>
            截止日期
            <input
              name="date"
              required
              placeholder="26号 / 10月26日 / 26-28 / 明天14:00到16:00"
            />
          </label>
          <label>
            截止时刻（留空自动安排）
            <input name="time" type="time" />
          </label>
          <label>
            交付要求
            <textarea name="requirements" maxLength={2000} />
          </label>
          <button disabled={busy}>添加 DDL</button>
        </form>
      </details>
    </section>
  );
}
