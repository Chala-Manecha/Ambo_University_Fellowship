import { asc, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import type { MemberListRow } from "./member-filters";

/** Everyone (pending and active) with their active departments, for the members list and CSV. */
export async function loadMemberList(db: Db): Promise<MemberListRow[]> {
  const rows = await db
    .select({
      id: schema.members.id,
      fullName: schema.members.fullName,
      christianName: schema.members.christianName,
      title: schema.members.title,
      gender: schema.members.gender,
      studentId: schema.members.studentId,
      fieldOfStudy: schema.members.fieldOfStudy,
      yearOfStudy: schema.members.yearOfStudy,
      phone: schema.members.phone,
      telegramUsername: schema.user.telegramUsername,
      birthDate: schema.members.birthDate,
      services: schema.members.services,
      otherService: schema.members.otherService,
      learning: schema.members.learning,
      status: schema.members.status,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .orderBy(asc(schema.members.fullName));

  const memberships = await db
    .select({ memberId: schema.departmentMembers.memberId, departmentId: schema.departmentMembers.departmentId })
    .from(schema.departmentMembers)
    .where(eq(schema.departmentMembers.status, "active"));
  const byMember = new Map<string, string[]>();
  for (const m of memberships) byMember.set(m.memberId, [...(byMember.get(m.memberId) ?? []), m.departmentId]);

  return rows.map((r) => ({ ...r, departments: byMember.get(r.id) ?? [] }));
}
