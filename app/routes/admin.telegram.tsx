import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/admin.telegram";
import { botLink } from "../content/bot";
import { tgCall } from "../lib/bot.server";
import { requirePermission } from "../lib/session.server";

type WebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
};

export function meta() {
  return [{ title: "Telegram bot · Gibi Gubae" }];
}

function webhookUrl(env: Env) {
  return `${env.PUBLIC_SITE_URL}/telegram/webhook`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "bot:manage");
  const info = await tgCall<WebhookInfo>(env, "getWebhookInfo");
  return {
    info: info.result ?? null,
    error: info.ok ? null : info.description ?? "Telegram didn't answer.",
    expectedUrl: webhookUrl(env),
    botUrl: botLink(env.TELEGRAM_BOT_USERNAME),
  };
}

/** Points the bot at this site. Run once after deploying, and again if the site URL changes. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "bot:manage");
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return { ok: false, message: "TELEGRAM_WEBHOOK_SECRET isn't set on the Worker yet." };
  }
  const res = await tgCall(env, "setWebhook", {
    url: webhookUrl(env),
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  return { ok: res.ok, message: res.ok ? "Webhook set. Try the bot now." : `Telegram refused: ${res.description}` };
}

export default function TelegramAdmin({ loaderData, actionData }: Route.ComponentProps) {
  const { info, error, expectedUrl, botUrl } = loaderData;
  const nav = useNavigation();
  const connected = info?.url === expectedUrl;
  return (
    <section className="page narrow">
      <h1>Telegram bot</h1>
      {actionData && (
        <p className={actionData.ok ? "notice" : "form-error"} role="status">{actionData.message}</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p>
        Status: <strong>{connected ? "Connected" : "Not connected"}</strong>
        {info?.url && !connected && <span className="muted"> (currently pointing at {info.url})</span>}
      </p>
      {info?.last_error_message && (
        <p className="muted">
          Last error: {info.last_error_message}
          {info.last_error_date && ` (${new Date(info.last_error_date * 1000).toLocaleString("en-GB")})`}
        </p>
      )}
      <Form method="post">
        <button className="btn btn-primary" disabled={nav.state !== "idle"}>
          {connected ? "Reconnect webhook" : "Connect webhook"}
        </button>
      </Form>
      <p className="muted">
        Then test it: <a href={botUrl}>open the bot</a> and press Start.
      </p>
    </section>
  );
}
