import { useEffect, useState } from "react";
import type { Route } from "./+types/tg";
import { botLink } from "../content/bot";
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
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), "/register");
  return { next, botUrl: botLink(context.cloudflare.env.TELEGRAM_BOT_USERNAME) };
}

/**
 * Entry page for the Telegram Mini App. Telegram opens it from the bot's
 * "Continue registration" button and gives it signed initData, which signs the
 * member in without the phone-number login screen.
 */
export default function TelegramEntry({ loaderData }: Route.ComponentProps) {
  const { next, botUrl } = loaderData;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const signIn = async () => {
      const wa = window.Telegram?.WebApp;
      if (!wa?.initData) {
        setError("Open this page from the fellowship bot in Telegram.");
        return;
      }
      wa.ready();
      wa.expand();
      const res = await fetch("/api/auth/sign-in/telegram-webapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: wa.initData }),
      });
      if (res.ok) {
        window.location.replace(next);
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "Sign-in failed. Open the bot and try again.");
      }
    };
    if (window.Telegram?.WebApp) {
      void signIn();
      return;
    }
    const s = document.createElement("script");
    s.src = SDK;
    s.async = true;
    s.addEventListener("load", () => void signIn(), { once: true });
    s.addEventListener("error", () => setError("Couldn't load Telegram. Check your connection."), { once: true });
    document.head.appendChild(s);
  }, [next]);

  return (
    <section className="page narrow">
      {error ? (
        <>
          <p className="form-error" role="alert">{error}</p>
          <a className="btn btn-primary" href={botUrl}>Open the bot</a>
        </>
      ) : (
        <p className="muted">Signing you in…</p>
      )}
    </section>
  );
}
