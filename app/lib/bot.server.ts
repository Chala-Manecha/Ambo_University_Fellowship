import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { BOT } from "../content/bot";
import { getDb, schema } from "../db";
import { consumeLinkToken } from "./accounts.server";

/* ---------- Telegram Bot API ---------- */

type TgResult<T = unknown> = { ok: boolean; result?: T; description?: string };

/** Calls the Bot API. Never throws: failures are logged and returned. */
export async function tgCall<T = unknown>(env: Env, method: string, payload: object = {}): Promise<TgResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as TgResult<T> | null;
    if (!data?.ok) console.warn(`telegram ${method} failed:`, data?.description ?? res.status);
    return data ?? { ok: false, description: `HTTP ${res.status}` };
  } catch (err) {
    console.warn(`telegram ${method} failed:`, err);
    return { ok: false, description: String(err) };
  }
}

export function sendMessage(env: Env, chatId: number | string, text: string, replyMarkup?: object) {
  return tgCall(env, "sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

/* ---------- Notifications ---------- */

/** Sends a message to every admin who has a Telegram id. */
export async function notifyAdmins(env: Env, text: string) {
  const admins = await getDb(env.DB)
    .select({ telegramId: schema.user.telegramId })
    .from(schema.user)
    .where(and(eq(schema.user.role, "admin"), isNotNull(schema.user.telegramId)));
  await Promise.all(admins.map((a) => sendMessage(env, a.telegramId!, text)));
}

/* ---------- Incoming updates (webhook) ---------- */

// looseObject: keep fields we don't use instead of failing on them
const updateSchema = z.looseObject({
  message: z
    .looseObject({
      chat: z.looseObject({ id: z.number(), type: z.string() }),
      from: z
        .looseObject({ id: z.number(), first_name: z.string().optional(), username: z.string().optional() })
        .optional(),
      text: z.string().optional(),
      contact: z.looseObject({ phone_number: z.string(), user_id: z.number().optional() }).optional(),
    })
    .optional(),
});

function openKeyboard(env: Env) {
  return {
    inline_keyboard: [[{ text: BOT.openButton, web_app: { url: `${env.PUBLIC_SITE_URL}/tg?next=%2Fme` } }]],
  };
}

/**
 * The bot never asks for a phone number. Any message (normally /start) gets a welcome and an
 * "Open my account" button, which opens the website inside Telegram, signed in as this
 * Telegram account (or offering to register / link an existing website account).
 */
export async function handleUpdate(raw: unknown, env: Env) {
  const parsed = updateSchema.safeParse(raw);
  const msg = parsed.success ? parsed.data.message : undefined;
  if (!msg?.from || msg.chat.type !== "private") return; // ignore groups and non-message updates

  // "Connect Telegram" from the website: /start link_<code>
  const link = msg.text?.trim().match(/^\/start(?:@\w+)?\s+link_([a-f0-9]{16,64})$/i);
  if (link) {
    const from = msg.from;
    const result = await consumeLinkToken(getDb(env.DB), link[1].toLowerCase(), {
      id: from.id,
      name: [from.first_name, (from as { last_name?: string }).last_name].filter(Boolean).join(" ") || from.username || `Telegram ${from.id}`,
      username: from.username ?? null,
    });
    const text = result.ok ? BOT.linked : result.reason === "expired" ? BOT.linkExpired : BOT.linkTaken;
    await sendMessage(env, msg.chat.id, text, openKeyboard(env));
    return;
  }
  await sendMessage(env, msg.chat.id, BOT.start, openKeyboard(env));
}
