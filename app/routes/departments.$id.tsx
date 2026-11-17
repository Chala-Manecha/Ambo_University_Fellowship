import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useOutlet, useRouteLoaderData, useSearchParams } from "react-router";
import { PageHead } from "../components/Dash";
import { Counts, Panel, type PanelGroup } from "../components/Panel";
import { pickParam } from "../lib/dashboard";
import type { Route } from "./+types/departments.$id";
import type { loader as rootLoader } from "../root";
import { DEPARTMENT_APPROVED } from "../content/bot";
import { EcDatePicker } from "../components/EcDatePicker";
import { formatEc, isoToEc } from "../lib/ethiopian-date";
import { getDb, schema, type Db } from "../db";
import { sendMessage } from "../lib/bot.server";
import {
  attendanceRate,
  BATCH_DEPT,
  canListMembers,
  canSeeLanguages,
  LANGUAGE_DEPT,
  canManageDepartment,
  canManageDues,
  MEMBER_AFFAIRS,
  departmentName,
  joinTransition,
  roleAfterLeadershipChange,
  sessionSchema,
  todayInAddis,
  type AttendanceStatus,
} from "../lib/departments";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { DEFAULT_LANG } from "../lib/lang";
import { can, isRole } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Department · Gibi Gubae" }];
}

/** Loads the department and checks the user may manage it (admin, or one of its leaders). */
async function requireDepartmentAccess(request: Request, env: Env, db: Db, departmentId: string) {
  const user = await requireUser(request, env);
  const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, departmentId) });
  if (!dept) throw new Response("Department not found", { status: 404 });
  const leaderOf = await getLeaderDepartmentIds(db, user.id);
  if (!canManageDepartment(user.role, leaderOf, dept.id)) {
    throw new Response("You don't have access to this department.", { status: 403 });
  }
  return { user, dept };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const user = await requireUser(request, env);
  const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, params.id) });
  if (!dept) throw new Response("Department not found", { status: 404 });
  const leaderOf = await getLeaderDepartmentIds(db, user.id);

  if (!canManageDepartment(user.role, leaderOf, dept.id)) {
    // Ordinary members: who leads it, how many are in it, and whether they're in it
    const rows = await db
      .select({ fullName: schema.members.fullName, userId: schema.members.userId, role: schema.departmentMembers.role, status: schema.departmentMembers.status })
      .from(schema.departmentMembers)
      .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
      .where(and(eq(schema.departmentMembers.departmentId, dept.id), inArray(schema.departmentMembers.status, ["pending", "active"]), eq(schema.members.status, "active")));
    const mine = rows.find((r) => r.userId === user.id);
    return {
      view: "public" as const,
      dept,
      leaders: rows.filter((r) => r.role === "leader" && r.status === "active").map((r) => r.fullName),
      count: rows.filter((r) => r.status === "active").length,
      myStatus: mine?.status ?? null,
    };
  }

  // Fellowship-wide pages this department runs; each opens inside the department's panel
  const base = `/departments/${dept.id}`;
  const tools: { to: string; label: string; icon: string }[] = [];
  if (dept.id === MEMBER_AFFAIRS) {
    if (canListMembers(user.role, leaderOf)) tools.push({ to: `${base}/all-members`, label: "All members", icon: "👥" });
    if (canListMembers(user.role, leaderOf)) tools.push({ to: `${base}/choices`, label: "Members' choices", icon: "🗳️" });
    if (can(user.role, "fast:manage") || can(user.role, "fast:scan")) tools.push({ to: `${base}/fasts`, label: "Fasts", icon: "🍲" });
  }
  if (dept.id === BATCH_DEPT) {
    if (canManageDues(user.role, leaderOf)) tools.push({ to: `${base}/dues`, label: "Contributions", icon: "💳" });
    if (can(user.role, "attendance:fellowship")) tools.push({ to: `${base}/attendance`, label: "Attendance", icon: "✅" });
  }
  if (dept.id === LANGUAGE_DEPT && canSeeLanguages(user.role, leaderOf)) {
    tools.push({ to: `${base}/languages`, label: "Members by language", icon: "🗣️" });
  }
  // አባላት ጉዳይ opens on the whole fellowship's members list
  const url = new URL(request.url);
  if (url.pathname.replace(/\/+$/, "") === base && !url.searchParams.has("tab") && request.method === "GET" && tools[0]?.label === "All members") {
    throw redirect(tools[0].to);
  }

  const people = await db
    .select({
      id: schema.departmentMembers.id,
      memberId: schema.members.id,
      fullName: schema.members.fullName,
      phone: schema.members.phone,
      telegramUsername: schema.user.telegramUsername,
      role: schema.departmentMembers.role,
      status: schema.departmentMembers.status,
      requestedAt: schema.departmentMembers.createdAt,
    })
    .from(schema.departmentMembers)
    .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(
      and(
        eq(schema.departmentMembers.departmentId, dept.id),
        inArray(schema.departmentMembers.status, ["pending", "active"]),
        eq(schema.members.status, "active"), // requests from registration wait until the registration is approved
      ),
    )
    .orderBy(asc(schema.members.fullName));

  const sessions = await db
    .select({ id: schema.attendanceSessions.id, title: schema.attendanceSessions.title, date: schema.attendanceSessions.date })
    .from(schema.attendanceSessions)
    .where(eq(schema.attendanceSessions.departmentId, dept.id))
    .orderBy(desc(schema.attendanceSessions.date), desc(schema.attendanceSessions.createdAt))
    .limit(30);

  const records = await db
    .select({ memberId: schema.attendanceRecords.memberId, status: schema.attendanceRecords.status, sessionId: schema.attendanceRecords.sessionId })
    .from(schema.attendanceRecords)
    .innerJoin(schema.attendanceSessions, eq(schema.attendanceSessions.id, schema.attendanceRecords.sessionId))
    .where(eq(schema.attendanceSessions.departmentId, dept.id));

  const byMember = new Map<string, AttendanceStatus[]>();
  const presentBySession = new Map<string, number>();
  for (const r of records) {
    byMember.set(r.memberId, [...(byMember.get(r.memberId) ?? []), r.status]);
    if (r.status === "present") presentBySession.set(r.sessionId, (presentBySession.get(r.sessionId) ?? 0) + 1);
  }

  return {
    view: "manage" as const,
    tools,
    dept,
    isAdmin: can(user.role, "department:manage"),
    today: todayInAddis(),
    pending: people.filter((p) => p.status === "pending"),
    active: people
      .filter((p) => p.status === "active")
      .map((p) => ({ ...p, rate: attendanceRate(byMember.get(p.memberId) ?? []) })),
    sessions: sessions.map((s) => ({ ...s, present: presentBySession.get(s.id) ?? 0 })),
    rate: attendanceRate(records.map((r) => r.status)).percent,
  };
}

