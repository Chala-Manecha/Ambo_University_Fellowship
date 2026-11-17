import { asc } from "drizzle-orm";
import { Form, Link, useLocation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/members";
import type { loader as rootLoader } from "../root";
import { Chips, PageHead } from "../components/Dash";
import { TITLES } from "../content/member-options";
import { getDb, schema } from "../db";
import { YEAR_KEYS } from "../lib/dashboard";
import { departmentName } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { DEFAULT_LANG } from "../lib/lang";
import { filterMembers } from "../lib/member-filters";
import { loadMemberList } from "../lib/members.server";
import { can } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { requireMemberList } from "../lib/access.server";

export function meta() {
  return [{ title: "Members · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user } = await requireMemberList(request, env, db);
  const [members, departments] = await Promise.all([
    loadMemberList(db),
    db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder) }),
  ]);
  const canSeePending = can(user.role, "registration:review");
  // Only what this person may see; filtering happens on the page so chips respond instantly
  return {
    members: members.filter((m) => m.status === "active" || (canSeePending && m.status === "pending")),
    departments: departments.map((d) => ({ id: d.id, nameOm: d.nameOm, nameAm: d.nameAm })),
    canSeePending,
    canManage: can(user.role, "member:manage"),
  };
}

const yearLabel = (k: (typeof YEAR_KEYS)[number]) => (k === "g" ? "Graduated" : `Year ${k}`);

export default function Members({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const [params] = useSearchParams();
  const location = useLocation();
  const { members, departments, canSeePending, canManage } = loaderData;
  const deptIds = departments.map((d) => d.id);
  const f = filterMembers(members, params, deptIds, canSeePending);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const statusHref = (s: "active" | "pending") => {
    const p = new URLSearchParams(params);
    if (s === "pending") p.set("status", "pending");
    else p.delete("status");
    return `?${p.toString()}`;
  };

  return (
    <section className="page wide">
      <PageHead
        back={{ to: "/dashboard", label: "Dashboard" }}
        title="Members"
        actions={
          <>
            <a href={`/members.csv${location.search}`} download>⬇ CSV</a>
            {canManage && <Link to="/admin/members">🎖️ Roles</Link>}
          </>
        }
      />

      <div className="card filter-card">
        <div className="filter-top">
          <div className="chips" role="group" aria-label="Status">
            <Link to={statusHref("active")} className="chip" aria-current={f.status === "active"} preventScrollReset>
              Active <b>{f.counts.status.active}</b>
            </Link>
            {canSeePending && (
              <Link to={statusHref("pending")} className="chip" aria-current={f.status === "pending"} preventScrollReset>
                Waiting for review <b>{f.counts.status.pending}</b>
              </Link>
            )}
          </div>
          <Form method="get" className="list-tools" role="search">
            {[...params.entries()].filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="search" name="q" defaultValue={f.q} placeholder="Search name, ID, phone, @telegram" aria-label="Search members" />
            <button className="btn btn-quiet btn-sm" aria-label="Search">🔍</button>
          </Form>
        </div>
        <Chips label="Gender" param="gender" value={f.values.gender} counts={f.counts.gender} options={[["male", "Male"], ["female", "Female"]]} />
        <Chips label="Year" param="year" value={f.values.year} counts={f.counts.year} options={YEAR_KEYS.map((k) => [k, yearLabel(k)] as const)} />
      </div>

      <h2 className="list-title">
        {f.status === "pending" ? "Waiting for review" : "Active members"} <span className="muted">({f.rows.length})</span>
        {f.status === "pending" && canSeePending && f.rows.length > 0 && <> · <Link to="/admin/registrations">Review them</Link></>}
      </h2>

      {f.rows.length === 0 ? (
        <p className="muted">Nobody matches these filters.</p>
      ) : (
        <div className="table-wrap">
          <table className="table-oneline">
            <thead>
              <tr><th>Name</th><th>Student ID</th><th>Gender</th><th>Study</th><th>Born</th><th>Phone</th><th>Telegram</th><th>Departments</th></tr>
            </thead>
            <tbody>
              {f.rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.title && m.title in TITLES && <span lang={lang}>{TITLES[m.title as keyof typeof TITLES][lang]} </span>}
                    <strong>{m.fullName}</strong>
                    {m.christianName && <span className="muted"> ({m.christianName})</span>}
                  </td>
                  <td>{m.studentId}</td>
                  <td>{m.gender === "male" ? "M" : "F"}</td>
                  <td>{m.fieldOfStudy} · {formatYear(m.yearOfStudy)}</td>
                  <td lang={lang}>{formatEc(m.birthDate, lang)}</td>
                  <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                  <td>{m.telegramUsername ? <a href={`https://t.me/${m.telegramUsername}`} target="_blank" rel="noreferrer">@{m.telegramUsername}</a> : "—"}</td>
                  <td lang={lang}>
                    {m.departments.length
                      ? m.departments.map((id) => { const d = deptById.get(id); return d ? departmentName(d, lang) : id; }).join(", ")
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
