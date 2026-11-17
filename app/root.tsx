import { useEffect, useState } from "react";
import {
  isRouteErrorResponse,
  useLocation,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import { LangSwitch } from "./components/LangSwitch";
import { botLink } from "./content/bot";
import { HOME, SITE } from "./content/site";
import { DEFAULT_LANG, langFromCookie } from "./lib/lang";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getUser } from "./lib/session.server";
import { can, hasDashboard } from "./lib/permissions";
import { getLeaderDepartmentIds } from "./lib/departments.server";
import { departmentName } from "./lib/departments";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Noto+Sans+Ethiopic:wght@400;600&family=Noto+Serif+Ethiopic:wght@500;700&family=Spectral:wght@500;700&family=Noto+Sans:wght@400;600&display=swap",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await getUser(request, env);
  const db = getDb(env.DB);
  const [isMember, leaderOf, departments] = user
    ? await Promise.all([
        db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true } }).then(Boolean),
        getLeaderDepartmentIds(db, user.id),
        db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder), columns: { id: true, nameOm: true, nameAm: true } }),
      ])
    : [false, [] as string[], []];
  const role = user?.role ?? "member";
  return {
    lang: langFromCookie(request.headers.get("Cookie")),
    botUrl: botLink(env.TELEGRAM_BOT_USERNAME),
    user,
    isMember,
    menu: user
      ? {
          // ጽህፈት ቤት: the three positions (and other admins) — roles & positions
          office: can(role, "member:manage"),
          // Leaders and officers switch between their member dashboard and leadership
          leadership: hasDashboard(role) || leaderOf.length > 0,
          departments,
        }
      : null,
  };
}

/** Slide-in menu (☰) with everything this person can open, including all departments. */
function Menu({ data, lang }: { data: NonNullable<ReturnType<typeof useRouteLoaderData<typeof loader>>>; lang: "om" | "am" }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const m = data.menu;

  return (
    <>
      <button type="button" className="menu-toggle" aria-expanded={open} aria-controls="main-menu" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">☰</span> Menu
      </button>
      {open && <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <nav id="main-menu" className={`drawer${open ? " is-open" : ""}`} aria-label="Main" aria-hidden={!open}>
        <div className="drawer-head">
          <strong>{data.user?.name ?? "Menu"}</strong>
          <button type="button" className="link-btn" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button>
        </div>
        {data.user ? (
          <>
            {m?.office && (
              <NavLink to="/office" lang="am">
                🏛️ ጽህፈት ቤት
              </NavLink>
            )}
            {m?.departments.map((d) => (
              <NavLink key={d.id} to={`/departments/${d.id}`} lang={lang}>
                🏛️ {departmentName(d, lang)}
              </NavLink>
            ))}
            <form method="post" action="/logout"><button className="drawer-signout">↪ Sign out</button></form>
          </>
        ) : (
          <>
            <NavLink to="/" end>⛪ Home</NavLink>
            <NavLink to="/register">📝 Register</NavLink>
            <NavLink to="/login">🔑 Sign in</NavLink>
          </>
        )}
      </nav>
    </>
  );
}

/** Pages that belong to "Leadership"; everything else counts as the member side. */
const LEADERSHIP_PATHS = ["/lead", "/office", "/departments/", "/dashboard", "/admin", "/members", "/dues", "/attendance"];

/** "Member | Leadership" switch under the header, for people with a leadership job. */
function ModeSwitch() {
  const { pathname } = useLocation();
  const lead = LEADERSHIP_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
  const member = !lead && pathname.startsWith("/account");
  return (
    <nav className="mode-switch" aria-label="Switch view">
      <Link to="/account" aria-current={member ? "page" : undefined}>Member</Link>
      <Link to="/lead" aria-current={lead ? "page" : undefined}>Leadership</Link>
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const lang = data?.lang ?? DEFAULT_LANG;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1F2E6B" />
        <Meta />
        <Links />
      </head>
      <body>
        <header className="site-header">
          <Link to="/" className="wordmark">
            <span className="wordmark-logo" aria-hidden="true">
              {SITE.churchLogo && <img src={SITE.churchLogo} alt="" width={52} height={52} />}
            </span>
            <span lang={lang} className="wordmark-name">{HOME[lang].header}</span>
          </Link>
          <div className="header-actions">
            {data && !data.user && <Link to="/login" className="btn btn-quiet btn-sm">Sign in</Link>}
            {data && <Menu data={data} lang={lang} />}
            {data && <LangSwitch current={data.lang} />}
          </div>
        </header>
        {data?.menu?.leadership && <ModeSwitch />}
        <main>{children}</main>
        <footer className="site-footer">
          <div className="tilet tilet--thin" aria-hidden="true" />
          <p>Questions? Message the fellowship on Telegram.</p>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "Reload the page. If it keeps happening, tell a fellowship admin.";
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    detail = error.status === 404 ? "Check the address, or go back to the homepage." : String(error.data || error.statusText);
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }
  return (
    <section className="page narrow">
      <h1>{title}</h1>
      <p>{detail}</p>
      <p><Link to="/">Go to homepage</Link></p>
    </section>
  );
}
