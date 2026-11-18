import { asc, sql } from "drizzle-orm";
import { useRouteLoaderData } from "react-router";
import type { Route } from "./+types/audit";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { getAccess } from "../lib/access.server";
import { dueMonth, formatMonth } from "../lib/contributions";
import { canAudit, departmentName, todayInAddis } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { MEALS_PER_DAY, type FastType } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { formatYear } from "../lib/registration";

export function meta() {
  return [{ title: "Audit report · Gibi Gubae" }];
}

type Row = Record<string, string | number | null>;

/**
 * ኦዲት እና ምርመራ: a read-only report over everything. Every figure is a single counting
 * query (no lists), so the page stays cheap on the free plan however big the fellowship gets.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, leaderOf } = await getAccess(request, env, db);
  if (!canAudit(user.role, leaderOf)) throw new Response("Only ኦዲት እና ምርመራ sees the audit report.", { status: 403 });
  const today = todayInAddis();
  const month = dueMonth(today);
  const now = Date.now();
  const week = now - 7 * 86_400_000;
  const q = <T extends Row>(query: ReturnType<typeof sql>) => db.all<T>(query);

  const [members, years, regsByMonth, depts, money, contrib, gifts, propertyByDept, fasts, usage, issues, paidThisMonth] = await Promise.all([
    q<Row>(sql`select status, gender, content_language as lang, count(*) as n,
      sum(case when photo_key is not null then 1 else 0 end) as photos,
      sum(case when birth_date is null then 1 else 0 end) as noBirth
      from members group by status, gender, content_language`),
    q<Row>(sql`select year_of_study as y, count(*) as n from members where status = 'active' group by year_of_study order by year_of_study`),
    q<Row>(sql`select strftime('%Y-%m', created_at / 1000 + 10800, 'unixepoch') as m, count(*) as n from members group by m order by m desc limit 6`),
    q<Row>(sql`select d.id, d.name_om as nameOm, d.name_am as nameAm,
      sum(case when dm.status = 'active' then 1 else 0 end) as members,
      sum(case when dm.status = 'pending' then 1 else 0 end) as requests,
      sum(case when dm.status = 'active' and dm.role = 'leader' then 1 else 0 end) as leaders,
      (select count(*) from attendance_sessions s where s.department_id = d.id) as sessions
      from departments d left join department_members dm on dm.department_id = d.id
      group by d.id order by d.sort_order`),
    q<Row>(sql`select direction, category, count(*) as n, sum(amount) as total from ledger group by direction, category`),
    q<Row>(sql`select status, count(*) as n, coalesce(sum(amount), 0) as total,
      sum(case when status = 'pending' and created_at < ${week} then 1 else 0 end) as old from contributions group by status`),
    q<Row>(sql`select status, count(*) as n, coalesce(sum(amount), 0) as total,
      sum(case when status = 'pending' and created_at < ${week} then 1 else 0 end) as old from donations group by status`),
    q<Row>(sql`select department_id as d, count(*) as items, sum(quantity) as qty,
      sum(case when source = 'past_leaders' then 1 else 0 end) as inherited from properties group by department_id`),
    q<Row>(sql`select f.id, f.name, f.start_date as startDate, f.end_date as endDate,
      (select count(*) from fast_registrations r where r.fast_id = f.id) as registered,
      (select count(*) from fast_registrations r where r.fast_id = f.id and r.fast_type = 'meat_only') as t3,
      (select count(*) from fast_registrations r where r.fast_id = f.id and r.fast_type = 'no_breakfast') as t2,
      (select count(*) from fast_registrations r where r.fast_id = f.id and r.fast_type = 'dinner_only') as t1,
      (select count(*) from fast_checkins c where c.fast_id = f.id) as meals,
      (select count(*) from fast_checkins c where c.fast_id = f.id and c.date = ${today}) as mealsToday,
      (select count(distinct c.date) from fast_checkins c where c.fast_id = f.id) as days,
      (select count(*) from fast_checkins c where c.fast_id = f.id and c.scanned_by is null) as noScanner,
      (select count(*) from fast_scanners s where s.fast_id = f.id) as scanners
      from fasts f order by f.start_date desc limit 5`),
    q<Row>(sql`select
      (select count(*) from user) as users,
      (select count(*) from user where telegram_id is not null) as telegram,
      (select count(distinct user_id) from session where created_at >= ${week}) as signedInWeek,
      (select count(distinct user_id) from session where expires_at > ${now}) as activeSessions,
      (select count(*) from login_attempts where failures >= 5) as lockouts,
      (select count(*) from songs where released = 1) as songsReleased,
      (select count(*) from songs where released = 0) as songsDraft,
      (select count(*) from attendance_records) as attendanceMarks,
      (select count(*) from fast_checkins where created_at >= ${week}) as scansWeek`),
    q<Row>(sql`select
      (select count(*) from members m join user u on u.id = m.user_id where m.status = 'active' and u.telegram_id is null) as noTelegram,
      (select count(*) from members where status = 'pending' and created_at < ${week}) as oldPending,
      (select count(*) from departments d where not exists (select 1 from department_members dm where dm.department_id = d.id and dm.role = 'leader' and dm.status = 'active')) as noLeader,
      (select count(*) from user where position is not null) as positions`),
    q<Row>(sql`select count(distinct cm.member_id) as n from contribution_months cm join contributions c on c.id = cm.contribution_id
      where c.status = 'approved' and cm.ec_year = ${month.year} and cm.ec_month = ${month.month}`),
  ]);
  const departments = await db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder), columns: { id: true, nameOm: true, nameAm: true } });
  return { today, month, members, years, regsByMonth, depts, money, contrib, gifts, propertyByDept, fasts, usage: usage[0], issues: issues[0], paidThisMonth: Number(paidThisMonth[0]?.n ?? 0), departments };
}

const n = (v: unknown) => Number(v ?? 0);
const birr = (v: unknown) => `${n(v).toLocaleString("en-US")} birr`;

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`audit-stat${warn ? " is-warn" : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const d = loaderData;
  const sum = (rows: Row[], f: (r: Row) => boolean, key = "n") => rows.filter(f).reduce((t, r) => t + n(r[key]), 0);
  const active = (r: Row) => r.status === "active";
  const inTotal = sum(d.money, (r) => r.direction === "in", "total");
  const outTotal = sum(d.money, (r) => r.direction === "out", "total");
  const activeCount = sum(d.members, active);
  const byStatus = (rows: Row[], s: string) => rows.find((r) => r.status === s) ?? {};

  return (
    <section className="page wide audit">
      <div className="table-bar audit-head">
        <span>Report as of <b lang={lang}>{formatEc(d.today, lang)}</b></span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>🖨️ Print</button>
      </div>

      <h2>1. Members</h2>
      <div className="audit-grid">
        <Stat label="Active" value={activeCount} />
        <Stat label="Waiting for review" value={sum(d.members, (r) => r.status === "pending")} warn={n(d.issues.oldPending) > 0} />
        <Stat label="Rejected" value={sum(d.members, (r) => r.status === "rejected")} />
        <Stat label="Male (active)" value={sum(d.members, (r) => active(r) && r.gender === "male")} />
        <Stat label="Female (active)" value={sum(d.members, (r) => active(r) && r.gender === "female")} />
        <Stat label="Afaan Oromoo" value={sum(d.members, (r) => active(r) && r.lang === "om")} />
        <Stat label="አማርኛ" value={sum(d.members, (r) => active(r) && r.lang === "am")} />
        <Stat label="With a photo" value={sum(d.members, active, "photos")} />
        <Stat label="No birth date" value={sum(d.members, active, "noBirth")} warn={sum(d.members, active, "noBirth") > 0} />
      </div>
      <div className="audit-cols">
        <table className="audit-table">
          <thead><tr><th>Year of study</th><th className="num">Active</th></tr></thead>
          <tbody>{d.years.map((y) => <tr key={String(y.y)}><td>{formatYear(n(y.y))}</td><td className="num">{n(y.n)}</td></tr>)}</tbody>
        </table>
        <table className="audit-table">
          <thead><tr><th>Registered in (month)</th><th className="num">People</th></tr></thead>
          <tbody>{d.regsByMonth.map((r) => <tr key={String(r.m)}><td>{String(r.m)}</td><td className="num">{n(r.n)}</td></tr>)}</tbody>
        </table>
      </div>

      <h2>2. Departments</h2>
      <div className="table-wrap">
        <table className="audit-table">
          <thead><tr><th>Department</th><th className="num">ንዑሳን</th><th className="num">Requests</th><th>Leader</th><th className="num">Sessions</th><th className="num">Property</th></tr></thead>
          <tbody>
            {d.depts.map((x) => {
              const p = d.propertyByDept.find((r) => r.d === x.id);
              return (
                <tr key={String(x.id)}>
                  <td lang={lang}>{departmentName({ nameOm: String(x.nameOm), nameAm: String(x.nameAm) }, lang)}</td>
                  <td className="num">{n(x.members)}</td>
                  <td className="num">{n(x.requests)}</td>
                  <td>{n(x.leaders) ? "✓" : <span className="pill pill-pay-unpaid">None</span>}</td>
                  <td className="num">{n(x.sessions)}</td>
                  <td className="num">{p ? `${n(p.items)} (${n(p.inherited)} inherited)` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>3. Money</h2>
      <div className="audit-grid">
        <Stat label="Total in" value={birr(inTotal)} />
        <Stat label="Total out" value={birr(outTotal)} />
        <Stat label="Balance" value={birr(inTotal - outTotal)} warn={inTotal - outTotal < 0} />
        <Stat label={`Paid ${formatMonth(d.month, lang)}`} value={`${d.paidThisMonth} / ${activeCount}`} />
        <Stat label="Contributions approved" value={`${n(byStatus(d.contrib, "approved").n)} · ${birr(byStatus(d.contrib, "approved").total)}`} />
        <Stat label="Contributions waiting" value={n(byStatus(d.contrib, "pending").n)} warn={n(byStatus(d.contrib, "pending").old) > 0} />
        <Stat label="Contributions rejected" value={n(byStatus(d.contrib, "rejected").n)} />
        <Stat label="ለመርዳት approved" value={`${n(byStatus(d.gifts, "approved").n)} · ${birr(byStatus(d.gifts, "approved").total)}`} />
        <Stat label="ለመርዳት waiting" value={n(byStatus(d.gifts, "pending").n)} warn={n(byStatus(d.gifts, "pending").old) > 0} />
      </div>
      <table className="audit-table">
        <thead><tr><th>Ledger</th><th className="num">Entries</th><th className="num">Birr</th></tr></thead>
        <tbody>
          {d.money.map((m) => (
            <tr key={`${m.direction}${m.category}`}><td>{m.direction === "in" ? "In" : "Out"} · {String(m.category)}</td><td className="num">{n(m.n)}</td><td className="num">{n(m.total).toLocaleString("en-US")}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>4. Fasts</h2>
      {d.fasts.length === 0 ? <p className="muted">No fasts yet.</p> : (
        <div className="table-wrap">
          <table className="audit-table">
            <thead><tr><th>Fast</th><th className="num">Registered</th><th className="num">3 / 2 / 1 a day</th><th className="num">Meals served</th><th className="num">Today</th><th className="num">Days served</th><th className="num">Scanners</th></tr></thead>
            <tbody>
              {d.fasts.map((f) => {
                const capacity = n(f.t3) * MEALS_PER_DAY.meat_only + n(f.t2) * MEALS_PER_DAY.no_breakfast + n(f.t1) * MEALS_PER_DAY.dinner_only;
                return (
                  <tr key={String(f.id)}>
                    <td className="wrap"><strong>{String(f.name)}</strong><span className="who-id" lang={lang}>{formatEc(String(f.startDate), lang)} – {formatEc(String(f.endDate), lang)}</span></td>
                    <td className="num">{n(f.registered)}</td>
                    <td className="num">{n(f.t3)} / {n(f.t2)} / {n(f.t1)}</td>
                    <td className="num">{n(f.meals)}{n(f.noScanner) ? <span className="who-id">{n(f.noScanner)} without a scanner</span> : null}</td>
                    <td className="num">{n(f.mealsToday)} / {capacity}</td>
                    <td className="num">{n(f.days)}</td>
                    <td className="num">{n(f.scanners)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>5. System use</h2>
      <div className="audit-grid">
        <Stat label="Accounts" value={n(d.usage.users)} />
        <Stat label="Telegram connected" value={n(d.usage.telegram)} />
        <Stat label="Signed in, last 7 days" value={n(d.usage.signedInWeek)} />
        <Stat label="Signed in now" value={n(d.usage.activeSessions)} />
        <Stat label="Locked out (wrong passwords)" value={n(d.usage.lockouts)} warn={n(d.usage.lockouts) > 0} />
        <Stat label="Cafe scans, last 7 days" value={n(d.usage.scansWeek)} />
        <Stat label="Attendance marks" value={n(d.usage.attendanceMarks)} />
        <Stat label="Songs released / draft" value={`${n(d.usage.songsReleased)} / ${n(d.usage.songsDraft)}`} />
      </div>

      <h2>6. Needs attention</h2>
      <ul className="audit-issues">
        <li className={n(d.issues.noLeader) ? "is-warn" : ""}>{n(d.issues.noLeader)} department(s) without a leader</li>
        <li className={n(d.issues.positions) < 3 ? "is-warn" : ""}>{n(d.issues.positions)} of 3 ጽህፈት ቤት positions filled</li>
        <li className={n(d.issues.noTelegram) ? "is-warn" : ""}>{n(d.issues.noTelegram)} active member(s) not connected to Telegram</li>
        <li className={n(d.issues.oldPending) ? "is-warn" : ""}>{n(d.issues.oldPending)} registration(s) waiting more than 7 days</li>
        <li className={n(byStatus(d.contrib, "pending").old) + n(byStatus(d.gifts, "pending").old) ? "is-warn" : ""}>
          {n(byStatus(d.contrib, "pending").old) + n(byStatus(d.gifts, "pending").old)} payment(s) waiting more than 7 days
        </li>
      </ul>
    </section>
  );
}

export type { FastType };
