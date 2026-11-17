import { and, desc, eq } from "drizzle-orm";
import { schema, type Db } from "../db";
import { sendMessage } from "./bot.server";
import { memberKind, monthKey, type EcMonth } from "./contributions";
import { BATCH_DEPT } from "./departments";
import { getDepartmentLeaderTelegramIds } from "./departments.server";

export type PayStatus = "approved" | "pending" | "unpaid";

/** monthKey -> status for one member (pending or approved claims; anything else is unpaid). */
export async function memberMonthStatus(db: Db, memberId: string) {
  const rows = await db
    .select({ y: schema.contributionMonths.ecYear, m: schema.contributionMonths.ecMonth, status: schema.contributions.status })
    .from(schema.contributionMonths)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
    .where(eq(schema.contributionMonths.memberId, memberId));
  return new Map(rows.map((r) => [monthKey({ year: r.y, month: r.m }), r.status as PayStatus]));
}

export async function memberHistory(db: Db, memberId: string) {
  return db
    .select({
      id: schema.contributions.id,
      amount: schema.contributions.amount,
      months: schema.contributions.months,
      status: schema.contributions.status,
      reviewNote: schema.contributions.reviewNote,
      createdAt: schema.contributions.createdAt,
    })
    .from(schema.contributions)
    .where(eq(schema.contributions.memberId, memberId))
    .orderBy(desc(schema.contributions.createdAt))
    .limit(24);
}

/** Every active member with their status for one month, plus the birr collected for it. */
export async function monthPayRows(db: Db, month: EcMonth) {
  const [active, claims] = await Promise.all([
    db
      .select({
        id: schema.members.id,
        fullName: schema.members.fullName,
        studentId: schema.members.studentId,
        phone: schema.members.phone,
        yearOfStudy: schema.members.yearOfStudy,
        telegramUsername: schema.user.telegramUsername,
      })
      .from(schema.members)
      .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
      .where(eq(schema.members.status, "active")),
    db
      .select({
        memberId: schema.contributionMonths.memberId,
        contributionId: schema.contributions.id,
        note: schema.contributions.note,
        status: schema.contributions.status,
        amount: schema.contributions.amount,
        months: schema.contributions.months,
      })
      .from(schema.contributionMonths)
      .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionMonths.contributionId))
      .where(and(eq(schema.contributionMonths.ecYear, month.year), eq(schema.contributionMonths.ecMonth, month.month))),
  ]);
  const byMember = new Map(claims.map((c) => [c.memberId, c]));
  // A payment for several months is split evenly across them for each month's total
  const collected = Math.round(
    claims.filter((c) => c.status === "approved").reduce((sum, c) => sum + c.amount / Math.max(1, c.months.length), 0),
  );
  const rows = active
    .map((m) => {
      const c = byMember.get(m.id);
      return {
        ...m,
        kind: memberKind(m.yearOfStudy),
        status: (c?.status ?? "unpaid") as PayStatus,
        // The payment covering this month (to see the receipt and review it here)
        payment: c ? { id: c.contributionId, amount: c.amount, months: c.months, note: c.note } : null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { rows, collected };
}

/** Telegram ids of ባች እና ዲፓርትመንት leaders and admins (who review payments). */
export async function duesReviewerTelegramIds(db: Db) {
  const leaders = await getDepartmentLeaderTelegramIds(db, BATCH_DEPT);
  const admins = await db
    .select({ t: schema.user.telegramId })
    .from(schema.user)
    .where(eq(schema.user.role, "admin"));
  return [...new Set([...leaders, ...admins.map((a) => a.t).filter((t): t is string => Boolean(t))])];
}

export async function notifyReviewers(env: Env, db: Db, text: string) {
  const ids = await duesReviewerTelegramIds(db);
  await Promise.all(ids.map((id) => sendMessage(env, id, text)));
}

export async function pendingContributions(db: Db) {
  return db
    .select({
      id: schema.contributions.id,
      amount: schema.contributions.amount,
      monthlyRate: schema.contributions.monthlyRate,
      memberKind: schema.contributions.memberKind,
      months: schema.contributions.months,
      note: schema.contributions.note,
      createdAt: schema.contributions.createdAt,
      fullName: schema.members.fullName,
      studentId: schema.members.studentId,
      phone: schema.members.phone,
    })
    .from(schema.contributions)
    .innerJoin(schema.members, eq(schema.members.id, schema.contributions.memberId))
    .where(eq(schema.contributions.status, "pending"))
    .orderBy(schema.contributions.createdAt);
}


