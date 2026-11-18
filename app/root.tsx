import {
  isRouteErrorResponse,
  useLocation,
  Link,
  Links,
  Meta,
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
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getUser } from "./lib/session.server";
import { hasDashboard } from "./lib/permissions";
import { getLeaderDepartmentIds } from "./lib/departments.server";
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
  const [isMember, leaderOf] = user
    ? await Promise.all([
        db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true } }).then(Boolean),
        getLeaderDepartmentIds(db, user.id),
      ])
    : [false, [] as string[]];
  const role = user?.role ?? "member";
  return {
    lang: langFromCookie(request.headers.get("Cookie")),
    botUrl: botLink(env.TELEGRAM_BOT_USERNAME),
    user,
    isMember,
    menu: user
      ? {
          // Leaders and officers switch between their member dashboard and leadership
          leadership: hasDashboard(role) || leaderOf.length > 0,
        }
      : null,
  };
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
