import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/login";
import type { loader as rootLoader } from "../root";
import { HOME_AFTER_LOGIN } from "../lib/paths";
import { getUser, safeRedirect, signInWithStudentId } from "../lib/session.server";

export function meta() {
  return [{ title: "Sign in · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), HOME_AFTER_LOGIN);
  if (await getUser(request, env)) throw redirect(next);
  return { next, devLogin: import.meta.env.DEV };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const next = safeRedirect(form.get("next"), HOME_AFTER_LOGIN);
  const studentId = String(form.get("studentId") ?? "");
  const result = await signInWithStudentId(request, context.cloudflare.env, studentId, String(form.get("password") ?? ""));
  if ("error" in result) return { error: result.error, studentId };
  return redirect(next, { headers: result.headers });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const busy = useNavigation().state !== "idle";
  const { next, devLogin } = loaderData;
  const registerHref = next !== HOME_AFTER_LOGIN ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <section className="page narrow">
      <h1>Sign in</h1>
      {actionData?.error && (
        <p className="form-error" role="alert">
          {actionData.error === "locked"
            ? "Too many wrong passwords. Wait 15 minutes and try again."
            : "Student ID or password is wrong."}
        </p>
      )}
      <Form method="post" className="form">
        <input type="hidden" name="next" value={next} />
        <label className="field">
          <span>Student ID</span>
          <input name="studentId" required autoComplete="username" autoCapitalize="characters" placeholder="UGR/1234/16" defaultValue={actionData?.studentId} />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </Form>
      <p className="muted">Forgot your password? Ask a fellowship admin to reset it.</p>
      <p>Not a member yet? <Link to={registerHref}>Register</Link></p>
      {root?.botUrl && (
        <p className="muted">
          Or use Telegram: <a href={root.botUrl}>open the fellowship bot</a>, press <strong>Start</strong>, then <strong>Open my account</strong>.
        </p>
      )}
      {devLogin && <DevLogin next={next} />}
    </section>
  );
}

/** Local development only — Telegram can't reach localhost. */
function DevLogin({ next }: { next: string }) {
  const nav = useNavigation();
  return (
    <details className="dev-login">
      <summary>Developer sign-in (local only)</summary>
      <Form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const res = await fetch("/api/auth/sign-in/dev", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ telegramId: f.get("telegramId"), name: f.get("name") }),
          });
          if (res.ok) window.location.assign(next);
        }}
      >
        <label>Fake Telegram ID<input name="telegramId" type="number" defaultValue={1001} required /></label>
        <label>Name<input name="name" defaultValue="Test Member" required /></label>
        <button className="btn btn-quiet" disabled={nav.state !== "idle"}>Sign in as test user</button>
      </Form>
    </details>
  );
}