/** Re-syncs a person's global role after their leadership changed. */
async function syncLeaderRole(db: Db, memberId: string) {
  const m = await db.query.members.findFirst({ where: eq(schema.members.id, memberId), columns: { userId: true } });
  if (!m) return;
  const u = await db.query.user.findFirst({ where: eq(schema.user.id, m.userId), columns: { role: true } });
  if (!u || !isRole(u.role)) return;
  const leads = await db.query.departmentMembers.findFirst({
    where: and(eq(schema.departmentMembers.memberId, memberId), eq(schema.departmentMembers.role, "leader"), eq(schema.departmentMembers.status, "active")),
    columns: { id: true },
  });
  const next = roleAfterLeadershipChange(u.role, Boolean(leads));
  if (next !== u.role) await db.update(schema.user).set({ role: next }).where(eq(schema.user.id, m.userId));
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, dept } = await requireDepartmentAccess(request, env, db, params.id);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "new-session") {
    const parsed = sessionSchema.safeParse({ title: form.get("title"), date: form.get("date") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the session details." };
    const [s] = await db
      .insert(schema.attendanceSessions)
      .values({ ...parsed.data, departmentId: dept.id, createdBy: user.id })
      .returning({ id: schema.attendanceSessions.id });
    throw redirect(`/attendance/${s.id}`);
  }

  // Everything below acts on one department_members row of THIS department
  const rowId = String(form.get("rowId") ?? "");
  const row = await db.query.departmentMembers.findFirst({
    where: and(eq(schema.departmentMembers.id, rowId), eq(schema.departmentMembers.departmentId, dept.id)),
  });
  if (!row) throw new Response("Not found in this department", { status: 404 });

  if (intent === "approve" || intent === "reject") {
    const next = joinTransition(row.status, intent);
    if (!next) return { message: "This request was already decided." };
    await db
      .update(schema.departmentMembers)
      .set({ status: next })
      .where(and(eq(schema.departmentMembers.id, row.id), eq(schema.departmentMembers.status, "pending")));
    if (next === "active") {
      const m = await db
        .select({ telegramId: schema.user.telegramId, lang: schema.members.contentLanguage })
        .from(schema.members)
        .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
        .where(eq(schema.members.id, row.memberId))
        .get();
      if (m?.telegramId) {
        ctx.waitUntil(sendMessage(env, m.telegramId, DEPARTMENT_APPROVED[m.lang](departmentName(dept, m.lang))));
      }
    }
    return { message: next === "active" ? "Request approved." : "Request declined." };
  }

  if (intent === "make-leader" || intent === "remove-leader") {
    if (!can(user.role, "department:manage")) throw new Response("Only admins appoint leaders.", { status: 403 });
    if (row.status !== "active") return { message: "Only active members can lead a department." };
    await db
      .update(schema.departmentMembers)
      .set({ role: intent === "make-leader" ? "leader" : "member" })
      .where(eq(schema.departmentMembers.id, row.id));
    await syncLeaderRole(db, row.memberId);
    return { message: intent === "make-leader" ? "Leader appointed." : "Leader removed." };
  }

  if (intent === "remove") {
    if (row.role === "leader" && !can(user.role, "department:manage")) {
      return { message: "Only an admin can remove a leader." };
    }
    await db.delete(schema.departmentMembers).where(eq(schema.departmentMembers.id, row.id));
    if (row.role === "leader") await syncLeaderRole(db, row.memberId);
    return { message: "Removed from the department." };
  }

  throw new Response("Unknown action", { status: 400 });
}

const TABS = ["members", "requests", "attendance"] as const;

export default function Department({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [params] = useSearchParams();
  const outlet = useOutlet();
  if (loaderData.view === "public") return <DepartmentPublic data={loaderData} lang={lang} busy={busy} />;
  const { dept, isAdmin, today, pending, active, sessions, tools } = loaderData;
  const message = actionData && "message" in actionData ? actionData.message : null;
  const error = actionData && "error" in actionData ? actionData.error : null;
  const tab = pickParam(params.get("tab"), TABS) ?? "members";
  const leaders = active.filter((p) => p.role === "leader");
  const base = `/departments/${dept.id}`;
  // Members and join requests are the count buttons below; the panel only switches pages
  const groups: PanelGroup[] = [
    { label: "Fellowship", items: tools },
    // ባች እና ዲፓርትመንት takes the whole fellowship's attendance, so it needs only that one
    { label: "Department", items: tools.some((t) => t.to.endsWith("/attendance")) ? [] : [{ to: `${base}?tab=attendance`, label: "Attendance", icon: "✅" }] },
  ];
  return (
    <section className="page wide panel-page">
      <Panel
        title={departmentName(dept, lang)}
        titleLang={lang}
        sub={<p>{leaders.length ? <>Led by {leaders.map((l) => l.fullName).join(", ")}</> : "No leader yet"}</p>}
        back={{ to: "/lead", label: "All departments" }}
        groups={groups}
        defaultTab="members"
      />
      <div className="panel-content">
      {outlet ?? (
      <>
      {message && <p className="notice" role="status">{message}</p>}
      <Counts
        items={[
          { to: `${base}?tab=members`, n: active.length, label: active.length === 1 ? "Member" : "Members", active: tab === "members" },
          { to: `${base}?tab=requests`, n: pending.length, label: pending.length === 1 ? "Join request" : "Join requests", active: tab === "requests", alert: true },
        ]}
      />

      {tab === "requests" && (
        <div className="card">
          {pending.length === 0 ? (
            <p className="muted">No requests waiting. Members ask to join from the Departments page or when they register.</p>
          ) : (
            <div className="table-wrap">
              <table className="table-oneline">
                <thead><tr><th>Name</th><th>Phone</th><th>Telegram</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.id}>
                      <td>{p.fullName}</td>
                      <td><a href={`tel:${p.phone}`}>{p.phone}</a></td>
                      <td>{p.telegramUsername ? <a href={`https://t.me/${p.telegramUsername}`} target="_blank" rel="noreferrer">@{p.telegramUsername}</a> : "—"}</td>
                      <td>
                        <Form method="post" className="row-actions">
                          <input type="hidden" name="rowId" value={p.id} />
                          <button name="intent" value="approve" className="btn btn-primary btn-sm" disabled={busy}>Approve</button>
                          <button name="intent" value="reject" className="btn btn-quiet btn-sm" disabled={busy}>Decline</button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "attendance" && (
        <div className="card">
          <Form method="post" className="inline-form">
            <input type="hidden" name="intent" value="new-session" />
            <label className="field">
              <span>Title</span>
              <input name="title" required maxLength={80} placeholder="Saturday class" />
            </label>
            <EcDatePicker name="date" label="Date" lang={lang} defaultIso={today} minYear={isoToEc(today).year - 1} maxYear={isoToEc(today).year + 1} />
            <button className="btn btn-primary" disabled={busy}>Take attendance</button>
          </Form>
          {error && <p className="form-error" role="alert">{error}</p>}
          {sessions.length > 0 ? (
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link to={`/attendance/${s.id}`}><span lang={lang}>{formatEc(s.date, lang)}</span> · {s.title}</Link>
                  <span className="muted"> — {s.present} present</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No sessions yet.</p>
          )}
        </div>
      )}

      {tab === "members" && (
        <div className="card">
          {active.length === 0 ? (
            <p className="muted">No members yet. Members join from the Departments page.</p>
          ) : (
            <div className="table-wrap">
              <table className="table-oneline">
                <thead><tr><th>Name</th><th>Phone</th><th>Telegram</th><th className="num">Attendance</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {active.map((p) => (
                    <tr key={p.id}>
                      <td>{p.fullName} {p.role === "leader" && <span className="pill pill-active">Leader</span>}</td>
                      <td><a href={`tel:${p.phone}`}>{p.phone}</a></td>
                      <td>{p.telegramUsername ? <a href={`https://t.me/${p.telegramUsername}`} target="_blank" rel="noreferrer">@{p.telegramUsername}</a> : "—"}</td>
                      <td className="num">{p.rate.percent === null ? "—" : `${p.rate.percent}% (${p.rate.present}/${p.rate.present + p.rate.absent})`}</td>
                      <td>
                        <Form method="post" className="row-actions">
                          <input type="hidden" name="rowId" value={p.id} />
                          {isAdmin &&
                            (p.role === "leader" ? (
                              <button name="intent" value="remove-leader" className="btn btn-quiet btn-sm" disabled={busy}>Remove leader</button>
                            ) : (
                              <button name="intent" value="make-leader" className="btn btn-quiet btn-sm" disabled={busy}>Make leader</button>
                            ))}
                          {(isAdmin || p.role !== "leader") && (
                            <button name="intent" value="remove" className="btn btn-quiet btn-sm" disabled={busy}>Remove</button>
                          )}
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>
      )}
      </div>
    </section>
  );
}

type PublicData = Extract<Route.ComponentProps["loaderData"], { view: "public" }>;

/** What an ordinary member sees: the leader, the size, and a way to ask to join. */
function DepartmentPublic({ data, lang, busy }: { data: PublicData; lang: "om" | "am"; busy: boolean }) {
  const { dept, leaders, count, myStatus } = data;
  return (
    <section className="page narrow">
      <PageHead
        back={{ to: "/account", label: "My dashboard" }}
        title={departmentName(dept, lang)}
        lang={lang}
        sub={leaders.length ? <>Led by {leaders.join(", ")}</> : "No leader yet"}
      />
      <div className="card">
        <p><strong>{count}</strong> member{count === 1 ? "" : "s"}</p>
        {myStatus === "active" ? (
          <p>✅ You're a member of this department.</p>
        ) : myStatus === "pending" ? (
          <p className="muted">Your request to join is waiting for the leader.</p>
        ) : (
          <Form method="post" action="/departments">
            <input type="hidden" name="departmentId" value={dept.id} />
            <button className="btn btn-primary" disabled={busy}>Ask to join</button>
          </Form>
        )}
      </div>
    </section>
  );
}
