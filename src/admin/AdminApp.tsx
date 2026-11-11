import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminApiError,
  createAdminApi,
  getSyntheticControls,
  type AdminApi,
} from "./api";
import { formatBeijingTime } from "./format";
import { LoginPage } from "./LoginPage";
import { OverviewPage } from "./OverviewPage";
import { UsersPage } from "./UsersPage";
import { AlertsPage, AuditPage } from "./RuntimePages";
import { TasksPage } from "./ManagementPages";
import { StoragePage } from "./OperationsPages";
import { Button, ToastProvider } from "./ui";

type Route = "overview" | "users" | "tasks" | "storage" | "ops" | "alerts";

const NAV: Array<{ route: Route; label: string; ready: boolean }> = [
  { route: "overview", label: "服务总览", ready: true },
  { route: "users", label: "用户管理", ready: true },
  { route: "tasks", label: "任务管理", ready: true },
  { route: "storage", label: "存储与备份", ready: true },
  { route: "ops", label: "运维与审计", ready: true },
  { route: "alerts", label: "告警中心", ready: true },
];

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\//, "").split("?")[0];
  return (
    ["overview", "users", "tasks", "storage", "ops", "alerts"] as Route[]
  ).includes(h as Route)
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
          <input
            type="checkbox"
            checked={flags.failReads}
            onChange={toggle("failReads")}
          />
          读取持续失败
        </label>
        <label>
          <input
            type="checkbox"
            checked={flags.failWrites}
            onChange={toggle("failWrites")}
          />
          下一次操作失败
        </label>
        <label>
          <input
            type="checkbox"
            checked={flags.timeoutAll}
            onChange={toggle("timeoutAll")}
          />
          全部请求超时
        </label>
        <label>
          <input
            type="checkbox"
            checked={flags.sessionExpired}
            onChange={toggle("sessionExpired")}
          />
          模拟会话过期
        </label>
      </div>
    </details>
  );
}

export function AdminApp() {
  const api: AdminApi = useMemo(() => createAdminApi(), []);
  const [session, setSession] = useState<{
    username: string;
    expiresAt: string;
  } | null>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [alertCount, setAlertCount] = useState<number | null>(null);
  useEffect(() => {
    if (!session || !api.getAlerts) return;
    let active = true;
    const poll = () =>
      api.getAlerts!()
        .then((rows) => {
          if (active) setAlertCount(rows.filter((a) => !a.recoveredAt).length);
        })
        .catch(() => {
          if (active) setAlertCount(null);
        });
    void poll();
    const timer = setInterval(() => void poll(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, session]);

  useEffect(() => {
    let active = true;
    api
      .getSession()
      .then((s) => {
        if (active) setSession(s);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
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
    setLogoutBusy(true);
    setLogoutError(null);
    try {
      await api.logout();
    } catch (error) {
      if (
        !(error instanceof AdminApiError && error.code === "SESSION_EXPIRED")
      ) {
        setLogoutError("退出未完成，请重试。管理会话仍可能有效。");
        return;
      }
    } finally {
      setLogoutBusy(false);
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
        onLogin={(nextSession) => {
          setExpiredNotice(false);
          setLogoutError(null);
          setSession(nextSession);
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
              <a
                key={n.route}
                className={`nav-item ${route === n.route ? "active" : ""}`}
                href={`#/${n.route}`}
              >
                {n.label}
                {n.route === "alerts" && (
                  <span
                    className="nav-tag"
                    title="未恢复的故障数；包含已读但尚未恢复的条目"
                  >
                    {alertCount ?? "待连接"}
                  </span>
                )}
              </a>
            ) : (
              <span
                key={n.route}
                className="nav-item disabled"
                title="下一批交付"
              >
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
            {api.source === "synthetic" && (
              <span className="demo-badge">演示数据 · 未连接后端</span>
            )}
            <BeijingClock />
            <span className="sub" style={{ margin: 0 }}>
              {session.username}
            </span>
            <Button variant="ghost" busy={logoutBusy} onClick={handleLogout}>
              退出
            </Button>
          </header>
          <main className="content">
            {logoutError && (
              <p className="login-notice" role="alert">
                {logoutError}
              </p>
            )}
            {api.source === "synthetic" && <DemoConsole />}
            {route === "overview" && <OverviewPage api={api} />}
            {route === "users" && <UsersPage api={api} />}
            {route === "alerts" && <AlertsPage api={api} />}
            {route === "ops" && <AuditPage api={api} />}
            {route === "tasks" && <TasksPage api={api} />}
            {route === "storage" && <StoragePage api={api} />}
            {!activeNav.ready && (
              <section className="panel">
                <h1>{activeNav.label}</h1>
                <p>此页面待后续实现，当前可使用服务总览和用户管理。</p>
                <a className="btn btn-ghost" href="#/overview">
                  返回服务总览
                </a>
              </section>
            )}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
