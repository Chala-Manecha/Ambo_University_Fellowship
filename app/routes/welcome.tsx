import { useEffect } from "react";
import { redirect, useRevalidator } from "react-router";
import type { Route } from "./+types/welcome";
import { getDb } from "../db";
import { requireUser, safeRedirect } from "../lib/session.server";
import { telegramGate } from "../lib/telegram-gate.server";

export function meta() {
  return [{ title: "Last step · Gibi Gubae" }];
}

/** Right after registration: open the fellowship bot and press Start; the bot sends the member QR code. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), "/account?registered=1");
  const gate = await telegramGate(getDb(env.DB), env, user.id);
  if (!gate) throw redirect(next); // linked: they already got their QR in the bot
  return { linkUrl: gate.linkUrl, bot: env.TELEGRAM_BOT_USERNAME };
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { linkUrl, bot } = loaderData;
  const { revalidate, state } = useRevalidator();

  // Open the bot by itself a moment after the page shows; the button is there if it doesn't
  useEffect(() => {
    const t = setTimeout(() => window.location.assign(linkUrl), 1500);
    return () => clearTimeout(t);
  }, [linkUrl]);
  // Coming back from Telegram: check whether Start was pressed
  useEffect(() => {
    const onFocus = () => revalidate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [revalidate]);

  return (
    <section className="page narrow">
      <div className="card welcome-bot">
        <p className="welcome-done">✅ Registration submitted</p>
        <h1>Last step: open our bot</h1>
        <p className="welcome-bot-name">@{bot}</p>
        <ol>
          <li>Tap <strong>Open @{bot}</strong> (it opens by itself).</li>
          <li>Press <strong>Start</strong> at the bottom of the chat.</li>
          <li>The bot sends you your <strong>member QR code</strong> — keep it for the cafe. Approval news comes there too.</li>
        </ol>
        <a href={linkUrl} className="btn btn-primary welcome-open">Open @{bot}</a>
        <button type="button" className="btn btn-quiet" onClick={() => revalidate()} disabled={state !== "idle"}>
          {state !== "idle" ? "Checking…" : "I pressed Start"}
        </button>
        <p className="muted" lang="am">የመጨረሻ ደረጃ፦ ቦታችንን ከፍተው “Start” ይጫኑ፤ ቦቱ የአባልነት QR ኮድዎን ይልክልዎታል።</p>
        <p className="muted" lang="om">Tarkaanfii dhumaa: bootii keenya banaatii “Start” tuqaa; bootiin QR miseensummaa keessan isinii erga.</p>
      </div>
    </section>
  );
}
