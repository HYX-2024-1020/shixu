import { useState, type FormEvent } from "react";
import { AdminApiError, type AdminApi } from "./api";
import { Button, Field } from "./ui";

/**
 * 独立管理员登录。
 * - 与普通用户完全分离（方案 §9）；合成模式下演示凭据 admin / admin-demo。
 * - 会话过期回到本页时给出原因提示。
 */
export function LoginPage({
  api,
  reason,
  onLogin,
}: {
  api: AdminApi;
  reason: "expired" | null;
  onLogin: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      onLogin();
    } catch (err) {
      // 失败保留输入，仅提示错误，绝不清空
      setError(
        err instanceof AdminApiError ? err.error : "登录失败，请稍后重试",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>拾序管理台</h1>
        <p className="sub-brand">独立运维入口 · 仅限管理员 · 经 SSH 隧道访问</p>
        {reason === "expired" && (
          <p className="login-notice" role="alert">
            会话已过期，请重新登录后继续。
          </p>
        )}
        <Field label="管理员账号">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            disabled={busy}
          />
        </Field>
        <Field label="密码">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </Field>
        {error && (
          <p className="login-form-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" type="submit" busy={busy}>
          登录
        </Button>
        {api.source === "synthetic" && (
          <p className="demo-tip">
            当前为<strong>演示数据</strong>，未连接真实后端。演示凭据：账号 <code>admin</code>，密码 <code>admin-demo</code>。
          </p>
        )}
      </form>
    </main>
  );
}
