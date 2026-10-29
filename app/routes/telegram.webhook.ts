import type { Route } from "./+types/telegram.webhook";
import { handleUpdate } from "../lib/bot.server";
import { secretMatches } from "../lib/telegram-verify";

/**
 * Telegram posts every bot update here. The secret header proves the request
 * comes from Telegram (set with setWebhook on /admin/telegram).
 * Answer 200 straight away; Telegram retries anything else.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  if (!secretMatches(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }
  const update = await request.json().catch(() => null);
  ctx.waitUntil(handleUpdate(update, env).catch((err) => console.error("bot update failed:", err)));
  return new Response("ok");
}

export function loader() {
  return new Response("Not found", { status: 404 });
}
