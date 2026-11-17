import { and, asc, eq, ne } from "drizzle-orm";
import { Form, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/admin.members";
import type { loader as rootLoader } from "../root";
import { PageHead } from "../components/Dash";
import { getDb, schema, type Db } from "../db";
import { clearLoginFailures, setPasswordHash } from "../lib/accounts.server";
import { departmentName, isPosition, POSITION_LABELS, POSITIONS, roleAfterLeadershipChange } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { hashPassword } from "../lib/password";
import { isRole, type Role } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Roles & positions · Gibi Gubae" }];
}

/** Roles an admin picks by hand. "Department leader" is automatic: it comes from leading a department. */
const PICKABLE = ["member", "cafe", "finance", "admin"] as const;
const ROLE_LABELS: Record<Role, string> = { member: "Member", dept_leader: "Member", finance: "Finance", cafe: "Cafe coordinator", admin: "Admin" };

/** 10 characters without look-alikes (0/O, 1/l/I). */
function temporaryPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join("");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const me = await requirePermission(request, env, "member:manage");
  const db = getDb(env.DB);
  const [members, departments, leads] = await Promise.all([
    db
      .select({
        userId: schema.user.id,
        memberId: schema.members.id,
        fullName: schema.members.fullName,
        studentId: schema.members.studentId,
        phone: schema.members.phone,
        telegramUsername: schema.user.telegramUsername,
        telegramId: schema.user.telegramId,
        fieldOfStudy: schema.members.fieldOfStudy,
        yearOfStudy: schema.members.yearOfStudy,
        role: schema.user.role,
        position: schema.user.position,
      })
      .from(schema.members)
      .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
      .where(eq(schema.members.status, "active"))
      .orderBy(asc(schema.members.fullName)),
    db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder) }),
    db
      .select({ memberId: schema.departmentMembers.memberId, departmentId: schema.departmentMembers.departmentId })
      .from(schema.departmentMembers)
      .where(and(eq(schema.departmentMembers.role, "leader"), eq(schema.departmentMembers.status, "active"))),
  ]);
  const leadsBy = new Map(leads.map((l) => [l.memberId, l.departmentId]));
  return {
    myId: me.id,
    departments: departments.map((d) => ({ id: d.id, nameOm: d.nameOm, nameAm: d.nameAm })),
    members: members.map((m) => ({ ...m, leads: leadsBy.get(m.memberId) ?? "" })),
  };
}

/** Makes `memberId` lead `departmentId` (or nothing): joins them to it if needed; one department per person. */
async function setLeadership(db: Db, memberId: string, departmentId: string | null) {
  await db
    .update(schema.departmentMembers)
    .set({ role: "member" })
    .where(and(eq(schema.departmentMembers.memberId, memberId), eq(schema.departmentMembers.role, "leader")));
  if (!departmentId) return;
  await db
    .insert(schema.departmentMembers)
    .values({ departmentId, memberId, role: "leader", status: "active" })
    .onConflictDoUpdate({
      target: [schema.departmentMembers.departmentId, schema.departmentMembers.memberId],
      set: { role: "leader", status: "active", updatedAt: new Date() },
    });
}

