import { and, asc, eq, inArray } from "drizzle-orm";
import { Form, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/admin.members";
import type { loader as rootLoader } from "../root";
import { getDb, schema, type Db } from "../db";
import { clearLoginFailures, setPasswordHash } from "../lib/accounts.server";
import { departmentName, isPosition, POSITION_LABELS, POSITIONS, roleAfterLeadershipChange } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { hashPassword } from "../lib/password";
import { isRole, type Role } from "../lib/permissions";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Roles & positions · Gibi Gubae" }];
}

/** 10 characters without look-alikes (0/O, 1/l/I). */
function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join("");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "member:manage");
  const db = getDb(env.DB);
  const [members, departments, leaders] = await Promise.all([
    db
      .select({
        memberId: schema.members.id,
        userId: schema.user.id,
        fullName: schema.members.fullName,
        studentId: schema.members.studentId,
        role: schema.user.role,
        position: schema.user.position,
      })
      .from(schema.members)
      .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
      .where(eq(schema.members.status, "active"))
      .orderBy(asc(schema.members.fullName)),
    db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder), columns: { id: true, nameOm: true, nameAm: true } }),
    db
      .select({ departmentId: schema.departmentMembers.departmentId, memberId: schema.departmentMembers.memberId })
      .from(schema.departmentMembers)
      .where(and(eq(schema.departmentMembers.role, "leader"), eq(schema.departmentMembers.status, "active"))),
  ]);
  const name = new Map(members.map((m) => [m.memberId, m.fullName]));
  return {
    members: members.map((m) => ({ memberId: m.memberId, fullName: m.fullName, studentId: m.studentId })),
    positions: POSITIONS.map((p) => {
      const holder = members.find((m) => m.position === p);
      return { position: p, holder: holder ? { memberId: holder.memberId, fullName: holder.fullName } : null };
    }),
    departments: departments.map((d) => ({
      ...d,
      leaders: leaders.filter((l) => l.departmentId === d.id).map((l) => ({ memberId: l.memberId, fullName: name.get(l.memberId) ?? "?" })),
    })),
    cafe: members.filter((m) => m.role === "cafe").map((m) => ({ memberId: m.memberId, fullName: m.fullName })),
  };
}

/** Recomputes a person's role from their position and leadership; admin/cafe/finance set by hand stay. */
async function syncRole(db: Db, userId: string) {
  const u = await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { role: true, position: true } });
  if (!u || !isRole(u.role)) return;
  const m = await db.query.members.findFirst({ where: eq(schema.members.userId, userId), columns: { id: true } });
  const leads = m
    ? Boolean(
        await db.query.departmentMembers.findFirst({
          where: and(eq(schema.departmentMembers.memberId, m.id), eq(schema.departmentMembers.role, "leader"), eq(schema.departmentMembers.status, "active")),
          columns: { id: true },
        }),
      )
    : false;
  const next: Role = u.position ? "admin" : roleAfterLeadershipChange(u.role, leads);
  if (next !== u.role) await db.update(schema.user).set({ role: next }).where(eq(schema.user.id, userId));
}

async function memberUser(db: Db, memberId: string) {
  return db.query.members.findFirst({ where: and(eq(schema.members.id, memberId), eq(schema.members.status, "active")), columns: { id: true, userId: true, fullName: true, studentIdKey: true } });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const me = await requirePermission(request, env, "member:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  const intent = form.get("intent");
  const memberId = String(form.get("memberId") ?? "");

  // ዋና ሰብሳቢ / ምክትል ሰብሳቢ / ጸሐፊ: one person each, and the position gives admin access
  if (intent === "position" || intent === "clear-position") {
    const position = form.get("position");
    if (!isPosition(position)) return { message: "Unknown position." };
    const previous = await db.query.user.findFirst({ where: eq(schema.user.position, position), columns: { id: true, role: true } });
    if (intent === "clear-position") {
      if (!previous) return null;
      if (previous.id === me.id) return { message: "You can't remove your own position. Ask another officer." };
      // Losing the position also removes the admin access it gave
      await db.update(schema.user).set({ position: null, role: "member" }).where(eq(schema.user.id, previous.id));
      await syncRole(db, previous.id);
      return { message: "Position cleared." };
    }
    const target = await memberUser(db, memberId);
    if (!target) return { message: "Choose a member." };
    if (previous && previous.id !== target.userId) {
      if (previous.id === me.id) return { message: "You can't give away your own position. Ask another officer." };
      await db.update(schema.user).set({ position: null, role: "member" }).where(eq(schema.user.id, previous.id));
      await syncRole(db, previous.id);
    }
    // A person holds one position at a time
    await db.update(schema.user).set({ position, role: "admin" }).where(eq(schema.user.id, target.userId));
    return { message: `${target.fullName} is now ${POSITION_LABELS[position].am}.` };
  }

  // Department leader: one per department; the previous leader stays in the department as a member
  if (intent === "leader" || intent === "clear-leader") {
    const departmentId = String(form.get("departmentId") ?? "");
    const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, departmentId), columns: { id: true } });
    if (!dept) return { message: "Unknown department." };
    const current = await db
      .select({ memberId: schema.departmentMembers.memberId, userId: schema.members.userId })
      .from(schema.departmentMembers)
      .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
      .where(and(eq(schema.departmentMembers.departmentId, dept.id), eq(schema.departmentMembers.role, "leader")));
    const target = intent === "leader" ? await memberUser(db, memberId) : null;
    if (intent === "leader" && !target) return { message: "Choose a member." };
    if (current.length) {
      await db
        .update(schema.departmentMembers)
        .set({ role: "member" })
        .where(and(eq(schema.departmentMembers.departmentId, dept.id), inArray(schema.departmentMembers.memberId, current.map((c) => c.memberId))));
    }
    if (target) {
      await db
        .insert(schema.departmentMembers)
        .values({ departmentId: dept.id, memberId: target.id, role: "leader", status: "active" })
        .onConflictDoUpdate({
          target: [schema.departmentMembers.departmentId, schema.departmentMembers.memberId],
          set: { role: "leader", status: "active", updatedAt: new Date() },
        });
    }
    for (const userId of new Set([...current.map((c) => c.userId), ...(target ? [target.userId] : [])])) await syncRole(db, userId);
    return { message: target ? `${target.fullName} now leads this department.` : "Leader removed." };
  }

  // Cafe coordinators scan QR codes at fasts
  if (intent === "cafe-add" || intent === "cafe-remove") {
    const target = await memberUser(db, memberId);
    if (!target) return { message: "Choose a member." };
    const u = await db.query.user.findFirst({ where: eq(schema.user.id, target.userId), columns: { role: true } });
    if (intent === "cafe-add") {
      if (u?.role === "admin") return { message: `${target.fullName} is an admin and can already scan.` };
      await db.update(schema.user).set({ role: "cafe" }).where(eq(schema.user.id, target.userId));
    } else {
      await db.update(schema.user).set({ role: "member" }).where(eq(schema.user.id, target.userId));
      await syncRole(db, target.userId);
    }
    return { message: "Saved." };
  }

  if (intent === "reset-password") {
    const target = await memberUser(db, memberId);
    if (!target) return { message: "Choose a member." };
    const temp = temporaryPassword();
    await setPasswordHash(db, target.userId, await hashPassword(temp));
    if (target.studentIdKey) await clearLoginFailures(db, target.studentIdKey);
    return { message: `Temporary password for ${target.fullName}: ${temp} — give it to them privately; they can change it on My account.` };
  }

  throw new Response("Unknown action", { status: 400 });
}

