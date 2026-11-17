import { and, asc, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { Link, redirect, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/dashboard";
import type { loader as rootLoader } from "../root";
import { DashCard, Tile, Tiles } from "../components/Dash";
import { LEARNING, SERVICES } from "../content/member-options";
import { getDb, schema } from "../db";
import { departmentStats, memberStats } from "../lib/dashboard";
import { dueMonth, formatMonth } from "../lib/contributions";
import { monthPayRows, pendingContributions } from "../lib/contributions.server";
import { canListMembers, canManageDues, departmentName, isPosition, POSITION_LABELS, todayInAddis } from "../lib/departments";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { formatEc } from "../lib/ethiopian-date";
import { isFastOn, MEAL_LABELS } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { can, hasDashboard } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Dashboard · Gibi Gubae" }];
}

export const ROLE_LABELS = { member: "Member", dept_leader: "Department leader", finance: "Finance", cafe: "Cafe coordinator", admin: "Admin" } as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const leaderOf = await getLeaderDepartmentIds(db, user.id);
  if (!hasDashboard(user.role) && leaderOf.length === 0) throw redirect("/account");
  const today = todayInAddis();
  const role = user.role;
  const position = (await db.query.user.findFirst({ where: eq(schema.user.id, user.id), columns: { position: true } }))?.position ?? null;

  // Members: counts by status, gender, year, and what people want to serve in / learn
  const members = canListMembers(role, leaderOf)
    ? memberStats(
        (
          await db
            .select({
              status: schema.members.status,
              gender: schema.members.gender,
              yearOfStudy: schema.members.yearOfStudy,
              birthDate: schema.members.birthDate,
              services: schema.members.services,
              learning: schema.members.learning,
              createdAt: schema.members.createdAt,
            })
            .from(schema.members)
        ).map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
        Date.now(),
      )
    : null;

  // Departments: admins see all, leaders see their own
  const isAdmin = can(role, "department:manage");
  const deptIds = isAdmin ? null : leaderOf;
  const depts =
    deptIds && deptIds.length === 0
      ? []
      : await db.query.departments.findMany({
          where: deptIds ? inArray(schema.departments.id, deptIds) : undefined,
          orderBy: asc(schema.departments.sortOrder),
        });
  const ids = depts.map((d) => d.id);
  const departments = ids.length
    ? departmentStats(
        ids,
        await db
          .select({ departmentId: schema.departmentMembers.departmentId, role: schema.departmentMembers.role, status: schema.departmentMembers.status })
          .from(schema.departmentMembers)
          .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
          .where(and(inArray(schema.departmentMembers.departmentId, ids), eq(schema.members.status, "active"))),
        (
          await db
            .select({ departmentId: schema.attendanceSessions.departmentId, status: schema.attendanceRecords.status })
            .from(schema.attendanceRecords)
            .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, schema.attendanceRecords.sessionId))
            .where(inArray(schema.attendanceSessions.departmentId, ids))
        ).map((r) => ({ departmentId: r.departmentId!, status: r.status })),
      ).map((s) => ({ ...s, ...depts.find((d) => d.id === s.id)! }))
    : [];

  // Fasts happening now or coming up
  const fasts = can(role, "fast:scan")
    ? await (async () => {
        const list = await db.query.fasts.findMany({ where: gte(schema.fasts.endDate, today), orderBy: asc(schema.fasts.startDate), limit: 3 });
        return Promise.all(
          list.map(async (f) => {
            const [reg] = await db.select({ n: count() }).from(schema.fastRegistrations).where(eq(schema.fastRegistrations.fastId, f.id));
            const meals = await db
              .select({ meal: schema.fastCheckins.meal, n: count() })
              .from(schema.fastCheckins)
              .where(and(eq(schema.fastCheckins.fastId, f.id), eq(schema.fastCheckins.date, today)))
              .groupBy(schema.fastCheckins.meal);
            return { ...f, isOn: isFastOn(f, today), registered: reg.n, today: f.meals.map((m) => ({ meal: m, n: meals.find((x) => x.meal === m)?.n ?? 0 })) };
          }),
        );
      })()
    : null;

  // Monthly contributions: admins and ባች እና ዲፓርትመንት leaders
  const dues = canManageDues(role, leaderOf)
    ? await (async () => {
        const month = dueMonth(today);
        const [pending, pay] = await Promise.all([pendingContributions(db), monthPayRows(db, month)]);
        return {
          month,
          toReview: pending.length,
          paid: pay.rows.filter((r) => r.status === "approved").length,
          waiting: pay.rows.filter((r) => r.status === "pending").length,
          unpaid: pay.rows.filter((r) => r.status === "unpaid").length,
          collected: pay.collected,
        };
      })()
    : null;

  // Recent whole-fellowship attendance
  const fellowship = can(role, "attendance:fellowship")
    ? await db
        .select({ id: schema.attendanceSessions.id, title: schema.attendanceSessions.title, date: schema.attendanceSessions.date })
        .from(schema.attendanceSessions)
        .where(isNull(schema.attendanceSessions.departmentId))
        .orderBy(desc(schema.attendanceSessions.date))
        .limit(3)
    : null;

  return {
    name: user.name,
    role,
    position,
    today,
    isAdmin,
    canManage: can(role, "member:manage"),
    members,
    departments,
    fasts,
    fellowship,
    dues,
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const { name, role, position, today, isAdmin, canManage, members, departments, fasts, fellowship, dues } = loaderData;
  const requests = departments.reduce((n, d) => n + d.requests, 0);

  return (
    <div className="dash">
      <header className="dash-hero">
        <div className="dash-hero-inner">
          <p className="dash-date" lang={lang}>{formatEc(today, lang)}</p>
          <h1>Hello, {name}</h1>
          <span className="dash-role">{ROLE_LABELS[role]}</span>
          {isPosition(position) && <span className="dash-role" lang={lang}>{POSITION_LABELS[position][lang]}</span>}
        </div>
      </header>

      <div className="dash-body">
        {members && !canManage && (
          <Link to="/members" className="dash-alert">👥 Open the members list</Link>
        )}
        {members && members.pending > 0 && canManage && (
          <Link to="/admin/registrations" className="dash-alert">📝 {members.pending} registration{members.pending === 1 ? "" : "s"} waiting for review</Link>
        )}
        {requests > 0 && (
          <Link to={departments.length === 1 ? `/departments/${departments[0].id}?tab=requests` : "#d-depts"} className="dash-alert">
            🙋 {requests} department join request{requests === 1 ? "" : "s"} to review
          </Link>
        )}

        {members && (
          <DashCard id="d-members" title="Members">
            <Tiles>
              {canManage && <Tile to="/admin/registrations" n={members.pending} label="Waiting for review" tone={members.pending ? "gold" : "slate"} />}
              <Tile to="/members" n={members.active} label="Active members" />
              <Tile to="/members?gender=male" n={members.male} label="Male" tone="slate" />
              <Tile to="/members?gender=female" n={members.female} label="Female" tone="slate" />
              <Tile to="/members" n={members.newLast30} label="New in 30 days" tone="green" />
            </Tiles>
            <div className="dash-two">
              <div className="table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Year of study</th><th className="num">Members</th></tr></thead>
                  <tbody>
                    {members.byYear.map((y) => (
                      <tr key={y.key}>
                        <td><Link to={`/members?year=${y.key}`}>{y.key === "g" ? formatYear(0) : formatYear(Number(y.key))}</Link></td>
                        <td className="num">{y.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Want to serve in</th><th className="num">#</th></tr></thead>
                  <tbody>
                    {members.services.map((s) => (
                      <tr key={s.key}>
                        <td lang={lang}>{SERVICES[s.key][lang]}</td>
                        <td className="num">{s.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Want to learn</th><th className="num">#</th></tr></thead>
                  <tbody>
                    {members.learning.map((s) => (
                      <tr key={s.key}>
                        <td lang={lang}>{LEARNING[s.key][lang]}</td>
                        <td className="num">{s.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </DashCard>
        )}

        {dues && (
          <DashCard id="d-dues" title={<>Contributions · <span lang={lang}>{formatMonth(dues.month, lang)}</span></>}>
            <Tiles>
              <Tile to="/dues?tab=review" n={dues.toReview} label="To review" tone={dues.toReview ? "gold" : "slate"} />
              <Tile to="/dues?tab=month&status=approved" n={dues.paid} label="Paid" tone="green" />
              <Tile to="/dues?tab=month&status=pending" n={dues.waiting} label="Waiting review" tone="slate" />
              <Tile to="/dues?tab=month&status=unpaid" n={dues.unpaid} label="Not paid" tone={dues.unpaid ? "red" : "slate"} />
              <Tile to="/dues?tab=month" n={`${dues.collected.toLocaleString("en-US")} birr`} label="Collected" tone="green" />
            </Tiles>
          </DashCard>
        )}

        {departments.length > 0 && (
          <DashCard id="d-depts" title={isAdmin ? "Departments" : departments.length === 1 ? "My department" : "My departments"}>
            <div className="table-wrap">
              <table className="dash-table">
                <thead>
                  <tr><th>Department</th><th className="num">Members</th><th className="num">Requests</th><th className="num">Leaders</th><th className="num">Attendance</th></tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.id}>
                      <td lang={lang}><Link to={`/departments/${d.id}`}>{departmentName(d, lang)}</Link></td>
                      <td className="num"><Link to={`/departments/${d.id}`}>{d.members}</Link></td>
                      <td className="num">{d.requests ? <Link to={`/departments/${d.id}?tab=requests`} className="pill pill-pending">{d.requests}</Link> : 0}</td>
                      <td className="num">{d.leaders || <span className="muted" title="No leader yet">—</span>}</td>
                      <td className="num">{d.rate === null ? "—" : `${d.rate}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DashCard>
        )}

        {fasts && (
          <DashCard id="d-fasts" title="Fasts & cafe">
            {fasts.length === 0 ? (
              <p className="muted">No fasts coming up. <Link to="/fasts">Create one</Link></p>
            ) : (
              fasts.map((f) => (
                <div key={f.id}>
                  <p>
                    <Link to={`/fasts/${f.id}`}><strong>{f.name}</strong></Link>{" "}
                    <span className="muted" lang={lang}>{formatEc(f.startDate, lang)} – {formatEc(f.endDate, lang)}</span>{" "}
                    {f.isOn && <span className="pill pill-active">Now</span>}
                  </p>
                  <Tiles>
                    <Tile to={`/fasts/${f.id}`} n={f.registered} label="Registered" />
                    {f.isOn && f.today.map((m) => (
                      <Tile key={m.meal} to={`/fasts/${f.id}/scan`} n={m.n} label={`${MEAL_LABELS[m.meal][lang]} today`} lang={lang} tone="green" />
                    ))}
                  </Tiles>
                </div>
              ))
            )}
          </DashCard>
        )}

        {fellowship && (
          <DashCard id="d-attendance" title="Fellowship attendance">
            {fellowship.length === 0 ? (
              <p className="muted">No sessions yet. <Link to="/attendance">Take attendance</Link></p>
            ) : (
              <ul className="dash-list">
                {fellowship.map((s) => (
                  <li key={s.id}>
                    <Link to={`/attendance/${s.id}`}>{s.title}</Link>
                    <span className="muted" lang={lang}>{formatEc(s.date, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p><Link to="/attendance">All sessions →</Link></p>
          </DashCard>
        )}

        {canManage && (
          <DashCard id="d-admin" title="Admin tools">
            <div className="dash-links">
              <Link to="/members" className="btn btn-quiet btn-sm">👥 Members</Link>
              <Link to="/admin/registrations" className="btn btn-quiet btn-sm">📝 Registrations</Link>
              <Link to="/admin/members" className="btn btn-quiet btn-sm">🎖️ Roles & positions</Link>
              <Link to="/attendance" className="btn btn-quiet btn-sm">✅ Fellowship attendance</Link>
              <Link to="/fasts" className="btn btn-quiet btn-sm">🍲 Fasts</Link>
              <Link to="/dues" className="btn btn-quiet btn-sm">💳 Contributions</Link>
              <Link to="/admin/telegram" className="btn btn-quiet btn-sm">🤖 Telegram bot</Link>
            </div>
          </DashCard>
        )}

        <p className="dash-me"><Link to="/account">My account →</Link></p>
      </div>
    </div>
  );
}
