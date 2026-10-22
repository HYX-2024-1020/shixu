import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Coffee,
  Command,
  Feather,
  Flag,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Leaf,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sprout,
  Target,
  Timer,
  X,
} from "lucide-react";
import {
  Badge,
  Empty,
  EntryRow,
  LinkArrow,
  Modal,
  SectionHeading,
  dateLabel,
} from "./components";
import { addDays, localDate } from "./organize";
import { demoEntries } from "./demo";
import Overview from "./Overview";
import { useWorkspace } from "./useWorkspace";
import { type Entry, type Kind, type Snapshot } from "./types";
const Capture = lazy(() => import("./Capture"));
const Editor = lazy(() => import("./Editor"));
const Settings = lazy(() => import("./Settings"));

type View =
  | "overview"
  | "inbox"
  | "today"
  | "schedule"
  | "all"
  | "projects"
  | "ideas"
  | "habits"
  | "archive";
const NAV = [
  { id: "overview", label: "生活概览", icon: LayoutDashboard },
  { id: "inbox", label: "收集箱", icon: Inbox },
  { id: "today", label: "今天", icon: Target },
  { id: "schedule", label: "日程", icon: CalendarDays },
  { id: "all", label: "全部事项", icon: ListTodo },
  { id: "projects", label: "我的项目", icon: FolderOpen },
  { id: "ideas", label: "灵感花园", icon: Lightbulb },
  { id: "habits", label: "日常习惯", icon: Sprout },
  { id: "archive", label: "已归档", icon: Archive },
] as const;
const TITLES: Record<View, [string, string]> = {
  overview: ["生活概览", "给零散的日常，一个安放的位置。"],
  inbox: ["收集箱", "先接住，再慢慢整理。不必一开始就想清楚。"],
  today: ["今天，慢慢来", "把注意力留给眼前。完成一件，也是一点进展。"],
  schedule: ["日程", "把重要的日子，放进看得见的时间里。"],
  all: ["全部事项", "学习、生活与小小的期待，都在这里。"],
  projects: ["我的项目", "从一个想法，到一步步实现。"],
  ideas: ["灵感花园", "让那些一闪而过的念头，有机会慢慢生长。"],
  habits: ["日常习惯", "不必追赶，只要比昨天多一点点。"],
  archive: ["已归档", "做过的事、走过的路，也值得被好好收藏。"],
};
function sortEntries(a: Entry, b: Entry) {
  return (
    (a.due || "9999").localeCompare(b.due || "9999") ||
    { high: 0, normal: 1, low: 2 }[a.priority] -
      { high: 0, normal: 1, low: 2 }[b.priority] ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

export default function App() {
  const [toast, setToast] = useState("");
  const [autoCapture, setAutoCapture] = useState(false);
  const toastTimer = useRef<number>(0);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 6500);
  }, []);
  const workspace = useWorkspace(notify);
  const {
    entries,
    preferences,
    ready,
    account,
    syncState,
    syncError,
    lastSynced,
  } = workspace;
  const [view, setView] = useState<View>("overview"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [capture, setCapture] = useState<string | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [settings, setSettings] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [aiKey, setAiKey] = useState("");
  const [today, setToday] = useState(localDate()),
    [selectedDay, setSelectedDay] = useState(localDate()),
    [weekOffset, setWeekOffset] = useState(0),
    [projectFilter, setProjectFilter] = useState(""),
    [archiveTab, setArchiveTab] = useState("done");
  const [focusOpen, setFocusOpen] = useState(false),
    [focusEnd, setFocusEnd] = useState<number | null>(null),
    [focusLeft, setFocusLeft] = useState(25 * 60);
  const searchInput = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => entries.filter((e) => !e.deletedAt), [entries]);
  const active = useMemo(
    () => visible.filter((e) => e.status === "active"),
    [visible],
  );
  const inbox = visible.filter((e) => e.status === "inbox");
  const todayTasks = active
    .filter(
      (e) => e.kind !== "habit" && e.kind !== "idea" && e.due && e.due <= today,
    )
    .sort(sortEntries);
  const doneToday = visible.filter(
    (e) =>
      e.status === "done" &&
      e.completedAt &&
      localDate(new Date(e.completedAt)) === today,
  ).length;
  const habits = active.filter((e) => e.kind === "habit");
  const ideas = active.filter((e) => e.kind === "idea");
  const projectNames = [
    ...new Set(
      [
        ...active.filter((e) => e.kind === "project").map((e) => e.title),
        ...active.map((e) => e.project),
      ].filter(Boolean),
    ),
  ];
  const projects = active.filter((e) => e.kind === "project");
  const upcoming = active
    .filter((e) => e.due > today && e.kind !== "habit" && e.kind !== "idea")
    .sort(sortEntries);
  const [bootError, setBootError] = useState(false);
  useEffect(() => {
    setAiKey("");
    setCapture(null);
    setEditing(null);
  }, [account?.session.user.id]);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setBootError(true), 10000);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => {
    const tick = setInterval(() => setToday(localDate()), 30000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
      const target = e.target as HTMLElement;
      if (
        e.key.toLowerCase() === "n" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setCapture("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shared = ["title", "text", "url"]
      .map((k) => params.get(k))
      .filter(Boolean)
      .join("\n");
    if (shared) {
      setCapture(shared.slice(0, 60000));
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  useEffect(() => {
    if (!focusEnd) return;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((focusEnd - Date.now()) / 1000));
      setFocusLeft(left);
      if (left === 0) {
        setFocusEnd(null);
        notify("这一段专注完成了。起身走走，给自己一点休息。");
      }
    }, 500);
    return () => clearInterval(interval);
  }, [focusEnd, notify]);
  function navigate(next: View) {
    setView(next);
    setSidebar(false);
    setFilter("all");
    setProjectFilter("");
    setSearch("");
  }
  async function safely(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败");
    }
  }
  async function toggle(entry: Entry) {
    const at = new Date().toISOString();
    if (entry.kind === "habit") {
      const checked = entry.checkins.includes(today);
      await workspace.save([
        {
          ...entry,
          checkins: checked
            ? entry.checkins.filter((d) => d !== today)
            : [...entry.checkins, today],
          updatedAt: at,
        },
      ]);
      if (!checked) notify("今天也给自己积攒了一点点进步");
    } else {
      const done = entry.status === "done";
      await workspace.save([
        {
          ...entry,
          status: done ? "active" : "done",
          completedAt: done ? undefined : at,
          updatedAt: at,
        },
      ]);
      if (!done) notify("又完成了一件事，做得不错");
    }
  }
  async function loadDemo() {
    await workspace.save(demoEntries());
    notify("已加入虚构示例，随时可以编辑或移到回收站");
  }
  async function importSnapshot(snapshot: Snapshot) {
    const map = new Map(entries.map((e) => [e.id, e]));
    const updates = snapshot.entries.filter(
      (e) => !map.has(e.id) || e.updatedAt > map.get(e.id)!.updatedAt,
    );
    await workspace.save(updates);
  }
  const progress = Math.min(
    100,
    Math.round((doneToday / preferences.dailyGoal) * 100),
  );
  const weekStart = addDays(
    today,
    (-(new Date(`${today}T12:00:00`).getDay() + 6) % 7) + weekOffset * 7,
  );
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const query = search.toLocaleLowerCase().trim();
  const searchResults = visible
    .filter((e) =>
      `${e.title} ${e.content} ${e.tags.join(" ")} ${e.project}`
        .toLocaleLowerCase()
        .includes(query),
    )
    .sort(sortEntries);
  const filtered = (list: Entry[]) =>
    list.filter(
      (e) =>
        filter === "all" ||
        (filter === "high"
          ? e.priority === "high"
          : filter === "undated"
            ? !e.due
            : e.kind === filter),
    );
  const row = (entry: Entry) => (
    <EntryRow
      entry={entry}
      key={entry.id}
      today={today}
      onOpen={setEditing}
      onToggle={(e) => void safely(() => toggle(e))}
    />
  );

  if (!ready)
    return (
      <div className="loading-page">
        <div className="brand-mark">
          <Leaf size={28} />
        </div>
        <h1>拾序</h1>
        <p>
          {bootError
            ? "本机存储暂时无法打开，请检查浏览器的网站数据权限后刷新。"
            : "给生活，理一点头绪…"}
        </p>
        {!bootError && <LoaderCircle size={20} className="spin" />}
        {toast && <p className="error-text">{toast}</p>}
      </div>
    );
  return (
    <div className="app-shell">
      {sidebar && (
        <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <Leaf size={24} />
          </span>
          <span>
            拾序<small>SHIXU</small>
          </span>
        </a>
        <button
          className="mobile-close icon-button"
          aria-label="关闭导航"
          onClick={() => setSidebar(false)}
        >
          <X size={20} />
        </button>
        <button className="new-entry" onClick={() => setCapture("")}>
          <Plus size={18} />
          <span>随手记一笔</span>
          <kbd>N</kbd>
        </button>
        <nav aria-label="主导航">
          <span className="nav-label">我的空间</span>
          {NAV.map(({ id, label, icon: Icon }, i) => (
            <div key={id}>
              {i === 5 && <span className="nav-label second">慢慢积累</span>}
              <button
                className={`nav-item ${view === id && !query ? "active" : ""}`}
                aria-current={view === id && !query ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {id === "inbox" && inbox.length > 0 && <b>{inbox.length}</b>}
                {id === "today" && todayTasks.length > 0 && (
                  <small>{todayTasks.length}</small>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-note">
            <Sprout size={20} />
            <p>
              事情再多，
              <br />
              也可以一件一件来。
            </p>
            <span>一点点，也很好。</span>
          </div>
          <button className="nav-item" onClick={() => setSettings(true)}>
            <SettingsIcon size={18} />
            <span>设置与数据</span>
          </button>
          <button className="profile" onClick={() => setSettings(true)}>
            <span className="avatar">
              {preferences.name.slice(0, 1) || "你"}
            </span>
            <span>
              <strong>{preferences.name || "同学"}的生活空间</strong>
              <small>
                {account ? (
                  <>
                    <Cloud size={11} />
                    已连接云同步
                  </>
                ) : (
                  <>
                    <ShieldCheck size={11} />
                    本机私密空间
                  </>
                )}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-toggle"
              aria-label="展开导航"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <span>我的空间</span>
            <ChevronRight size={13} />
            <strong>{query ? "搜索结果" : TITLES[view][0]}</strong>
          </div>
          <div className="topbar-right">
            <div className="search-box">
              <Search size={16} />
              <input
                ref={searchInput}
                aria-label="搜索全部事项"
                placeholder="搜索事项、灵感…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button
                  className="icon-button"
                  aria-label="清除搜索"
                  onClick={() => setSearch("")}
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd>Ctrl K</kbd>
              )}
            </div>
            <button
              className={`sync-indicator ${syncError ? "error" : ""}`}
              title={
                syncError ||
                `${syncState}${lastSynced ? ` · ${lastSynced}` : ""}`
              }
              onClick={() =>
                account ? void workspace.sync() : setSettings(true)
              }
            >
              {syncState === "正在同步" ? (
                <LoaderCircle size={14} className="spin" />
              ) : account ? (
                <Cloud size={14} />
              ) : (
                <ShieldCheck size={14} />
              )}
              <span>{account ? syncState : "本机保存"}</span>
            </button>
          </div>
        </header>
        <main className="main-content">
          {workspace.preview && (
            <div className="design-preview-banner">
              <span>
                <Sparkles size={14} />
                设计预览 · 示例数据，可自由体验
              </span>
              <a href={location.pathname}>
                返回我的空间
                <ArrowUpRight size={13} />
              </a>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {new Date(`${today}T12:00:00`).toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
                <span />
                你的日常工作台
              </div>
              <h1>
                {query
                  ? `寻找「${search}」`
                  : view === "overview"
                    ? `你好，${preferences.name || "同学"}。`
                    : TITLES[view][0]}
              </h1>
              <p>
                {query
                  ? `找到 ${searchResults.length} 条相关内容`
                  : view === "overview"
                    ? "把脑海里的事放下来，让今天轻一点。"
                    : TITLES[view][1]}
              </p>
            </div>
            <button
              className="button secondary page-add"
              onClick={() => setCapture("")}
            >
              <Plus size={16} />
              新建记录
            </button>
          </div>
          {syncError && (
            <div className="sync-warning">
              <Cloud size={16} />
              <span>{syncError}。内容已保存在本机。</span>
              <button onClick={() => setSettings(true)}>查看设置</button>
            </div>
          )}
          {query ? (
            <section className="panel list-panel">
              <SectionHeading title="搜索结果" count={searchResults.length} />
              {searchResults.length ? (
                searchResults.map(row)
              ) : (
                <Empty icon={<Search size={28} />} title="还没找到这条记录">
                  换一个词试试，标题、原文、标签和项目都可以搜。
                </Empty>
              )}
            </section>
          ) : (
            <>
              {view === "overview" && (
                <Overview
                  today={today}
                  entries={visible}
                  tasks={todayTasks}
                  inbox={inbox}
                  projects={projects}
                  ideas={ideas}
                  habits={habits}
                  doneToday={doneToday}
                  preferences={preferences}
                  onCapture={(text, organize = false) => {
                    setAutoCapture(organize);
                    setCapture(text);
                  }}
                  onOpen={setEditing}
                  onToggle={(entry) => void safely(() => toggle(entry))}
                  onNavigate={navigate}
                  onFocus={() => setFocusOpen(true)}
                  onDemo={() => void safely(loadDemo)}
                />
              )}
              {view === "today" && (
                <>
                  <div className="today-summary">
                    <div>
                      <span className="stat-icon green">
                        <Target size={22} />
                      </span>
                      <div>
                        <h2>
                          {todayTasks.length
                            ? `今天有 ${todayTasks.length} 件事，等你慢慢完成`
                            : "今天的日程很轻盈"}
                        </h2>
                        <p>
                          已完成 {doneToday} 件 · 每日参考目标{" "}
                          {preferences.dailyGoal} 件
                        </p>
                      </div>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setFocusOpen(true)}
                    >
                      <Timer size={16} />
                      开始专注
                    </button>
                  </div>
                  <section className="panel list-panel">
                    <SectionHeading title="待完成" count={todayTasks.length} />
                    {todayTasks.length ? (
                      todayTasks.map(row)
                    ) : (
                      <Empty
                        icon={<Coffee size={30} />}
                        title="给自己留一点空白"
                      >
                        所有到期与逾期的事项都会在这里显示。
                      </Empty>
                    )}
                  </section>
                  <section className="panel list-panel">
                    <SectionHeading title="今天完成的事" count={doneToday} />
                    {visible
                      .filter(
                        (e) =>
                          e.status === "done" &&
                          e.completedAt &&
                          localDate(new Date(e.completedAt)) === today,
                      )
                      .map(row)}
                  </section>
                </>
              )}
              {view === "inbox" && (
                <section className="panel list-panel">
                  <SectionHeading
                    title="待确认的记录"
                    count={inbox.length}
                    action={
                      <button
                        className="button soft"
                        onClick={() => setCapture("")}
                      >
                        <Plus size={14} />
                        收集一条
                      </button>
                    }
                  />
                  <p className="section-note">
                    打开记录，核对类别、日期与内容后确认收纳。模糊的日期不会自动当作截止日期。
                  </p>
                  {inbox.length ? (
                    inbox.map((e) => (
                      <div className="inbox-card" key={e.id}>
                        <div className="inbox-card-top">
                          <Badge kind={e.kind} />
                          <span>
                            {new Date(e.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                        <button onClick={() => setEditing(e)}>
                          <h3>{e.title}</h3>
                          <p>{e.content.slice(0, 200)}</p>
                        </button>
                        <div className="inbox-card-footer">
                          <span>
                            {e.due
                              ? `${e.due} · 日期待确认`
                              : e.dateHint || "未提取到明确日期"}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => setEditing(e)}
                          >
                            核对并收纳
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty icon={<Inbox size={32} />} title="都整理好啦">
                      你可以放心去做眼前的事了。
                    </Empty>
                  )}
                </section>
              )}
              {view === "schedule" && (
                <>
                  <section className="panel calendar-panel">
                    <div className="calendar-toolbar">
                      <h2>
                        {new Date(`${weekStart}T12:00:00`).toLocaleDateString(
                          "zh-CN",
                          { year: "numeric", month: "long" },
                        )}
                      </h2>
                      <div className="inline-actions">
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setWeekOffset(0);
                            setSelectedDay(today);
                          }}
                        >
                          本周
                        </button>
                        <button
                          className="icon-button"
                          aria-label="上一周"
                          onClick={() => setWeekOffset(weekOffset - 1)}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="下一周"
                          onClick={() => setWeekOffset(weekOffset + 1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="week-grid">
                      {weekDays.map((day, i) => (
                        <button
                          className={`day-cell ${day === selectedDay ? "selected" : ""} ${day === today ? "is-today" : ""}`}
                          key={day}
                          onClick={() => setSelectedDay(day)}
                        >
                          <span>周{"一二三四五六日"[i]}</span>
                          <strong>{Number(day.slice(8))}</strong>
                          <div>
                            {active.some((e) => e.due === day) ? <i /> : <b />}
                          </div>
                          <small>
                            {active.filter((e) => e.due === day).length || "—"}{" "}
                            件
                          </small>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel list-panel">
                    <SectionHeading
                      title={`${selectedDay} · ${dateLabel(selectedDay, today)}`}
                      count={active.filter((e) => e.due === selectedDay).length}
                    />
                    {active
                      .filter((e) => e.due === selectedDay)
                      .sort(sortEntries)
                      .map(row)}
                    {!active.some((e) => e.due === selectedDay) && (
                      <Empty
                        icon={<CalendarDays size={28} />}
                        title="这一天，还留着空白"
                      >
                        有明确日期的事项会自动出现在日程里。
                      </Empty>
                    )}
                    <button
                      className="add-row"
                      onClick={() => setCapture(`${selectedDay} `)}
                    >
                      <Plus size={15} />
                      为这一天加件事
                    </button>
                  </section>
                  <section className="panel list-panel">
                    <SectionHeading title="接下来" count={upcoming.length} />
                    {upcoming.slice(0, 8).map(row)}
                  </section>
                </>
              )}
              {view === "all" && (
                <section className="panel list-panel">
                  <SectionHeading title="进行中的事项" count={active.length} />
                  <div className="filter-tabs">
                    {[
                      ["all", "全部"],
                      ["task", "待办"],
                      ["notice", "通知"],
                      ["project", "项目"],
                      ["idea", "灵感"],
                      ["habit", "习惯"],
                      ["high", "重要"],
                      ["undated", "未安排日期"],
                    ].map(([id, label]) => (
                      <button
                        className={filter === id ? "selected" : ""}
                        key={id}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {filtered(active).length ? (
                    filtered(active).sort(sortEntries).map(row)
                  ) : (
                    <Empty
                      icon={<ListTodo size={30} />}
                      title="这里暂时还没有事项"
                    >
                      新收纳的内容会出现在对应类别。
                    </Empty>
                  )}
                </section>
              )}
              {view === "projects" && (
                <>
                  <div className="project-grid">
                    {projectNames.map((name, i) => {
                      const linked = visible.filter(
                        (e) => e.project === name && e.status !== "archived",
                      );
                      const complete = linked.filter(
                        (e) => e.status === "done",
                      ).length;
                      const project = visible.find(
                        (e) => e.kind === "project" && e.title === name,
                      );
                      return (
                        <button
                          className={`project-card ${projectFilter === name ? "selected" : ""}`}
                          key={name}
                          onClick={() =>
                            setProjectFilter(projectFilter === name ? "" : name)
                          }
                        >
                          <span className={`project-icon color-${i % 3}`}>
                            <FolderOpen size={23} />
                          </span>
                          <ArrowUpRight className="project-arrow" size={18} />
                          <h2>{name}</h2>
                          <p>
                            {project?.content.slice(0, 75) ||
                              "把相关的小任务，串成一个有方向的项目。"}
                          </p>
                          <div className="project-track">
                            <span
                              style={{
                                width: `${linked.length ? (complete / linked.length) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <div className="project-count">
                            <span>
                              {complete} / {linked.length} 项完成
                            </span>
                            <span>
                              {project?.due
                                ? dateLabel(project.due, today)
                                : "慢慢推进"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    <button
                      className="new-project-card"
                      onClick={() => setCapture("项目：")}
                    >
                      <Plus size={25} />
                      <h3>开启一个新项目</h3>
                      <p>给想做的事，一个开始。</p>
                    </button>
                  </div>
                  {projectFilter && (
                    <section className="panel list-panel">
                      <SectionHeading
                        title={projectFilter}
                        action={
                          <button
                            className="text-button"
                            onClick={() => {
                              const project = visible.find(
                                (e) =>
                                  e.kind === "project" &&
                                  e.title === projectFilter,
                              );
                              if (project) setEditing(project);
                              else setCapture(`项目：${projectFilter}`);
                            }}
                          >
                            编辑项目
                            <ArrowRight size={14} />
                          </button>
                        }
                      />
                      {visible
                        .filter(
                          (e) =>
                            e.project === projectFilter &&
                            e.status !== "archived",
                        )
                        .sort(sortEntries)
                        .map(row)}
                      <button
                        className="add-row"
                        onClick={() => setCapture(`项目：${projectFilter} `)}
                      >
                        <Plus size={15} />
                        给项目加一个下一步
                      </button>
                    </section>
                  )}
                </>
              )}
              {view === "ideas" && (
                <div className="ideas-grid">
                  {ideas.map((e, i) => (
                    <button
                      className={`idea-card shade-${i % 3}`}
                      key={e.id}
                      onClick={() => setEditing(e)}
                    >
                      <div>
                        <Lightbulb size={19} />
                        <span>
                          {new Date(e.createdAt).toLocaleDateString("zh-CN", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      <h2>{e.title}</h2>
                      <p>{e.content.slice(0, 180)}</p>
                      <footer>
                        <span>
                          {e.tags.map((t) => "#" + t).join(" ") ||
                            "一颗待发芽的种子"}
                        </span>
                        <ArrowUpRight size={18} />
                      </footer>
                    </button>
                  ))}
                  <button
                    className="new-idea-card"
                    onClick={() => setCapture("灵感：")}
                  >
                    <Feather size={33} strokeWidth={1} />
                    <h3>接住下一个灵感</h3>
                    <p>几个字，也可以长成好想法。</p>
                    <span>
                      <Plus size={15} />
                      记一个点子
                    </span>
                  </button>
                </div>
              )}
              {view === "habits" && (
                <>
                  <div className="habit-intro">
                    <Sprout size={25} />
                    <p>坚持不需要完美。漏掉一天，也可以从今天重新开始。</p>
                  </div>
                  <div className="habit-grid">
                    {habits.map((e) => (
                      <section className="panel habit-card" key={e.id}>
                        <div className="habit-card-heading">
                          <span className="habit-icon">
                            <Sprout size={24} />
                          </span>
                          <button onClick={() => setEditing(e)}>
                            <h2>{e.title}</h2>
                            <p>{e.checkins.length} 天的积累</p>
                          </button>
                        </div>
                        <p className="habit-description">
                          {e.content.slice(0, 100)}
                        </p>
                        <div className="habit-week">
                          {Array.from({ length: 7 }, (_, i) =>
                            addDays(today, i - 6),
                          ).map((day) => (
                            <div key={day}>
                              <span>
                                {day === today
                                  ? "今天"
                                  : "周" +
                                    "日一二三四五六"[
                                      new Date(`${day}T12:00:00`).getDay()
                                    ]}
                              </span>
                              <i
                                className={
                                  e.checkins.includes(day) ? "checked" : ""
                                }
                              >
                                {e.checkins.includes(day) ? (
                                  <Check size={16} />
                                ) : (
                                  Number(day.slice(8))
                                )}
                              </i>
                            </div>
                          ))}
                        </div>
                        <button
                          className={`button ${e.checkins.includes(today) ? "soft" : "primary"}`}
                          onClick={() => void safely(() => toggle(e))}
                        >
                          {e.checkins.includes(today) ? (
                            <Check size={16} />
                          ) : (
                            <Plus size={16} />
                          )}
                          {e.checkins.includes(today)
                            ? "今天已打卡 · 点击撤销"
                            : "完成今天的一点点"}
                        </button>
                      </section>
                    ))}
                    <button
                      className="new-project-card"
                      onClick={() => setCapture("每天 ")}
                    >
                      <Sprout size={28} />
                      <h3>养成一个小习惯</h3>
                      <p>从小到不费力的事情开始。</p>
                    </button>
                  </div>
                </>
              )}
              {view === "archive" && (
                <section className="panel list-panel">
                  <div className="filter-tabs">
                    {[
                      ["done", "已完成"],
                      ["archived", "已归档"],
                      ["trash", "回收站"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={archiveTab === id ? "selected" : ""}
                        onClick={() => setArchiveTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {archiveTab === "trash"
                    ? entries
                        .filter((e) => e.deletedAt)
                        .map((e) => (
                          <div className="trash-row" key={e.id}>
                            <span>{e.title}</span>
                            <button
                              className="text-button"
                              onClick={() =>
                                void safely(async () => {
                                  await workspace.save([
                                    {
                                      ...e,
                                      deletedAt: undefined,
                                      updatedAt: new Date().toISOString(),
                                    },
                                  ]);
                                  notify("已恢复事项");
                                })
                              }
                            >
                              恢复
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        ))
                    : visible
                        .filter((e) => e.status === archiveTab)
                        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                        .map(row)}
                  {!(
                    archiveTab === "trash"
                      ? entries.filter((e) => e.deletedAt)
                      : visible.filter((e) => e.status === archiveTab)
                  ).length && (
                    <Empty
                      icon={<Archive size={30} />}
                      title="这一页暂时很安静"
                    >
                      属于这里的记录，会被好好保存。
                    </Empty>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Leaf size={12} />
              拾起日常，理出自己的节奏。
            </span>
            <span>
              数据{account ? "本机保存并云端同步" : "保存在此浏览器"}
              <span className="footer-dot">·</span>
              <button onClick={() => setSettings(true)}>
                管理数据
                <ArrowUpRight size={12} />
              </button>
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-dock" aria-label="手机快捷导航">
        <button
          className={view === "overview" ? "active" : ""}
          onClick={() => navigate("overview")}
        >
          <LayoutDashboard size={20} />
          <span>总览</span>
        </button>
        <button
          className={view === "today" ? "active" : ""}
          onClick={() => navigate("today")}
        >
          <Target size={20} />
          <span>今日</span>
        </button>
        <button
          className="mobile-capture"
          aria-label="随手记一笔"
          onClick={() => setCapture("")}
        >
          <Plus size={25} />
        </button>
        <button
          className={view === "ideas" ? "active" : ""}
          onClick={() => navigate("ideas")}
        >
          <Lightbulb size={20} />
          <span>灵感</span>
        </button>
        <button onClick={() => setSidebar(true)}>
          <Menu size={20} />
          <span>更多</span>
        </button>
      </nav>
      <Suspense
        fallback={
          <div className="modal-loading" role="status">
            <LoaderCircle size={22} className="spin" />
            正在打开…
          </div>
        }
      >
        {capture !== null && (
          <Capture
            draftKey={`shixu-draft-${workspace.preview ? "preview-design-v2" : account?.session.user.id || "local"}`}
            initialText={capture}
            autoOrganize={autoCapture}
            preferences={preferences}
            aiKey={aiKey}
            projects={projectNames}
            onClose={() => {
              setCapture(null);
              setAutoCapture(false);
            }}
            onSave={workspace.save}
            notify={notify}
            openSettings={() => setSettings(true)}
          />
        )}
        {editing && (
          <Editor
            entry={editing}
            projects={projectNames}
            preferences={preferences}
            aiKey={aiKey}
            onClose={() => setEditing(null)}
            onSave={async (e) => {
              const linked =
                editing.kind === "project" && e.title !== editing.title
                  ? entries
                      .filter((item) => item.project === editing.title)
                      .map((item) => ({
                        ...item,
                        project: e.title,
                        updatedAt: e.updatedAt,
                      }))
                  : [];
              await workspace.save([e, ...linked]);
            }}
            notify={notify}
          />
        )}
        {settings && (
          <Settings
            preview={workspace.preview}
            preferences={preferences}
            entries={entries}
            aiKey={aiKey}
            onKey={setAiKey}
            account={account}
            onConnect={workspace.connect}
            onDisconnect={workspace.disconnect}
            onSave={workspace.savePrefs}
            onImport={importSnapshot}
            onClose={() => setSettings(false)}
            notify={notify}
            sync={workspace.sync}
            syncState={syncState}
            syncError={syncError}
          />
        )}
      </Suspense>
      {focusOpen && (
        <Modal
          title="给自己一小段专注"
          subtitle="把眼前的事做好，就已经很不错了。"
          onClose={() => setFocusOpen(false)}
        >
          <div className="focus-body">
            <span className="focus-leaf">
              <Leaf size={32} />
            </span>
            <div className="focus-time">
              {Math.floor(focusLeft / 60)
                .toString()
                .padStart(2, "0")}
              <span>:</span>
              {(focusLeft % 60).toString().padStart(2, "0")}
            </div>
            <p>
              {focusEnd
                ? "关掉杂念，一次只做一件事。"
                : focusLeft === 0
                  ? "这段专注结束了，休息一下吧。"
                  : "为自己留下 25 分钟。"}
            </p>
            <div className="inline-actions">
              <button
                className="button primary"
                onClick={() => {
                  if (focusEnd) {
                    setFocusEnd(null);
                  } else {
                    const seconds = focusLeft || 1500;
                    setFocusLeft(seconds);
                    setFocusEnd(Date.now() + seconds * 1000);
                  }
                }}
              >
                {focusEnd
                  ? "暂停一下"
                  : focusLeft < 1500 && focusLeft > 0
                    ? "继续专注"
                    : "开始专注"}
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setFocusEnd(null);
                  setFocusLeft(1500);
                }}
              >
                重新开始
              </button>
            </div>
            <small>
              请保持页面打开；关闭应用后计时不会保留。提醒会在页面中显示。
            </small>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
