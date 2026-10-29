import { and, desc, eq, ne } from "drizzle-orm";
import { Form, Link, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/account";
import { getDb, schema } from "../db";
import { attendanceRate, ATTENDANCE_LABELS, departmentName, isPosition, POSITION_LABELS } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { renderSVG } from "uqr";
import { TITLES } from "../content/member-options";
import { formatEc } from "../lib/ethiopian-date";
import { memberQrText } from "../lib/member-qr";
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
    columns: { id: true, status: true, fullName: true, christianName: true, title: true, studentId: true, birthDate: true, createdAt: true },
  });
  const url = new URL(request.url);
  const justRegistered = url.searchParams.has("registered");
  const justUpdated = url.searchParams.has("updated");
  const position = (await db.query.user.findFirst({ where: eq(schema.user.id, user.id), columns: { position: true } }))?.position ?? null;
  if (!member) return { user, member: null, justRegistered, justUpdated, position, qrSvg: null, departments: [], attendance: [], rate: attendanceRate([]) };

  // The QR is only issued once the registration is approved
  const qrSvg = member.status === "active" ? renderSVG(await memberQrText(member.id, env.BETTER_AUTH_SECRET), { border: 2 }) : null;

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
    justUpdated,
    position,
    qrSvg,
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
  const { user, member, justRegistered, justUpdated, position, qrSvg, departments, attendance, rate } = loaderData;
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  return (
    <section className="page narrow">
      <h1>My account</h1>
      {justRegistered && <p className="notice" role="status">Registration submitted.</p>}
      {justUpdated && <p className="notice" role="status">Details saved.</p>}
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

      {member && !member.birthDate && (
        <p className="notice">
          Please complete your details (birth date, where you'd like to serve). <Link to="/account/details">Update my details</Link>
        </p>
      )}

      {member?.status === "active" && qrSvg && (
        <div className="member-card">
          <div className="member-card-info">
            {user.image && <img src={user.image} alt="" width={64} height={64} />}
            <div>
              <strong>
                {member.title && <span lang={lang}>{TITLES[member.title][lang]} </span>}
                {member.fullName}
              </strong>
              {member.christianName && <span className="muted">{member.christianName}</span>}
              <span>Student ID: <b>{member.studentId}</b></span>
              {member.birthDate && <span className="muted" lang={lang}>{formatEc(member.birthDate, lang)}</span>}
            </div>
          </div>
          <div className="member-qr" role="img" aria-label="Your member QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="muted">Show this at the cafe during fasts.</p>
        </div>
      )}

      {member && (
        <p><Link to="/account/details">Update my details</Link></p>
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
                    <span lang={lang}>{formatEc(a.date, lang)}</span> · {a.title}{" "}
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
