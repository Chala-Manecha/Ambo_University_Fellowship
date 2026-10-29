import { desc, eq, isNull } from "drizzle-orm";
import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/attendance";
import { getDb, schema } from "../db";
import { sessionSchema, todayInAddis } from "../lib/departments";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Fellowship attendance · Gibi Gubae" }];
}

/** Whole-fellowship sessions (no department), taken by admins. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "attendance:fellowship");
  const db = getDb(env.DB);
  const sessions = await db
    .select({ id: schema.attendanceSessions.id, title: schema.attendanceSessions.title, date: schema.attendanceSessions.date })
    .from(schema.attendanceSessions)
    .where(isNull(schema.attendanceSessions.departmentId))
    .orderBy(desc(schema.attendanceSessions.date), desc(schema.attendanceSessions.createdAt))
    .limit(50);
  const present = await db
    .select({ sessionId: schema.attendanceRecords.sessionId })
    .from(schema.attendanceRecords)
    .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, schema.attendanceRecords.sessionId))
    .where(isNull(schema.attendanceSessions.departmentId));
  const count = new Map<string, number>();
  for (const p of present) count.set(p.sessionId, (count.get(p.sessionId) ?? 0) + 1);
  return { today: todayInAddis(), sessions: sessions.map((s) => ({ ...s, recorded: count.get(s.id) ?? 0 })) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "attendance:fellowship");
  const form = await request.formData();
  const parsed = sessionSchema.safeParse({ title: form.get("title"), date: form.get("date") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the session details." };
  const [s] = await getDb(env.DB)
    .insert(schema.attendanceSessions)
    .values({ ...parsed.data, departmentId: null, createdBy: user.id })
    .returning({ id: schema.attendanceSessions.id });
  throw redirect(`/attendance/${s.id}`);
}

export default function FellowshipAttendance({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  return (
    <section className="page">
      <p className="muted"><Link to="/admin">← Admin</Link></p>
      <h1>Fellowship attendance</h1>
      <p className="muted">For programs the whole fellowship attends. Department attendance is on each department's page.</p>
      <Form method="post" className="inline-form">
        <label className="field">
          <span>Title</span>
          <input name="title" required maxLength={80} placeholder="Sunday program" />
        </label>
        <label className="field">
          <span>Date</span>
          <input name="date" type="date" required defaultValue={loaderData.today} />
        </label>
        <button className="btn btn-primary" disabled={nav.state !== "idle"}>Take attendance</button>
      </Form>
      {actionData?.error && <p className="form-error" role="alert">{actionData.error}</p>}
      {loaderData.sessions.length > 0 ? (
        <ul className="session-list">
          {loaderData.sessions.map((s) => (
            <li key={s.id}>
              <Link to={`/attendance/${s.id}`}>{s.date} · {s.title}</Link>
              <span className="muted"> — {s.recorded} recorded</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No sessions yet.</p>
      )}
    </section>
  );
}
