import { useEffect, useState } from "react";
import type { Route } from "./+types/tg";
import { botLink } from "../content/bot";
import { HOME_AFTER_LOGIN } from "../lib/paths";
import { safeRedirect } from "../lib/session.server";

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void } };
  }
}

const SDK = "https://telegram.org/js/telegram-web-app.js";

export function meta() {
  return [{ title: "Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), HOME_AFTER_LOGIN);
  return { next, botUrl: botLink(context.cloudflare.env.TELEGRAM_BOT_USERNAME) };
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unlinked"; initData: string; busy: boolean; error?: string };

/**
 * Entry page for the Telegram Mini App (the bot's "Open my account" button).
 * Telegram gives it signed initData. A known Telegram account is signed in straight away;
 * a new one is asked whether they already registered on the website (link it once with
 * student ID + password) or are new (register).
 */
export default function TelegramEntry({ loaderData }: Route.ComponentProps) {
  const { next, botUrl } = loaderData;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const start = async () => {
      const wa = window.Telegram?.WebApp;
      if (!wa?.initData) {
        setState({ kind: "error", message: "Open this page from the fellowship bot in Telegram." });
        return;
      }
      wa.ready();
      wa.expand();
      const res = await fetch("/api/auth/sign-in/telegram-webapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: wa.initData }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { ok?: boolean; unlinked?: boolean; message?: string } | null;
      if (res?.ok && body?.ok) return window.location.replace(next);
      if (res?.ok && body?.unlinked) return setState({ kind: "unlinked", initData: wa.initData, busy: false });
      setState({ kind: "error", message: body?.message ?? "Sign-in failed. Open the bot and try again." });
    };
    if (window.Telegram?.WebApp) {
      void start();
      return;
    }
    const s = document.createElement("script");
    s.src = SDK;
    s.async = true;
    s.addEventListener("load", () => void start(), { once: true });
    s.addEventListener("error", () => setState({ kind: "error", message: "Couldn't load Telegram. Check your connection." }), { once: true });
    document.head.appendChild(s);
  }, [next]);

  if (state.kind === "loading") {
    return <section className="page narrow"><p className="muted">Signing you in…</p></section>;
  }
  if (state.kind === "error") {
    return (
      <section className="page narrow">
        <p className="form-error" role="alert">{state.message}</p>
        <a className="btn btn-primary" href={botUrl}>Open the bot</a>
      </section>
    );
  }

  const { initData } = state;
  async function onLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ kind: "unlinked", initData, busy: true });
    const res = await fetch("/api/auth/sign-in/telegram-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, studentId: f.get("studentId"), password: f.get("password") }),
    }).catch(() => null);
    if (res?.ok) return window.location.replace(next);
    const body = (await res?.json().catch(() => null)) as { message?: string } | null;
    const error =
      res?.status === 429 ? "Too many wrong passwords. Wait 15 minutes and try again."
      : body?.message === "telegram_taken" ? "This Telegram account is already linked to another member."
      : body?.message === "account_has_telegram" ? "That member account is already linked to a different Telegram account."
      : "Student ID or password is wrong.";
    setState({ kind: "unlinked", initData, busy: false, error });
  }
  async function onNew() {
    setState({ kind: "unlinked", initData, busy: true });
    const res = await fetch("/api/auth/sign-in/telegram-webapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, create: true }),
    }).catch(() => null);
    if (res?.ok) return window.location.replace(next === HOME_AFTER_LOGIN ? "/register" : `/register?next=${encodeURIComponent(next)}`);
    setState({ kind: "unlinked", initData, busy: false, error: "Something went wrong. Try again." });
  }

  return (
    <section className="page narrow">
      <h1>Welcome</h1>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <div className="card">
        <h2>New here?</h2>
        <p className="muted">Register as a member of the fellowship.</p>
        <button type="button" className="btn btn-primary" disabled={state.busy} onClick={onNew}>Register</button>
      </div>
      <div className="card">
        <h2>Already registered on the website?</h2>
        <p className="muted">Sign in once. After that, this Telegram account opens your account directly.</p>
        <form className="form" onSubmit={onLink}>
          <label className="field">
            <span>Student ID</span>
            <input name="studentId" required autoCapitalize="characters" autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <button className="btn btn-quiet" disabled={state.busy}>Sign in and link Telegram</button>
        </form>
      </div>
    </section>
  );
}
