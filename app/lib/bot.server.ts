import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { BOT } from "../content/bot";
import { getDb, schema } from "../db";
import { isOwnContact, normalizeContactPhone } from "./registration";

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

const shareKeyboard = {
  keyboard: [[{ text: BOT.shareButton, request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function continueKeyboard(env: Env) {
  return {
    inline_keyboard: [[{ text: BOT.continueButton, web_app: { url: `${env.PUBLIC_SITE_URL}/tg?next=%2Fregister` } }]],
  };
}

/**
 * Registration flow in the bot:
 *  /start (or any message) → ask for the phone number with a "share contact" button
 *  contact (their own)     → save it, then show "Continue registration", which
 *                            opens the website inside Telegram, already signed in.
 */
export async function handleUpdate(raw: unknown, env: Env) {
  const parsed = updateSchema.safeParse(raw);
  const msg = parsed.success ? parsed.data.message : undefined;
  if (!msg?.from || msg.chat.type !== "private") return; // ignore groups and non-message updates

  const chatId = msg.chat.id;
  const db = getDb(env.DB);

  if (msg.contact) {
    if (!isOwnContact(msg.contact.user_id, msg.from.id)) {
      await sendMessage(env, chatId, BOT.notOwnContact, shareKeyboard);
      return;
    }
    const phone = normalizeContactPhone(msg.contact.phone_number);
    const telegramId = String(msg.from.id);
    await db
      .insert(schema.telegramContacts)
      .values({ telegramId, phone, firstName: msg.from.first_name ?? null, username: msg.from.username ?? null })
      .onConflictDoUpdate({
        target: schema.telegramContacts.telegramId,
        set: { phone, firstName: msg.from.first_name ?? null, username: msg.from.username ?? null, updatedAt: new Date() },
      });
    await sendMessage(env, chatId, BOT.saved, { remove_keyboard: true });
    await sendMessage(env, chatId, BOT.continue, continueKeyboard(env));
    return;
  }

  const known = await db.query.telegramContacts.findFirst({
    where: eq(schema.telegramContacts.telegramId, String(msg.from.id)),
    columns: { telegramId: true },
  });
  if (known) {
    await sendMessage(env, chatId, BOT.continue, continueKeyboard(env));
  } else {
    await sendMessage(env, chatId, BOT.start, shareKeyboard);
  }
}
