import { eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { DEFAULT_DUES, EMPTY_ACCOUNT, type Dues, type PayAccount } from "./contributions";

export async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return (row?.value as T) ?? null;
}

export async function setSetting(db: Db, key: string, value: unknown, userId: string | null) {
  await db
    .insert(schema.settings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

export async function getDues(db: Db): Promise<Dues> {
  const v = await getSetting<Partial<Dues>>(db, "dues");
  return {
    student: Number.isInteger(v?.student) ? v!.student! : DEFAULT_DUES.student,
    graduate: Number.isInteger(v?.graduate) ? v!.graduate! : DEFAULT_DUES.graduate,
  };
}

export async function getPayAccount(db: Db): Promise<PayAccount> {
  return { ...EMPTY_ACCOUNT, ...((await getSetting<Partial<PayAccount>>(db, "pay_account")) ?? {}) };
}
