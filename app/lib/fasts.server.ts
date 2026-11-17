import { and, asc, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import type { Fast } from "../db/schema";
import { checkinDecision, isFastOn, type CheckinResult, type FastType, type Meal } from "./fasts";

export type Person = { fullName: string; studentId: string; image: string | null; fastType: FastType | null };
export type CheckinResponse = CheckinResult & { person?: Person };

/**
 * Records one meal for one member, following the cafe rules. Used by the QR scanner, the
 * scanner's search, and the daily table. Pending members (registration not reviewed yet)
 * are served too, so new students aren't turned away during the fast.
 */
export async function checkIn(
  db: Db,
  fast: Fast,
  memberId: string | null,
  meal: Meal,
  scannedBy: string,
  today: string,
): Promise<CheckinResponse> {
  const row = memberId
    ? await db
        .select({
          id: schema.members.id,
          status: schema.members.status,
          fullName: schema.members.fullName,
          studentId: schema.members.studentId,
          image: schema.user.image,
        })
        .from(schema.members)
        .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
        .where(eq(schema.members.id, memberId))
        .get()
    : undefined;
  const registration = row
    ? await db.query.fastRegistrations.findFirst({
        where: and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, row.id)),
        columns: { fastType: true },
      })
    : undefined;
  const person: Person | undefined = row
    ? { fullName: row.fullName, studentId: row.studentId, image: row.image, fastType: registration?.fastType ?? null }
    : undefined;

  const blocked = checkinDecision({
    memberFound: Boolean(row),
    memberActive: row?.status === "active" || row?.status === "pending",
    registered: Boolean(registration),
    fastIsOn: isFastOn(fast, today),
    mealAllowed: fast.meals.includes(meal),
    fastType: registration?.fastType ?? null,
    meal,
  });
  if (blocked) return { ...blocked, person };

  // The primary key (fast, member, date, meal) makes a second scan a no-op
  const inserted = await db
    .insert(schema.fastCheckins)
    .values({ fastId: fast.id, memberId: row!.id, date: today, meal, scannedBy })
    .onConflictDoNothing()
    .returning({ createdAt: schema.fastCheckins.createdAt });
  if (inserted.length > 0) return { kind: "ok", person };

  const prev = await db.query.fastCheckins.findFirst({
    where: and(
      eq(schema.fastCheckins.fastId, fast.id),
      eq(schema.fastCheckins.memberId, row!.id),
      eq(schema.fastCheckins.date, today),
      eq(schema.fastCheckins.meal, meal),
    ),
    columns: { createdAt: true },
  });
  return { kind: "already", at: prev?.createdAt.getTime() ?? Date.now(), person };
}

/** Everyone registered for a fast, for the coordinator's lists and the scanner's search. */
export async function loadRegistrants(db: Db, fastId: string) {
  return db
    .select({
      memberId: schema.members.id,
      fullName: schema.members.fullName,
      studentId: schema.members.studentId,
      fastType: schema.fastRegistrations.fastType,
      registeredAt: schema.fastRegistrations.createdAt,
    })
    .from(schema.fastRegistrations)
    .innerJoin(schema.members, eq(schema.members.id, schema.fastRegistrations.memberId))
    .where(eq(schema.fastRegistrations.fastId, fastId))
    .orderBy(asc(schema.members.fullName));
}
