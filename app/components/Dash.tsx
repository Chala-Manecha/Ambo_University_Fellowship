import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

/** Blue title bar at the top of a dashboard page, with an optional ← back button and actions on the right. */
export function PageHead({
  title,
  sub,
  back,
  actions,
  lang,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  lang?: string;
}) {
  return (
    <header className="page-head">
      {(back || actions) && (
        <div className="page-head-top">
          {back ? <Link to={back.to} className="back-btn">← {back.label}</Link> : <span />}
          {actions && <div className="page-head-actions">{actions}</div>}
        </div>
      )}
      <h1 lang={lang}>{title}</h1>
      {sub && <p className="page-head-sub">{sub}</p>}
    </header>
  );
}

export type Tone = "lapis" | "gold" | "green" | "red" | "slate";

/** A big number that links to the list behind it. */
export function Tile({ to, n, label, tone = "lapis", lang }: { to: string; n: number | string; label: ReactNode; tone?: Tone; lang?: string }) {
  return (
    <Link to={to} className={`tile tile--${tone}`}>
      <strong>{n}</strong>
      <span lang={lang}>{label}</span>
    </Link>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}

/** White card on the dashboard with a gold marker before its title. */
export function DashCard({ title, id, children, lang }: { title: ReactNode; id: string; children: ReactNode; lang?: string }) {
  return (
    <section className="dash-card" aria-labelledby={id}>
      <h2 id={id} lang={lang}>{title}</h2>
      {children}
    </section>
  );
}

export type Tab = { key: string; to: string; label: string; icon: string; count?: number; alert?: boolean };

/** Big icon buttons that switch between parts of a page; the current one is green. */
export function TabBar({ tabs, active }: { tabs: Tab[]; active: string }) {
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          className={`tab${t.key === active ? " is-active" : ""}`}
          aria-current={t.key === active ? "page" : undefined}
          preventScrollReset
        >
          <span className="tab-icon" aria-hidden="true">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
          {t.count !== undefined && <span className={`tab-count${t.alert && t.count ? " is-alert" : ""}`}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Filter chips with counts, e.g. "All 40 · Male 22 · Female 18". Each is a link that sets one
 * URL parameter and keeps the others, so filters combine and work without JavaScript.
 */
export function Chips<K extends string>({
  label,
  param,
  value,
  options,
  counts,
  allLabel = "All",
  lang,
}: {
  label: string;
  param: string;
  value: K | null;
  options: readonly (readonly [K, string])[];
  counts: Record<K | "all", number>;
  allLabel?: string;
  lang?: string;
}) {
  const location = useLocation();
  const href = (v: K | null) => {
    const p = new URLSearchParams(location.search);
    if (v) p.set(param, v);
    else p.delete(param);
    const s = p.toString();
    return s ? `?${s}` : location.pathname;
  };
  return (
    <div className="chips" role="group" aria-label={label}>
      <span className="chips-label">{label}</span>
      <Link to={href(null)} className="chip" aria-current={value === null} preventScrollReset>
        {allLabel} <b>{counts.all}</b>
      </Link>
      {options.map(([k, text]) => (
        <Link key={k} to={href(k)} className="chip" aria-current={value === k} lang={lang} preventScrollReset>
          {text} <b>{counts[k]}</b>
        </Link>
      ))}
    </div>
  );
}