async function leadsAny(db: Db, memberId: string) {
  return Boolean(
    await db.query.departmentMembers.findFirst({
      where: and(eq(schema.departmentMembers.memberId, memberId), eq(schema.departmentMembers.role, "leader"), eq(schema.departmentMembers.status, "active")),
      columns: { id: true },
    }),
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const me = await requirePermission(request, env, "member:manage");
  const db = getDb(env.DB);
  const form = await request.formData();
  const userId = String(form.get("userId") ?? "");
  const target = await db.query.members.findFirst({
    where: eq(schema.members.userId, userId),
    columns: { id: true, fullName: true, studentIdKey: true },
  });
  if (!target) throw new Response("Member not found", { status: 404 });

  if (form.get("intent") === "reset-password") {
    // A temporary password the admin passes on; the member changes it on My account
    const temp = temporaryPassword();
    await setPasswordHash(db, userId, await hashPassword(temp));
    if (target.studentIdKey) await clearLoginFailures(db, target.studentIdKey);
    return { message: `Temporary password for ${target.fullName}: ${temp} — give it to them privately; they can change it on My account.` };
  }

  const picked = form.get("role");
  const positionRaw = form.get("position");
  const position = positionRaw === "" || positionRaw === null ? null : positionRaw;
  const leadsRaw = String(form.get("leads") ?? "");
  if (!isRole(picked) || picked === "dept_leader") return { message: "Unknown role." };
  if (position !== null && !isPosition(position)) return { message: "Unknown position." };
  const dept = leadsRaw ? await db.query.departments.findFirst({ where: eq(schema.departments.id, leadsRaw), columns: { id: true } }) : null;
  if (leadsRaw && !dept) return { message: "Unknown department." };

  // The three positions (ዋና ሰብሳቢ, ምክትል ሰብሳቢ, ጸሐፊ) come with admin access
  const base: Role = position ? "admin" : picked;
  // Prevents an admin locking everyone (including themselves) out
  if (userId === me.id && base !== "admin") return { message: "You can't remove your own admin access. Ask another admin." };

  await setLeadership(db, target.id, dept?.id ?? null);
  const role = roleAfterLeadershipChange(base === "admin" || base === "cafe" || base === "finance" ? base : "member", await leadsAny(db, target.id));

  // Each position belongs to one person: whoever had it loses it (and the admin access that came with it)
  if (position) {
    const previous = await db.query.user.findFirst({
      where: and(eq(schema.user.position, position), ne(schema.user.id, userId)),
      columns: { id: true },
    });
    if (previous) {
      const prevMember = await db.query.members.findFirst({ where: eq(schema.members.userId, previous.id), columns: { id: true } });
      const prevRole = roleAfterLeadershipChange("member", prevMember ? await leadsAny(db, prevMember.id) : false);
      await db.update(schema.user).set({ position: null, role: prevRole }).where(eq(schema.user.id, previous.id));
    }
  }
  await db.update(schema.user).set({ role, position }).where(eq(schema.user.id, userId));
  return { message: `Saved: ${target.fullName}.` };
}

export default function RolesPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const { members, myId, departments } = loaderData;

  return (
    <section className="page wide">
      <PageHead
        back={{ to: "/dashboard", label: "Dashboard" }}
        title="Roles & positions"
        sub={`${members.length} active members · changes apply within 5 minutes`}
      />
      <div className="card">
        <ul className="role-legend">
          <li><strong>Position</strong> (ዋና ሰብሳቢ, ምክትል ሰብሳቢ, ጸሐፊ): gives admin access. Removing it removes admin access.</li>
          <li><strong>Leads department</strong>: makes them that department's leader (adds them to it if needed). They then manage it from their dashboard.</li>
          <li><strong>Role</strong>: Cafe coordinator scans QR codes at fasts; Admin gives full access without a position.</li>
        </ul>
      </div>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <div className="role-list">
        {members.map((m) => {
          const fromPosition = Boolean(m.position);
          return (
            <div key={m.userId} className="card role-row">
              <div className="role-who">
                <strong>{m.fullName}</strong>
                <span className="muted">{m.studentId} · {m.fieldOfStudy} · {formatYear(m.yearOfStudy)}</span>
                <span className="muted">
                  {m.telegramId ? (m.telegramUsername ? `@${m.telegramUsername}` : "Telegram ✓") : <span className="pill pill-pay-unpaid">No Telegram</span>}
                  {m.phone && <> · <a href={`tel:${m.phone}`}>{m.phone}</a></>}
                </span>
              </div>
              <Form method="post" className="role-form">
                <input type="hidden" name="userId" value={m.userId} />
                <label className="field">
                  <span>Position</span>
                  <select name="position" defaultValue={m.position ?? ""}>
                    <option value="">No position</option>
                    {POSITIONS.map((p) => <option key={p} value={p} lang={lang}>{POSITION_LABELS[p][lang]}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Leads department</span>
                  <select name="leads" defaultValue={m.leads} lang={lang}>
                    <option value="">None</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{departmentName(d, lang)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Role</span>
                  {fromPosition ? (
                    <>
                      <input type="hidden" name="role" value="member" />
                      <span className="readonly">Admin (from position)</span>
                    </>
                  ) : (
                    <select name="role" defaultValue={m.role === "dept_leader" ? "member" : m.role} disabled={m.userId === myId}>
                      {PICKABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  )}
                  {!fromPosition && m.userId === myId && <input type="hidden" name="role" value="admin" />}
                </label>
                <button className="btn btn-primary btn-sm" disabled={busy}>Save</button>
              </Form>
              <Form
                method="post"
                onSubmit={(e) => {
                  if (!window.confirm(`Give ${m.fullName} a new temporary password? Their old password stops working.`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="intent" value="reset-password" />
                <input type="hidden" name="userId" value={m.userId} />
                <button className="link-btn" disabled={busy}>🔑 Reset password</button>
              </Form>
            </div>
          );
        })}
      </div>
    </section>
  );
}
