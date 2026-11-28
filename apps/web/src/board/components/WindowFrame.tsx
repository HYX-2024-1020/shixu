import type { ReactNode } from "react";

interface WindowFrameProps {
  title: string;
  subtitle: string;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  label: string;
}

export function WindowFrame({
  title,
  subtitle,
  className = "",
  children,
  footer,
  label,
}: WindowFrameProps) {
  return (
    <section className={`sx-window ${className}`} aria-label={label}>
      <header className="sx-window-header">
        <span className="sx-brand-mark" aria-hidden="true">
          序
        </span>
        <strong>{title}</strong>
        <span className="sx-window-subtitle">{subtitle}</span>
      </header>
      {children}
      {footer ? <footer className="sx-window-footer">{footer}</footer> : null}
    </section>
  );
}
