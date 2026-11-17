import { asc } from "drizzle-orm";
import { Form, Link, useLocation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/members";
import type { loader as rootLoader } from "../root";
import { PageHead } from "../components/Dash";
import { Counts } from "../components/Panel";
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
  };
}

const yearLabel = (k: (typeof YEAR_KEYS)[number]) => (k === "g" ? "Graduated" : `Year ${k}`);

export default function Members({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const [params] = useSearchParams();
  const location = useLocation();
  const { members, departments, canSeePending } = loaderData;
  const deptIds = departments.map((d) => d.id);
  const f = filterMembers(members, params, deptIds, canSeePending);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const statusHref = (s: "active" | "pending") => {
    const p = new URLSearchParams(params);
    if (s === "pending") p.set("status", "pending");
    else p.delete("status");
    return `?${p.toString()}`;
  };

  const counts = f.counts as unknown as { gender: Record<string, number>; year: Record<string, number> };
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();

  return (
    <section className="page wide">
      <PageHead back={{ to: "/lead", label: "Leadership" }} title="Members" />

      <Counts
        items={[
          { to: statusHref("active"), n: f.counts.status.active, label: "Active members", active: f.status === "active" },
          ...(canSeePending
            ? [{ to: statusHref("pending"), n: f.counts.status.pending, label: "Waiting for review", active: f.status === "pending", alert: true }]
            : []),
        ]}
      />

      <Form method="get" className="card filter-bar" role="search">
        {f.status === "pending" && <input type="hidden" name="status" value="pending" />}
        <label className="filter-field filter-search">
          <span>Search</span>
          <input type="search" name="q" defaultValue={f.q} placeholder="🔍 Name, student ID, phone, @telegram" />
        </label>
        <label className="filter-field">
          <span>Gender</span>
          <select name="gender" defaultValue={f.values.gender ?? ""} onChange={submitOnChange}>
            <option value="">All ({counts.gender.all})</option>
            <option value="male">Male ({counts.gender.male})</option>
            <option value="female">Female ({counts.gender.female})</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Year</span>
          <select name="year" defaultValue={f.values.year ?? ""} onChange={submitOnChange}>
            <option value="">All ({counts.year.all})</option>
            {YEAR_KEYS.map((k) => <option key={k} value={k}>{yearLabel(k)} ({counts.year[k]})</option>)}
          </select>
        </label>
        <button className="btn btn-primary btn-sm">Filter</button>
      </Form>

      <div className="card action-bar">
        <strong>
          {f.rows.length} {f.status === "pending" ? "waiting" : f.rows.length === 1 ? "member" : "members"}
        </strong>
        <div className="action-bar-buttons">
          {f.status === "pending" && canSeePending && f.rows.length > 0 && <Link to="/office/registrations" className="btn btn-quiet btn-sm">📝 Review</Link>}
          <a href={`/members.csv${location.search}`} download className="btn btn-primary btn-sm">⬇ Export</a>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>

      {f.rows.length === 0 ? (
        <p className="muted">Nobody matches these filters.</p>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table-oneline member-table">
              <thead>
                <tr><th>Member</th><th>Gender</th><th>Study</th><th>Born</th><th>Phone</th><th>Telegram</th><th>Departments</th></tr>
              </thead>
              <tbody>
                {f.rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="who">
                        <span className="avatar" aria-hidden="true">{m.fullName.trim().charAt(0).toUpperCase()}</span>
                        <span>
                          {m.title && m.title in TITLES && <span lang={lang}>{TITLES[m.title as keyof typeof TITLES][lang]} </span>}
                          <strong>{m.fullName}</strong>
                          {m.christianName && <span className="muted"> ({m.christianName})</span>}
                          <span className="who-id">{m.studentId}</span>
                        </span>
                      </span>
                    </td>
                    <td>{m.gender === "male" ? "M" : "F"}</td>
                    <td>{m.fieldOfStudy} · {formatYear(m.yearOfStudy)}</td>
                    <td lang={lang}>{formatEc(m.birthDate, lang)}</td>
                    <td>{m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : <span className="muted">—</span>}</td>
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
        </div>
      )}
    </section>
  );
}
