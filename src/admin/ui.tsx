import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AdminApiError } from "./api";

/* ---------------- 按钮 ---------------- */

export function Button({
  variant = "ghost",
  busy = false,
  disabled,
  children,
  onClick,
  type = "button",
}: {
  variant?: "primary" | "ghost" | "danger";
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ---------------- 状态徽标（文字 + 颜色，不单独依赖颜色） ---------------- */

export type BadgeTone = "ok" | "warn" | "danger" | "muted" | "info";

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/* ---------------- 骨架屏 / 空态 / 错误态 ---------------- */

export function Skeleton({ rows = 3, height = 18 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ height, width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof AdminApiError
      ? `${error.error}（${error.code}）`
      : error instanceof Error
        ? error.message
        : "发生未知错误";
  const retryable = error instanceof AdminApiError ? error.retryable : true;
  return (
    <div className="error-state" role="alert">
      <p className="error-title">加载失败</p>
      <p className="error-detail">{message}</p>
      {onRetry && retryable && (
        <Button variant="ghost" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

/* ---------------- 异步数据加载 ---------------- */

export type AsyncState<T> =
  | { phase: "loading" }
  | { phase: "error"; error: unknown }
  | { phase: "ready"; data: T };

/** 会话失效统一上报：页面捕获后通知 App 回到登录页。 */
export function reportSessionExpired(error: unknown): void {
  if (error instanceof AdminApiError && error.code === "SESSION_EXPIRED") {
    window.dispatchEvent(new CustomEvent("shixu:session-expired"));
  }
}

export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    loadRef.current()
      .then((data) => alive && setState({ phase: "ready", data }))
      .catch((error) => {
        if (!alive) return;
        reportSessionExpired(error);
        setState({ phase: "error", error });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { state, retry };
}

/* ---------------- 确认对话框（敏感操作：说明对象、影响与后果） ---------------- */

export function ConfirmDialog({
  open,
  title,
  subject,
  impact,
  consequence,
  confirmLabel = "确认执行",
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  /** 操作对象 */
  subject: string;
  /** 影响 */
  impact: string;
  /** 后果（不可撤销性等） */
  consequence: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onCancel();
        }}
      >
        <h3 id="confirm-title" className="dialog-title">
          {title}
        </h3>
        <dl className="dialog-facts">
          <div>
            <dt>对象</dt>
            <dd>{subject}</dd>
          </div>
          <div>
            <dt>影响</dt>
            <dd>{impact}</dd>
          </div>
          <div>
            <dt>后果</dt>
            <dd>{consequence}</dd>
          </div>
        </dl>
        {children}
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 轻提示 ---------------- */

interface ToastItem {
  id: number;
  tone: "ok" | "error";
  text: string;
}

const ToastCtx = createContext<(tone: "ok" | "error", text: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: "ok" | "error", text: string) => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, tone, text }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- 表单 ---------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
