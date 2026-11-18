import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { getDepartmentLeaderTelegramIds } from "./departments.server";
import { FINANCE_DEPT } from "./departments";
import { sendMessage } from "./bot.server";

/** The insert that copies approved money into the ledger (put it in the same batch as the approval). */
export function ledgerIn(db: Db, e: { amount: number; category: "contribution" | "donation"; description: string; date: string; person: string; refId: string; by: string }) {
  return db
    .insert(schema.ledger)
    .values({ direction: "in", amount: e.amount, category: e.category, description: e.description, date: e.date, person: e.person, refId: e.refId, recordedBy: e.by })
    .onConflictDoNothing();
}

/** Telegram ids of the people who approve money: ሂሳብ እና ንብረት leaders and admins. */
export async function moneyReviewerTelegramIds(db: Db) {
  const leaders = await getDepartmentLeaderTelegramIds(db, FINANCE_DEPT);
  const admins = await db.select({ t: schema.user.telegramId }).from(schema.user).where(eq(schema.user.role, "admin"));
  return [...new Set([...leaders, ...admins.map((a) => a.t).filter((t): t is string => Boolean(t))])];
}

export async function notifyMoneyReviewers(env: Env, db: Db, text: string) {
  const ids = await moneyReviewerTelegramIds(db);
  await Promise.all(ids.map((id) => sendMessage(env, id, text)));
}
