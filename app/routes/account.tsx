import { and, desc, eq, ne } from "drizzle-orm";
import { Form, Link, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/account";
import { getDb, schema } from "../db";
import { attendanceRate, ATTENDANCE_LABELS, departmentName, isPosition, POSITION_LABELS } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "My account · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await db.query.members.findFirst({
    where: eq(schema.members.userId, user.id),
    columns: { id: true, status: true, fullName: true, createdAt: true },
  });
  const justRegistered = new URL(request.url).searchParams.has("registered");
  const position = (await db.query.user.findFirst({ where: eq(schema.user.id, user.id), columns: { position: true } }))?.position ?? null;
  if (!member) return { user, member: null, justRegistered, position, departments: [], attendance: [], rate: attendanceRate([]) };

  const departments = await db
    .select({
      id: schema.departments.id,
      nameOm: schema.departments.nameOm,
      nameAm: schema.departments.nameAm,
      role: schema.departmentMembers.role,
      status: schema.departmentMembers.status,
    })
    .from(schema.departmentMembers)
    .innerJoin(schema.departments, eq(schema.departments.id, schema.departmentMembers.departmentId))
    .where(and(eq(schema.departmentMembers.memberId, member.id), ne(schema.departmentMembers.status, "rejected")));

  const attendance = await db
    .select({
      sessionId: schema.attendanceSessions.id,
      title: schema.attendanceSessions.title,
      date: schema.attendanceSessions.date,
      status: schema.attendanceRecords.status,
      nameOm: schema.departments.nameOm,
      nameAm: schema.departments.nameAm,
    })
    .from(schema.attendanceRecords)
    .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, schema.attendanceRecords.sessionId))
    .leftJoin(schema.departments, eq(schema.departments.id, schema.attendanceSessions.departmentId))
    .where(eq(schema.attendanceRecords.memberId, member.id))
    .orderBy(desc(schema.attendanceSessions.date));

  return {
    user,
    member,
    justRegistered,
    position,
    departments,
    attendance: attendance.slice(0, 15),
    rate: attendanceRate(attendance.map((a) => a.status)),
  };
}

const STATUS_TEXT = {
  pending: "Your registration is waiting for review by the fellowship leaders.",
  active: "You're a registered member.",
  rejected: "Your registration wasn't approved. Contact a fellowship leader on Telegram.",
  alumni: "You're listed as an alumnus. Thank you for your service.",
} as const;

export default function Account({ loaderData }: Route.ComponentProps) {
  const { user, member, justRegistered, position, departments, attendance, rate } = loaderData;
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  return (
    <section className="page narrow">
      <h1>My account</h1>
      {justRegistered && <p className="notice" role="status">Registration submitted.</p>}
      <div className="account-id">
        {user.image && <img src={user.image} alt="" width={56} height={56} />}
        <div>
          <strong>{user.name}</strong>
          {user.telegramUsername && <span className="muted">@{user.telegramUsername}</span>}
          {isPosition(position) && <span className="pill pill-active" lang={lang}>{POSITION_LABELS[position][lang]}</span>}
        </div>
      </div>

      {member ? (
        <p className={`status status-${member.status}`}>{STATUS_TEXT[member.status]}</p>
      ) : (
        <p>
          You haven't registered as a member yet. <Link to="/register">Register now</Link>
        </p>
      )}

      {member?.status === "active" && (
        <>
          <h2>My departments</h2>
          {departments.length === 0 ? (
            <p className="muted">
              You haven't joined a department yet. <Link to="/departments">See departments</Link>
            </p>
          ) : (
            <ul className="session-list">
              {departments.map((d) => (
                <li key={d.id}>
                  <span lang={lang}>{departmentName(d, lang)}</span>{" "}
                  <span className={`pill pill-${d.status}`}>
                    {d.status === "pending" ? "Request sent" : d.role === "leader" ? "Leader" : "Member"}
                  </span>
                  {d.role === "leader" && d.status === "active" && (
                    <> · <Link to={`/departments/${d.id}`}>Manage</Link></>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h2>My attendance</h2>
          {attendance.length === 0 ? (
            <p className="muted">No attendance recorded yet.</p>
          ) : (
            <>
              <p>
                {rate.percent === null ? "—" : `${rate.percent}%`} attended ({rate.present} present, {rate.absent} absent, {rate.excused} excused)
              </p>
              <ul className="session-list">
                {attendance.map((a) => (
                  <li key={a.sessionId}>
                    {a.date} · {a.title}{" "}
                    <span className="muted" lang={lang}>
                      ({a.nameOm && a.nameAm ? departmentName({ nameOm: a.nameOm, nameAm: a.nameAm }, lang) : "Whole fellowship"})
                    </span>{" "}
                    <span className={`pill pill-${a.status}`}>{ATTENDANCE_LABELS[a.status]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <Form method="post" action="/logout">
        <button className="btn btn-quiet">Sign out</button>
      </Form>
    </section>
  );
}
