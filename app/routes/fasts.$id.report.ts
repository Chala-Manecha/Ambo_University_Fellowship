import { eq, sql } from "drizzle-orm";
import type { Route } from "./+types/fasts.$id.report";
import { getDb, schema } from "../db";
import { MEALS_PER_DAY } from "../lib/fasts";
import { loadRegistrants } from "../lib/fasts.server";
import { requirePermission } from "../lib/session.server";

const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Report for the university: student ID, name, meals a day, and meals actually eaten. Nothing else. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "fast:scan");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, params.id), columns: { id: true, name: true } });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const [people, totals] = await Promise.all([
    loadRegistrants(db, fast.id),
    db
      .select({ memberId: schema.fastCheckins.memberId, meals: sql<number>`count(*)`, days: sql<number>`count(distinct ${schema.fastCheckins.date})` })
      .from(schema.fastCheckins)
      .where(eq(schema.fastCheckins.fastId, fast.id))
      .groupBy(schema.fastCheckins.memberId),
  ]);
  const byMember = new Map(totals.map((t) => [t.memberId, t]));
  const lines = [
    ["No", "Student ID", "Full name", "Meals per day", "Meals eaten", "Days eaten"].map(cell).join(","),
    ...people.map((p, i) =>
      [i + 1, p.studentId, p.fullName, MEALS_PER_DAY[p.fastType], byMember.get(p.memberId)?.meals ?? 0, byMember.get(p.memberId)?.days ?? 0].map(cell).join(","),
    ),
  ];
  const name = fast.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "fast";
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}-report.csv"; filename*=UTF-8''${encodeURIComponent(name)}-report.csv`,
      "Cache-Control": "private, no-store",
    },
  });
}
