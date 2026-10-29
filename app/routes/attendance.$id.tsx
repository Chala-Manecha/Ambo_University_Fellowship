import { and, asc, eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/attendance.$id";
import type { loader as rootLoader } from "../root";
import { getDb, schema, type Db } from "../db";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  attendanceRate,
  canTakeAttendance,
  departmentName,
  parseAttendanceForm,
} from "../lib/departments";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { DEFAULT_LANG } from "../lib/lang";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Attendance · Gibi Gubae" }];
}

/** Loads the session, checks access, and returns who should be on its roster. */
async function load(request: Request, env: Env, db: Db, sessionId: string) {
  const user = await requireUser(request, env);
  const session = await db.query.attendanceSessions.findFirst({ where: eq(schema.attendanceSessions.id, sessionId) });
  if (!session) throw new Response("Session not found", { status: 404 });
  const leaderOf = await getLeaderDepartmentIds(db, user.id);
  if (!canTakeAttendance(user.role, leaderOf, session.departmentId)) {
    throw new Response("You can't take attendance for this session.", { status: 403 });
  }

  // Department session: the department's active members. Fellowship session: every active member.
  const roster = session.departmentId
    ? await db
        .select({ memberId: schema.members.id, fullName: schema.members.fullName })
        .from(schema.departmentMembers)
        .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
        .where(
          and(
            eq(schema.departmentMembers.departmentId, session.departmentId),
            eq(schema.departmentMembers.status, "active"),
            eq(schema.members.status, "active"),
          ),
        )
        .orderBy(asc(schema.members.fullName))
    : await db
        .select({ memberId: schema.members.id, fullName: schema.members.fullName })
        .from(schema.members)
        .where(eq(schema.members.status, "active"))
        .orderBy(asc(schema.members.fullName));

  const dept = session.departmentId
    ? await db.query.departments.findFirst({ where: eq(schema.departments.id, session.departmentId) })
    : null;
  return { user, session, roster, dept };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { session, roster, dept } = await load(request, env, db, params.id);
  const records = await db
    .select({ memberId: schema.attendanceRecords.memberId, status: schema.attendanceRecords.status })
    .from(schema.attendanceRecords)
    .where(eq(schema.attendanceRecords.sessionId, session.id));
  const recorded = new Map(records.map((r) => [r.memberId, r.status]));
  return {
    session,
    dept,
    backTo: session.departmentId ? `/departments/${session.departmentId}` : "/attendance",
    rows: roster.map((r) => ({ ...r, status: recorded.get(r.memberId) ?? null })),
    summary: attendanceRate(records.map((r) => r.status)),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, session, roster } = await load(request, env, db, params.id);
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    await db.delete(schema.attendanceSessions).where(eq(schema.attendanceSessions.id, session.id));
    throw redirect(session.departmentId ? `/departments/${session.departmentId}` : "/attendance");
  }

  // Only people on the roster are saved; anything else in the form is ignored
  const marks = parseAttendanceForm(form, roster.map((r) => r.memberId));
  if (marks.size === 0) return { message: "Mark at least one person." };
  const statements = [...marks].map(([memberId, status]) =>
    db
      .insert(schema.attendanceRecords)
      .values({ sessionId: session.id, memberId, status, recordedBy: user.id })
      .onConflictDoUpdate({
        target: [schema.attendanceRecords.sessionId, schema.attendanceRecords.memberId],
        set: { status, recordedBy: user.id, updatedAt: new Date() },
      }),
  );
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return { message: `Saved ${marks.size} of ${roster.length}.` };
}

export default function TakeAttendance({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { session, dept, backTo, rows, summary } = loaderData;

  return (
    <section className="page narrow">
      <p className="muted"><Link to={backTo}>← Back</Link></p>
      <h1>{session.title}</h1>
      <p className="muted">
        {session.date} · {dept ? <span lang={lang}>{departmentName(dept, lang)}</span> : "Whole fellowship"} · {summary.present} present,{" "}
        {summary.absent} absent, {summary.excused} excused
      </p>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      {rows.length === 0 ? (
        <p>No members to mark yet.</p>
      ) : (
        <Form method="post" className="attendance-form">
          <ul className="roster">
            {rows.map((r) => (
              <li key={r.memberId}>
                <span className="roster-name">{r.fullName}</span>
                <span className="segmented" role="radiogroup" aria-label={`Attendance for ${r.fullName}`}>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <label key={s} className={`seg seg-${s}`}>
                      <input type="radio" name={`status:${r.memberId}`} value={s} defaultChecked={r.status === s} />
                      <span>{ATTENDANCE_LABELS[s]}</span>
                    </label>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save attendance"}</button>
        </Form>
      )}

      <Form
        method="post"
        className="danger-zone"
        onSubmit={(e) => {
          if (!window.confirm("Delete this session and its attendance?")) e.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete" />
        <button className="btn btn-quiet btn-sm" disabled={busy}>Delete session</button>
      </Form>
    </section>
  );
}