/** Dropdown of every active member, with a button. */
function Assign({ members, intent, hidden, button, current }: {
  members: { memberId: string; fullName: string; studentId: string }[];
  intent: string;
  hidden: Record<string, string>;
  button: string;
  current?: string;
}) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post" className="assign" preventScrollReset>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select name="memberId" required defaultValue="" aria-label="Choose a member">
        <option value="" disabled>Choose a member…</option>
        {members.filter((m) => m.memberId !== current).map((m) => <option key={m.memberId} value={m.memberId}>{m.fullName} · {m.studentId}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" disabled={busy}>{button}</button>
    </Form>
  );
}

function Clear({ intent, hidden, label }: { intent: string; hidden: Record<string, string>; label: string }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post" preventScrollReset onSubmit={(e) => { if (!window.confirm(`${label}?`)) e.preventDefault(); }}>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className="link-btn" disabled={busy} aria-label={label}>✕</button>
    </Form>
  );
}

export default function RolesPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const { members, positions, departments, cafe } = loaderData;

  return (
    <section className="page wide">
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <div className="card roles-card">
        <h2><span lang="am">ጽህፈት ቤት</span> <small className="muted">— gives admin access</small></h2>
        {positions.map((p) => (
          <div key={p.position} className="assign-row">
            <div className="assign-what">
              <strong lang={lang}>{POSITION_LABELS[p.position][lang]}</strong>
              {p.holder ? (
                <span className="assign-holder">{p.holder.fullName} <Clear intent="clear-position" hidden={{ position: p.position }} label={`Remove ${p.holder.fullName}`} /></span>
              ) : <span className="muted">Not assigned</span>}
            </div>
            <Assign members={members} intent="position" hidden={{ position: p.position }} button={p.holder ? "Change" : "Assign"} current={p.holder?.memberId} />
          </div>
        ))}
      </div>

      <div className="card roles-card">
        <h2>Department leaders</h2>
        {departments.map((d) => (
          <div key={d.id} className="assign-row">
            <div className="assign-what">
              <strong lang={lang}>{departmentName(d, lang)}</strong>
              {d.leaders.length ? (
                <span className="assign-holder">
                  {d.leaders.map((l) => l.fullName).join(", ")} <Clear intent="clear-leader" hidden={{ departmentId: d.id }} label="Remove the leader" />
                </span>
              ) : <span className="muted">No leader</span>}
            </div>
            <Assign members={members} intent="leader" hidden={{ departmentId: d.id }} button={d.leaders.length ? "Change" : "Assign"} current={d.leaders[0]?.memberId} />
          </div>
        ))}
      </div>

      <div className="card roles-card">
        <h2>Cafe coordinators <small className="muted">— scan QR codes at fasts</small></h2>
        <div className="assign-row">
          <div className="assign-what">
            {cafe.length ? (
              cafe.map((c) => (
                <span key={c.memberId} className="assign-holder">{c.fullName} <Clear intent="cafe-remove" hidden={{ memberId: c.memberId }} label={`Remove ${c.fullName}`} /></span>
              ))
            ) : <span className="muted">None</span>}
          </div>
          <Assign members={members} intent="cafe-add" hidden={{}} button="Add" />
        </div>
      </div>

      <div className="card roles-card">
        <h2>Forgotten password</h2>
        <div className="assign-row">
          <div className="assign-what"><span className="muted">Gives the member a temporary password to sign in with.</span></div>
          <Assign members={members} intent="reset-password" hidden={{}} button="🔑 Reset" />
        </div>
      </div>
    </section>
  );
}
