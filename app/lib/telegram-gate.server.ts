import type { Db } from "../db";
import { createLinkToken, isTelegramLinked } from "./accounts.server";

/**
 * Members must connect Telegram (that's where reminders and approvals arrive).
 * Returns null when connected, otherwise the t.me link that connects it in one tap.
 */
export async function telegramGate(db: Db, env: Env, userId: string) {
  if (await isTelegramLinked(db, userId)) return null;
  const token = await createLinkToken(db, userId);
  return { linkUrl: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=link_${token}` };
}
