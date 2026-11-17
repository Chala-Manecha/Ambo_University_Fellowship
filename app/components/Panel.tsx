import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

export type PanelItem = { to: string; label: string; icon: string; lang?: string };
export type PanelGroup = { label: string; items: PanelItem[] };

/**
 * Is this pill the page being shown? Matches the path, and the `tab` parameter when
 * the pill has one. `defaultTab` is the tab a page shows when the URL has none.
 */
function isActive(to: string, pathname: string, search: string, defaultTab?: string) {
  const [path, query = ""] = to.split("?");
  const clean = (p: string) => p.replace(/\/+$/, "") || "/";
  if (clean(path) !== clean(pathname)) return false;
  const wantTab = new URLSearchParams(query).get("tab");
  if (!wantTab) return true;
  const tab = new URLSearchParams(search).get("tab") ?? defaultTab ?? null;
  return tab === wantTab;
}

/**
 * Dark heading panel used by ጽህፈት ቤት and every department: a title, a "← All departments"
 * link, and rows of pill buttons grouped by subject. The page for the active pill shows below it.
 */
export function Panel({
  title,
  titleLang,
  sub,
  back,
  groups,
  defaultTab,
}: {
  title: ReactNode;
  titleLang?: string;
  sub?: ReactNode;
  back?: { to: string; label: string };
  groups: PanelGroup[];
  defaultTab?: string;
}) {
  const { pathname, search } = useLocation();
  return (
    <section className="panel">
      <div className="panel-top">
        <h1 lang={titleLang}>{title}</h1>
        {sub && <div className="panel-sub">{sub}</div>}
      </div>
      <div className="panel-nav">
        {back && <Link to={back.to} className="panel-back">← {back.label}</Link>}
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.label} className="panel-row">
              <span className="panel-row-label">{g.label}</span>
              <div className="panel-pills">
                {g.items.map((it) => {
                  const active = isActive(it.to, pathname, search, defaultTab);
                  return (
                    <Link key={it.to} to={it.to} className="panel-pill" aria-current={active ? "page" : undefined} lang={it.lang} preventScrollReset>
                      <span aria-hidden="true">{it.icon}</span> {it.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

/** Row of rounded count buttons ("3 Members", "1 Join request") under a panel. */
export function Counts({ items }: { items: { to: string; n: number; label: string; active?: boolean; alert?: boolean }[] }) {
  return (
    <nav className="counts" aria-label="Totals">
      {items.map((c) => (
        <Link key={c.label} to={c.to} className={`count${c.alert && c.n ? " is-alert" : ""}`} aria-current={c.active ? "page" : undefined} preventScrollReset>
          <strong>{c.n}</strong> {c.label}
        </Link>
      ))}
    </nav>
  );
}
