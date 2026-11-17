/**
 * How people sign in, using the Better Auth tables directly:
 *  - Telegram: an `account` row with providerId "telegram", accountId = Telegram user id
 *  - Website:  an `account` row with providerId "password", holding the PBKDF2 hash
 * On the website members sign in with their student ID (members.student_id_key -> user).
 */
import { and, eq, lt } from "drizzle-orm";
import { schema, type Db } from "../db";
import { afterFailure, isLocked } from "./login-limit";
import { studentIdKey } from "./registration";

export const TELEGRAM = "telegram";
export const PASSWORD = "password";

export type TgProfile = { id: number; name: string; username?: string | null; photoUrl?: string | null };

export async function userIdForTelegram(db: Db, telegramId: number | string) {
  const row = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, TELEGRAM), eq(schema.account.accountId, String(telegramId))),
    columns: { userId: true },
  });
  return row?.userId ?? null;
}

/** A user without Telegram (registered on the website). */
export async function createWebUser(db: Db, name: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({ id, name, email: `u-${id}@users.invalid` });
  return id;
}

export type LinkError = "telegram_taken" | "account_has_telegram";

/** Ties a Telegram account to an existing website user. One Telegram account per user and vice versa. */
export async function linkTelegram(db: Db, userId: string, tg: TgProfile): Promise<LinkError | null> {
  const owner = await userIdForTelegram(db, tg.id);
  if (owner === userId) return null;
  if (owner) return "telegram_taken";
  const has = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, TELEGRAM), eq(schema.account.userId, userId)),
    columns: { id: true },
  });
  if (has) return "account_has_telegram";
  await db.insert(schema.account).values({ id: crypto.randomUUID(), providerId: TELEGRAM, accountId: String(tg.id), userId });
  await db
    .update(schema.user)
    .set({ telegramId: String(tg.id), telegramUsername: tg.username ?? null, ...(tg.photoUrl ? { image: tg.photoUrl } : {}) })
    .where(eq(schema.user.id, userId));
  return null;
}

export async function getPasswordHash(db: Db, userId: string) {
  const row = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, PASSWORD), eq(schema.account.userId, userId)),
    columns: { password: true },
  });
  return row?.password ?? null;
}

export async function setPasswordHash(db: Db, userId: string, hash: string) {
  const updated = await db
    .update(schema.account)
    .set({ password: hash })
    .where(and(eq(schema.account.providerId, PASSWORD), eq(schema.account.userId, userId)))
    .returning({ id: schema.account.id });
  if (updated.length === 0) {
    await db.insert(schema.account).values({ id: crypto.randomUUID(), providerId: PASSWORD, accountId: userId, userId, password: hash });
  }
}

export async function clearPassword(db: Db, userId: string) {
  await db.delete(schema.account).where(and(eq(schema.account.providerId, PASSWORD), eq(schema.account.userId, userId)));
}

/** "UGR/1/12" finds a member registered as "ugr 1-12". */
export async function memberByStudentId(db: Db, studentId: string) {
  const key = studentIdKey(studentId);
  if (!key) return undefined;
  return db.query.members.findFirst({ where: eq(schema.members.studentIdKey, key), columns: { id: true, userId: true } });
}

/* ---------- Wrong-password lockout ---------- */

export async function loginLocked(db: Db, key: string, now: number) {
  const a = await db.query.loginAttempts.findFirst({ where: eq(schema.loginAttempts.key, key) });
  return isLocked(a, now);
}

export async function recordLoginFailure(db: Db, key: string, now: number) {
  const a = await db.query.loginAttempts.findFirst({ where: eq(schema.loginAttempts.key, key) });
  const next = afterFailure(a, now);
  await db
    .insert(schema.loginAttempts)
    .values({ key, ...next })
    .onConflictDoUpdate({ target: schema.loginAttempts.key, set: next });
}

export async function clearLoginFailures(db: Db, key: string) {
  await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.key, key));
}

/* ---------- Connect Telegram (required for members) ---------- */

export async function isTelegramLinked(db: Db, userId: string) {
  const row = await db.query.account.findFirst({
    where: and(eq(schema.account.providerId, TELEGRAM), eq(schema.account.userId, userId)),
    columns: { id: true },
  });
  return Boolean(row);
}

const LINK_TTL_MS = 30 * 60 * 1000;

/** A one-time code for t.me/<bot>?start=link_<code>. Telegram allows [A-Za-z0-9_-], up to 64 chars. */
export async function createLinkToken(db: Db, userId: string, now = Date.now()) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
  await db.delete(schema.telegramLinkTokens).where(lt(schema.telegramLinkTokens.expiresAt, now)); // tidy old codes
  await db.insert(schema.telegramLinkTokens).values({ token, userId, expiresAt: now + LINK_TTL_MS });
  return token;
}

export type ConsumeResult = { ok: true; userId: string } | { ok: false; reason: "expired" | LinkError };

/** Bot side: the person pressed Start with a link code. Ties their Telegram account to the code's user. */
export async function consumeLinkToken(db: Db, token: string, tg: TgProfile, now = Date.now()): Promise<ConsumeResult> {
  const row = await db.query.telegramLinkTokens.findFirst({ where: eq(schema.telegramLinkTokens.token, token) });
  if (!row || row.expiresAt < now) return { ok: false, reason: "expired" };
  const err = await linkTelegram(db, row.userId, tg);
  if (err) return { ok: false, reason: err };
  await db.delete(schema.telegramLinkTokens).where(eq(schema.telegramLinkTokens.userId, row.userId));
  return { ok: true, userId: row.userId };
}
