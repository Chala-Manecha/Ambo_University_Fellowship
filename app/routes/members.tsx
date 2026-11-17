import { asc } from "drizzle-orm";
import { Form, useLocation, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/members";
import type { loader as rootLoader } from "../root";
import { Counts } from "../components/Panel";
import { TITLES } from "../content/member-options";
import { getDb, schema } from "../db";
import { requireMemberList } from "../lib/access.server";
import { YEAR_KEYS } from "../lib/dashboard";
import { departmentName } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { DEFAULT_LANG } from "../lib/lang";
import { filterMembers } from "../lib/member-filters";
import { loadMemberList } from "../lib/members.server";
import { can } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { reviewRegistration } from "../lib/registrations.server";
import { requirePermission } from "../lib/session.server";

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
  // Only what this person may see; filtering happens on the page so it responds instantly
  return {
    members: members.filter((m) => m.status === "active" || (canSeePending && m.status === "pending")),
    departments: departments.map((d) => ({ id: d.id, nameOm: d.nameOm, nameAm: d.nameAm })),
    canSeePending,
  };
}

/** Approve or decline a registration from the "Waiting for review" list. */
export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const reviewer = await requirePermission(request, env, "registration:review");
  const form = await request.formData();
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "reject") throw new Response("Unknown decision", { status: 400 });
  return reviewRegistration(env, ctx, getDb(env.DB), reviewer.id, String(form.get("memberId") ?? ""), decision);
}

const yearLabel = (k: (typeof YEAR_KEYS)[number]) => (k === "g" ? "Graduated" : `Year ${k}`);

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const [params] = useSearchParams();
  const location = useLocation();
  const busy = useNavigation().state !== "idle";
  const { members, departments, canSeePending } = loaderData;
  const f = filterMembers(members, params, departments.map((d) => d.id), canSeePending);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const counts = f.counts as unknown as { gender: Record<string, number>; year: Record<string, number> };
  const pendingView = f.status === "pending";
  const statusHref = (s: "active" | "pending") => {
    const p = new URLSearchParams(params);
    if (s === "pending") p.set("status", "pending");
    else p.delete("status");
    return `?${p.toString()}`;
  };
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();

  return (
    <section className="page wide">
      <Counts
        items={[
          { to: statusHref("active"), n: f.counts.status.active, label: "Active", active: !pendingView },
          ...(canSeePending ? [{ to: statusHref("pending"), n: f.counts.status.pending, label: "Waiting for review", active: pendingView, alert: true }] : []),
        ]}
      />
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <Form method="get" className="card filter-bar" role="search">
        {pendingView && <input type="hidden" name="status" value="pending" />}
        <input type="search" name="q" defaultValue={f.q} placeholder="🔍 Name, ID, phone, @telegram" aria-label="Search" className="filter-q" />
        <select name="gender" defaultValue={f.values.gender ?? ""} onChange={submitOnChange} aria-label="Gender">
          <option value="">All genders ({counts.gender.all})</option>
          <option value="male">Male ({counts.gender.male})</option>
          <option value="female">Female ({counts.gender.female})</option>
        </select>
        <select name="year" defaultValue={f.values.year ?? ""} onChange={submitOnChange} aria-label="Year">
          <option value="">All years ({counts.year.all})</option>
          {YEAR_KEYS.map((k) => <option key={k} value={k}>{yearLabel(k)} ({counts.year[k]})</option>)}
        </select>
        <button className="btn btn-primary btn-sm">Filter</button>
      </Form>

      <div className="card table-card">
        <div className="table-bar">
          <strong>{f.rows.length} {pendingView ? "waiting" : f.rows.length === 1 ? "member" : "members"}</strong>
          <span className="table-bar-buttons">
            <a href={`/members.csv${location.search}`} download className="btn btn-quiet btn-sm">⬇ Export</a>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>🖨️ Print</button>
          </span>
        </div>
        {f.rows.length === 0 ? (
          <p className="muted table-empty">{pendingView ? "No registrations waiting." : "Nobody matches these filters."}</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline member-table">
              <thead>
                <tr>
                  <th>Member</th>
                  {pendingView && <th><span className="visually-hidden">Decision</span></th>}
                  <th>Gender</th><th>Study</th><th>Born</th><th>Phone</th><th>Telegram</th><th>Departments</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="who">
                        {m.hasPhoto ? (
                          <img className="avatar" src={`/photos/${m.id}`} alt="" loading="lazy" width={34} height={34} />
                        ) : (
                          <span className="avatar" aria-hidden="true">{m.fullName.trim().charAt(0).toUpperCase()}</span>
                        )}
                        <span>
                          {m.title && m.title in TITLES && <span lang={lang}>{TITLES[m.title as keyof typeof TITLES][lang]} </span>}
                          <strong>{m.fullName}</strong>
                          {m.christianName && <span className="muted"> ({m.christianName})</span>}
                          <span className="who-id">{m.studentId}</span>
                        </span>
                      </span>
                    </td>
                    {pendingView && (
                      <td>
                        <Form method="post" className="row-actions" preventScrollReset>
                          <input type="hidden" name="memberId" value={m.id} />
                          <button name="decision" value="approve" className="btn btn-primary btn-sm" disabled={busy}>Approve</button>
                          <button name="decision" value="reject" className="btn btn-quiet btn-sm" disabled={busy}>Decline</button>
                        </Form>
                      </td>
                    )}
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
        )}
      </div>
    </section>
  );
}
