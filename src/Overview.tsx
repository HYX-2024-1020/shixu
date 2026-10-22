import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Coffee,
  FileText,
  FolderOpen,
  Inbox,
  Lightbulb,
  Plus,
  Sparkles,
  Sprout,
  Timer,
} from "lucide-react";
import { EntryRow, dateLabel } from "./components";
import { addDays } from "./organize";
import type { Entry, Preferences } from "./types";

type Destination =
  | "today"
  | "inbox"
  | "schedule"
  | "projects"
  | "ideas"
  | "habits";
interface Props {
  today: string;
  entries: Entry[];
  tasks: Entry[];
  inbox: Entry[];
  projects: Entry[];
  ideas: Entry[];
  habits: Entry[];
  doneToday: number;
  preferences: Preferences;
  onCapture: (text: string, organize?: boolean) => void;
  onOpen: (entry: Entry) => void;
  onToggle: (entry: Entry) => void;
  onNavigate: (view: Destination) => void;
  onFocus: () => void;
  onDemo: () => void;
}
export default function Overview(p: Props) {
  const [text, setText] = useState("");
  const [agenda, setAgenda] = useState<"today" | "week">("today");
  const active = p.entries.filter((e) => e.status === "active");
  const future = active
    .filter(
      (e) =>
        e.due > p.today &&
        e.due <= addDays(p.today, 7) &&
        !["idea", "habit"].includes(e.kind),
    )
    .sort((a, b) => a.due.localeCompare(b.due) || a.time.localeCompare(b.time));
  const items = agenda === "today" ? p.tasks : future;
  const date = new Date(`${p.today}T12:00:00`);
  const monday = addDays(p.today, -((date.getDay() + 6) % 7));
  const finished = Math.min(100, (p.doneToday / p.preferences.dailyGoal) * 100);
  const row = (entry: Entry) => (
    <EntryRow
      key={entry.id}
      entry={entry}
      today={p.today}
      onOpen={p.onOpen}
      onToggle={p.onToggle}
    />
  );
  function collect() {
    if (!text.trim()) return;
    p.onCapture(text.trim(), true);
    setText("");
  }
  return (
    <div className="workspace-overview">
      <div className="overview-top">
        <section className="capture-desk welcome-card" aria-label="快速记录">
          <div className="desk-kicker">
            <span className="capture-symbol">
              <Sparkles size={16} />
            </span>
            给大脑，腾一点空间
            <span className="desk-shortcut">QUICK CAPTURE</span>
          </div>
          <textarea
            aria-label="首页快速记录"
            placeholder={
              "有什么想先放下的？\n一段通知、一件待办，或一个还没成形的想法…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={60000}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                collect();
              }
            }}
          />
          <div className="desk-footer">
            <div className="desk-tools">
              <button onClick={() => p.onCapture("")}>
                <FileText size={15} />
                文件提取
              </button>
              <span />
              <button onClick={() => p.onCapture("灵感：")}>
                <Lightbulb size={15} />
                记个灵感
              </button>
            </div>
            <button
              className="button primary"
              onClick={collect}
              disabled={!text.trim()}
            >
              整理一下
              <ArrowRight size={15} />
            </button>
          </div>
          <p className="desk-note">
            按自己的方式写下来，分类和日期稍后确认。<kbd>Ctrl ↵</kbd>
          </p>
        </section>
        <section className="daily-compass">
          <div className="compass-top">
            <span>今天的节奏</span>
            <span className="compass-date">
              {date
                .toLocaleDateString("en-US", { month: "short" })
                .toUpperCase()}{" "}
              {date.getDate()}
            </span>
          </div>
          <div className="compass-body">
            <div
              className="compass-ring"
              style={{
                background: `conic-gradient(var(--accent) ${finished}%, var(--compass-track) 0)`,
              }}
            >
              <div>
                <strong>{String(p.doneToday).padStart(2, "0")}</strong>
                <span>已完成 / {p.preferences.dailyGoal}</span>
              </div>
            </div>
            <div className="compass-copy">
              <span className="tiny-line" />
              <p>
                {p.doneToday
                  ? "一点点完成，\n就是在向前。"
                  : "不必一口气做完，\n先完成一件就好。"}
              </p>
            </div>
          </div>
          <button className="compass-focus" onClick={p.onFocus}>
            <Timer size={16} />
            开启一段专注
            <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      <div className="overview-metrics">
        {[
          {
            label: "今天要做",
            n: p.tasks.length,
            icon: Circle,
            to: "today" as const,
          },
          {
            label: "待整理",
            n: p.inbox.length,
            icon: Inbox,
            to: "inbox" as const,
          },
          {
            label: "进行中的项目",
            n: p.projects.length,
            icon: FolderOpen,
            to: "projects" as const,
          },
          {
            label: "灵感收藏",
            n: p.ideas.length,
            icon: Lightbulb,
            to: "ideas" as const,
          },
        ].map((s, i) => (
          <button
            key={s.label}
            className={`metric-cell metric-${i}`}
            onClick={() => p.onNavigate(s.to)}
          >
            <s.icon size={17} />
            <span>{s.label}</span>
            <strong>{String(s.n).padStart(2, "0")}</strong>
            <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
      <div className="overview-middle">
        <section className="panel agenda-panel">
          <header className="work-panel-head">
            <div>
              <span className="section-index">01</span>
              <h2>留给重要的事</h2>
            </div>
            <button
              className="quiet-link"
              onClick={() => p.onNavigate("today")}
            >
              查看全部
              <ArrowUpRight size={14} />
            </button>
          </header>
          <div className="agenda-toolbar">
            <div className="agenda-tabs">
              <button
                className={agenda === "today" ? "selected" : ""}
                onClick={() => setAgenda("today")}
              >
                今天<span>{p.tasks.length}</span>
              </button>
              <button
                className={agenda === "week" ? "selected" : ""}
                onClick={() => setAgenda("week")}
              >
                未来 7 天<span>{future.length}</span>
              </button>
            </div>
            <span className="agenda-hint">一次，专心一件事</span>
          </div>
          {items.length ? (
            items.slice(0, 4).map(row)
          ) : (
            <div className="agenda-empty">
              <span>
                <Coffee size={25} strokeWidth={1.4} />
              </span>
              <h3>
                {agenda === "today"
                  ? "今天，还有自由安排的空间"
                  : "接下来，还留着一些空白"}
              </h3>
              <p>记下第一件想完成的事，剩下的慢慢来。</p>
              <button
                className="quiet-link"
                onClick={() => p.onCapture(agenda === "today" ? "今天 " : "")}
              >
                记一件小事
                <Plus size={14} />
              </button>
            </div>
          )}
          <button className="add-row" onClick={() => p.onCapture("今天 ")}>
            <Plus size={15} />
            给今天加一件小事<kbd>N</kbd>
          </button>
        </section>
        <section className="panel week-peek">
          <header className="work-panel-head">
            <div>
              <CalendarMini />
              <h2>这一周</h2>
            </div>
            <button
              className="icon-button"
              aria-label="查看完整日程"
              onClick={() => p.onNavigate("schedule")}
            >
              <ArrowUpRight size={17} />
            </button>
          </header>
          <div className="mini-week">
            {Array.from({ length: 7 }, (_, i) => {
              const day = addDays(monday, i),
                count = active.filter((e) => e.due === day).length;
              return (
                <button
                  key={day}
                  className={day === p.today ? "current" : ""}
                  onClick={() => p.onNavigate("schedule")}
                  aria-label={`查看 ${day} 日程`}
                >
                  <span>{"一二三四五六日"[i]}</span>
                  <b>{Number(day.slice(8))}</b>
                  <i className={count ? "has-events" : ""} />
                </button>
              );
            })}
          </div>
          <div className="next-label">
            接下来 <span>UP NEXT</span>
          </div>
          {future.length ? (
            future.slice(0, 2).map((e) => (
              <button
                className="up-next"
                key={e.id}
                onClick={() => p.onOpen(e)}
              >
                <span className="next-dot" />
                <span>
                  <strong>{e.title}</strong>
                  <small>
                    {dateLabel(e.due, p.today)}
                    {e.time ? ` · ${e.time}` : ""}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))
          ) : (
            <div className="next-empty">
              <span>还没有安排未来的事项</span>
              <p>有日期的记录会自动出现在这里。</p>
            </div>
          )}
        </section>
      </div>
      <div className="overview-bottom">
        <section className="panel gather-panel">
          <header className="work-panel-head">
            <div>
              <span className="section-index">02</span>
              <h2>收拾一点小零散</h2>
            </div>
            <button
              className="quiet-link"
              onClick={() => p.onNavigate("inbox")}
            >
              去收集箱
              <ArrowUpRight size={14} />
            </button>
          </header>
          {p.inbox.length ? (
            <>
              <p className="gather-description">
                有 <b>{p.inbox.length}</b> 条记录等你核对，给它们找个位置。
              </p>
              {p.inbox.slice(0, 2).map((e) => (
                <button
                  className="gather-entry"
                  key={e.id}
                  onClick={() => p.onOpen(e)}
                >
                  <span className="gather-icon">
                    <Inbox size={18} />
                  </span>
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {e.due
                        ? `${dateLabel(e.due, p.today)} · 日期待确认`
                        : "确认分类与内容后收纳"}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </>
          ) : (
            <div className="gather-clear">
              <span>
                <CheckCheck size={24} strokeWidth={1.4} />
              </span>
              <div>
                <h3>这里已经清清爽爽</h3>
                <p>新事情来了，先接住，再整理。</p>
              </div>
              <span className="clear-stamp">ALL CLEAR</span>
            </div>
          )}
          {!p.entries.length && (
            <div className="first-visit">
              <BookMini />
              <span>想先看看完整效果？</span>
              <button onClick={p.onDemo}>
                体验示例空间
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </section>
        <section className="inspiration-peek">
          <div className="inspiration-top">
            <Lightbulb size={17} />
            <span>给灵感留个位置</span>
            <span className="paper-pin" />
          </div>
          {p.ideas.length ? (
            <button
              className="inspiration-content"
              onClick={() => p.onOpen(p.ideas[p.ideas.length - 1])}
            >
              <h2>{p.ideas[p.ideas.length - 1].title}</h2>
              <p>{p.ideas[p.ideas.length - 1].content.slice(0, 100)}</p>
              <span>
                让这个念头再长大一点
                <ArrowUpRight size={15} />
              </span>
            </button>
          ) : (
            <button
              className="inspiration-content"
              onClick={() => p.onCapture("灵感：")}
            >
              <h2>
                有些好想法，
                <br />
                从几个字开始。
              </h2>
              <p>不用想完整，先记下来就好。</p>
              <span>
                接住一个新念头
                <ArrowUpRight size={15} />
              </span>
            </button>
          )}
          <span className="paper-lines" />
        </section>
      </div>
      <section className="habit-ribbon">
        <div className="habit-ribbon-title">
          <span>
            <Sprout size={19} />
          </span>
          <div>
            <h2>日常的一点点</h2>
            <p>小事重复，也会有回响。</p>
          </div>
        </div>
        <div className="ribbon-habits">
          {p.habits.length ? (
            p.habits.slice(0, 3).map((e) => (
              <div className="ribbon-habit" key={e.id}>
                <button onClick={() => p.onOpen(e)}>{e.title}</button>
                <button
                  className={`habit-check ${e.checkins.includes(p.today) ? "checked" : ""}`}
                  aria-label={`打卡：${e.title}`}
                  onClick={() => p.onToggle(e)}
                >
                  {e.checkins.includes(p.today) ? (
                    <Check size={16} />
                  ) : (
                    <Plus size={15} />
                  )}
                </button>
              </div>
            ))
          ) : (
            <button
              className="ribbon-create"
              onClick={() => p.onCapture("每天 ")}
            >
              <Plus size={15} />
              种下一个小习惯
            </button>
          )}
        </div>
        <button
          className="icon-button ribbon-arrow"
          aria-label="查看全部习惯"
          onClick={() => p.onNavigate("habits")}
        >
          <ArrowUpRight size={18} />
        </button>
      </section>
    </div>
  );
}
function CalendarMini() {
  return (
    <span className="calendar-mini">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
function BookMini() {
  return (
    <span className="book-mini">
      <FolderOpen size={17} />
    </span>
  );
}
