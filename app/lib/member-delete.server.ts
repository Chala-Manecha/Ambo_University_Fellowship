import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";

/**
 * Removes a member from the system completely: their account (so they can't sign in), the
 * Telegram link (the bot stops knowing them), their photo and receipts in R2, and everything
 * tied to them (department places, fast registrations, meals, attendance, contributions).
 * Approved money stays in the ledger, and gifts stay (without the link to the person).
 */
export async function deleteMember(env: Env, db: Db, memberId: string, byUserId: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const m = await db.query.members.findFirst({
    where: eq(schema.members.id, memberId),
    columns: { id: true, userId: true, fullName: true, photoKey: true, studentIdKey: true },
  });
  if (!m) return { ok: false, error: "That member no longer exists." };
  if (m.userId === byUserId) return { ok: false, error: "You can't remove yourself." };
  const u = await db.query.user.findFirst({ where: eq(schema.user.id, m.userId), columns: { position: true, telegramId: true } });
  if (u?.position) return { ok: false, error: `${m.fullName} holds a ጽህፈት ቤት position. Remove the position first (Roles & positions).` };

  const receipts = await db.select({ key: schema.contributions.receiptKey }).from(schema.contributions).where(eq(schema.contributions.memberId, m.id));
  const keys = [m.photoKey, ...receipts.map((r) => r.key)].filter((k): k is string => Boolean(k));

  const statements = [
    // Deleting the user cascades to sessions, sign-in accounts (incl. Telegram), the member row and all their records
    db.delete(schema.user).where(eq(schema.user.id, m.userId)),
    ...(u?.telegramId ? [db.delete(schema.telegramContacts).where(eq(schema.telegramContacts.telegramId, u.telegramId))] : []),
    ...(m.studentIdKey ? [db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.key, m.studentIdKey))] : []),
  ];
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  // Files last: if this fails the person is still gone; leftover files are harmless
  if (keys.length) await env.MEDIA.delete(keys).catch((err) => console.warn("R2 delete failed", err));
  return { ok: true, name: m.fullName };
}
