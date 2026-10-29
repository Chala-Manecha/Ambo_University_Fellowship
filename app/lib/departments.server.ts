import { and, eq } from "drizzle-orm";
import { schema, type Db } from "../db";

/** The member record for a login, or null if they haven't registered. */
export function getMemberByUser(db: Db, userId: string) {
  return db.query.members.findFirst({
    where: eq(schema.members.userId, userId),
    columns: { id: true, status: true, fullName: true, contentLanguage: true },
  });
}

/** Ids of the departments this login actively leads. */
export async function getLeaderDepartmentIds(db: Db, userId: string) {
  const rows = await db
    .select({ departmentId: schema.departmentMembers.departmentId })
    .from(schema.departmentMembers)
    .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
    .where(
      and(
        eq(schema.members.userId, userId),
        eq(schema.departmentMembers.role, "leader"),
        eq(schema.departmentMembers.status, "active"),
      ),
    );
  return rows.map((r) => r.departmentId);
}

/** Telegram ids of a department's active leaders (for join-request alerts). */
export async function getDepartmentLeaderTelegramIds(db: Db, departmentId: string) {
  const rows = await db
    .select({ telegramId: schema.user.telegramId })
    .from(schema.departmentMembers)
    .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(
      and(
        eq(schema.departmentMembers.departmentId, departmentId),
        eq(schema.departmentMembers.role, "leader"),
        eq(schema.departmentMembers.status, "active"),
      ),
    );
  return rows.map((r) => r.telegramId).filter((id): id is string => Boolean(id));
}
