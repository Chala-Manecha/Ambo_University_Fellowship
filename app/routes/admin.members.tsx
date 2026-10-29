import { and, asc, eq, ne } from "drizzle-orm";
import { Form, Link, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/admin.members";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { isPosition, POSITION_LABELS, POSITIONS } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { isRole, ROLES } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Members · Gibi Gubae" }];
}

const ROLE_LABELS = { member: "Member", dept_leader: "Department leader", finance: "Finance", cafe: "Cafe coordinator", admin: "Admin" } as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const me = await requirePermission(request, env, "member:manage");
  const members = await getDb(env.DB)
    .select({
      userId: schema.user.id,
      fullName: schema.members.fullName,
      phone: schema.members.phone,
      telegramUsername: schema.user.telegramUsername,
      fieldOfStudy: schema.members.fieldOfStudy,
      yearOfStudy: schema.members.yearOfStudy,
      role: schema.user.role,
      position: schema.user.position,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(eq(schema.members.status, "active"))
    .orderBy(asc(schema.members.fullName));
  return { members, myId: me.id };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const me = await requirePermission(request, env, "member:manage");
  const form = await request.formData();
  const userId = String(form.get("userId") ?? "");
  const role = form.get("role");
  const positionRaw = form.get("position");
  const position = positionRaw === "" ? null : positionRaw;

  if (!isRole(role)) return { message: "Unknown role." };
  if (position !== null && !isPosition(position)) return { message: "Unknown position." };
  // Prevents an admin locking everyone (including themselves) out
  if (userId === me.id && role !== "admin") return { message: "You can't remove your own admin role. Ask another admin." };

  const db = getDb(env.DB);
  const target = await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { id: true } });
  if (!target) throw new Response("Member not found", { status: 404 });

  // Each position belongs to one person; executive positions get admin access
  const statements = [];
  if (position) {
    statements.push(
      db.update(schema.user).set({ position: null }).where(and(eq(schema.user.position, position), ne(schema.user.id, userId))),
    );
  }
  statements.push(
    db.update(schema.user).set({ role: position ? "admin" : role, position }).where(eq(schema.user.id, userId)),
  );
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return { message: position && role !== "admin" ? "Saved. Positions come with admin access, so the role was set to Admin." : "Saved." };
}

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const { members, myId } = loaderData;
  return (
    <section className="page wide">
      <p className="muted"><Link to="/admin">← Admin</Link></p>
      <h1>Members ({members.length})</h1>
      <p className="muted">
        Changes apply at the member's next sign-in or within 5 minutes. Department leaders are appointed on each department's page.
      </p>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Telegram</th><th>Study</th><th>Role & position</th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <td>{m.fullName}</td>
                <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                <td>{m.telegramUsername ? `@${m.telegramUsername}` : "—"}</td>
                <td>{m.fieldOfStudy} · {formatYear(m.yearOfStudy)}</td>
                <td>
                  <Form method="post" className="row-actions">
                    <input type="hidden" name="userId" value={m.userId} />
                    <select name="role" defaultValue={m.role} aria-label={`Role for ${m.fullName}`} disabled={m.userId === myId}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    {m.userId === myId && <input type="hidden" name="role" value="admin" />}
                    <select name="position" defaultValue={m.position ?? ""} aria-label={`Position for ${m.fullName}`}>
                      <option value="">No position</option>
                      {POSITIONS.map((p) => <option key={p} value={p} lang={lang}>{POSITION_LABELS[p][lang]}</option>)}
                    </select>
                    <button className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>Save</button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
