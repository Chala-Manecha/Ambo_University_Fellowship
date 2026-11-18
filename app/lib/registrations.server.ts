import { and, eq } from "drizzle-orm";
import { MEMBER_DECISION } from "../content/bot";
import { schema, type Db } from "../db";
import { sendMessage } from "./bot.server";
import { reviewTransition } from "./registration";

/** Approves or rejects a pending registration and tells the member (and department leaders) on Telegram. */
export async function reviewRegistration(env: Env, ctx: ExecutionContext, db: Db, reviewerId: string, id: string, decision: "approve" | "reject") {
  const member = await db.query.members.findFirst({
    where: eq(schema.members.id, id),
    columns: { status: true },
  });
  if (!member) throw new Response("Registration not found", { status: 404 });

  const next = reviewTransition(member.status, decision);
  if (!next) return { message: "This registration was already reviewed." };

  // status guard in WHERE prevents two reviewers racing on the same row
  const updated = await db
    .update(schema.members)
    .set({ status: next, reviewedBy: reviewerId, reviewedAt: new Date() })
    .where(and(eq(schema.members.id, id), eq(schema.members.status, "pending")))
    .returning({ userId: schema.members.userId, contentLanguage: schema.members.contentLanguage });

  // Tell the member on Telegram, in the language they chose
  const row = updated[0];
  if (row) {
    const u = await db.query.user.findFirst({ where: eq(schema.user.id, row.userId), columns: { telegramId: true } });
    if (u?.telegramId) {
      const text = MEMBER_DECISION[row.contentLanguage][next === "active" ? "approved" : "rejected"];
      ctx.waitUntil(sendMessage(env, u.telegramId, text));
    }
  }

  // Approving the registration also puts them in the departments they chose on the form
  if (row && next === "active") {
    await db
      .update(schema.departmentMembers)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(schema.departmentMembers.memberId, id), eq(schema.departmentMembers.status, "pending")));
  }

  return { message: next === "active" ? "Registration approved." : "Registration rejected." };
}
