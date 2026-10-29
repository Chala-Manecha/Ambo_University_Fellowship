import {
  isRouteErrorResponse,
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
import { HOME } from "./content/site";
import { DEFAULT_LANG, langFromCookie } from "./lib/lang";
import { getUser } from "./lib/session.server";
import { can } from "./lib/permissions";
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
  return {
    lang: langFromCookie(request.headers.get("Cookie")),
    user,
    canReview: user ? can(user.role, "registration:review") : false,
  };
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
            <span lang={lang}>{HOME[lang].name}</span>
            <small>Campus Fellowship</small>
          </Link>
          <nav aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/register">Register</NavLink>
            {data?.canReview && <NavLink to="/admin/registrations">Review</NavLink>}
            {data?.user ? <NavLink to="/account">My account</NavLink> : <NavLink to="/login">Sign in</NavLink>}
          </nav>
          {data && <LangSwitch current={data.lang} />}
        </header>
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
