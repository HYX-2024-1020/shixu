import { useCallback, useEffect, useMemo, useState } from "react";
import { createAdminApi, getSyntheticControls, type AdminApi } from "./api";
import { formatBeijingTime } from "./format";
import { LoginPage } from "./LoginPage";
import { OverviewPage } from "./OverviewPage";
import { UsersPage } from "./UsersPage";
import { Button, ToastProvider } from "./ui";

type Route = "overview" | "users" | "tasks" | "storage" | "ops";

const NAV: Array<{ route: Route; label: string; ready: boolean }> = [
  { route: "overview", label: "服务总览", ready: true },
  { route: "users", label: "用户管理", ready: true },
  { route: "tasks", label: "任务管理", ready: false },
  { route: "storage", label: "存储与备份", ready: false },
  { route: "ops", label: "运维与审计", ready: false },
];

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\//, "");
  return (["overview", "users", "tasks", "storage", "ops"] as Route[]).includes(h as Route)
    ? (h as Route)
    : "overview";
}

function BeijingClock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="clock" title="时区：Asia/Shanghai">
      北京时间 {formatBeijingTime(now)}
    </span>
  );
}

/** 演示控制台：仅合成数据模式显示，用于验收失败/超时/会话过期流程。 */
function DemoConsole() {
  const controls = getSyntheticControls();
  const [flags, setFlags] = useState({
    failReads: controls.failReads,
    failWrites: controls.failWrites,
    timeoutAll: controls.timeoutAll,
    sessionExpired: controls.sessionExpired,
  });
  function toggle(key: keyof typeof flags) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      controls[key] = e.target.checked;
      setFlags((f) => ({ ...f, [key]: e.target.checked }));
    };
  }
  return (
    <details className="demo-console">
      <summary>演示控制台（仅演示数据模式）</summary>
      <div className="controls">
        <label>
          <input type="checkbox" checked={flags.failReads} onChange={toggle("failReads")} />
          读取持续失败
        </label>
        <label>
          <input type="checkbox" checked={flags.failWrites} onChange={toggle("failWrites")} />
          下一次操作失败
        </label>
        <label>
          <input type="checkbox" checked={flags.timeoutAll} onChange={toggle("timeoutAll")} />
          全部请求超时
        </label>
        <label>
          <input type="checkbox" checked={flags.sessionExpired} onChange={toggle("sessionExpired")} />
          模拟会话过期
        </label>
      </div>
    </details>
  );
}

export function AdminApp() {
  const api: AdminApi = useMemo(() => createAdminApi(), []);
  const [session, setSession] = useState<{ username: string; expiresAt: string } | null>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [expiredNotice, setExpiredNotice] = useState(false);

  useEffect(() => {
    api
      .getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setBooting(false));
  }, [api]);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 全局会话失效：任何页面捕获 SESSION_EXPIRED → 回到登录页并给出原因
  useEffect(() => {
    const handler = () => {
      setExpiredNotice(true);
      setSession(null);
    };
    window.addEventListener("shixu:session-expired", handler);
    return () => window.removeEventListener("shixu:session-expired", handler);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* 退出失败不影响本地状态清理 */
    }
    setSession(null);
    setExpiredNotice(false);
  }, [api]);

  if (booting) {
    return (
      <main className="login-wrap">
        <p role="status">正在检查会话…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <LoginPage
        api={api}
        reason={expiredNotice ? "expired" : null}
        onLogin={() => {
          setExpiredNotice(false);
          void api.getSession().then(setSession);
        }}
      />
    );
  }

  const activeNav = NAV.find((n) => n.route === route) ?? NAV[0];

  return (
    <ToastProvider>
      <div className="shell">
        <nav className="side" aria-label="管理台导航">
          <div className="side-brand">
            <span className="mark" aria-hidden="true" />
            <strong>拾序管理台</strong>
            <small>OPS</small>
          </div>
          {NAV.map((n) =>
            n.ready ? (
              <a key={n.route} className={`nav-item ${route === n.route ? "active" : ""}`} href={`#/${n.route}`}>
                {n.label}
              </a>
            ) : (
              <span key={n.route} className="nav-item disabled" title="下一批交付">
                {n.label}
                <span className="nav-tag">下批</span>
              </span>
            ),
          )}
          <div className="side-foot">
            <span>独立回环服务 · 经 SSH 隧道访问</span>
            <span>审计记录受保护，网页不可删除</span>
          </div>
        </nav>
        <div className="main">
          <header className="topbar">
            <span className="crumb">{activeNav.label}</span>
            <span className="spacer" />
            {api.source === "synthetic" && <span className="demo-badge">演示数据 · 未连接后端</span>}
            <BeijingClock />
            <span className="sub" style={{ margin: 0 }}>
              {session.username}
            </span>
            <Button variant="ghost" onClick={handleLogout}>
              退出
            </Button>
          </header>
          <main className="content">
            {api.source === "synthetic" && <DemoConsole />}
            {route === "overview" && <OverviewPage api={api} />}
            {route === "users" && <UsersPage api={api} />}
            {!activeNav.ready && (
              <section className="panel">
                <h1>{activeNav.label}</h1>
                <p>此页面待后续实现，当前可使用服务总览和用户管理。</p>
                <a className="btn btn-ghost" href="#/overview">返回服务总览</a>
              </section>
            )}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
