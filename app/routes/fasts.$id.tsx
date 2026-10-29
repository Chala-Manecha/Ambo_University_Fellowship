import { and, asc, count, eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/fasts.$id";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { todayInAddis } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { isFastOn, MEAL_LABELS } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { can } from "../lib/permissions";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Fast · Gibi Gubae" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "fast:scan");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, params.id) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const today = todayInAddis();

  const registrants = await db
    .select({
      memberId: schema.members.id,
      fullName: schema.members.fullName,
      studentId: schema.members.studentId,
      phone: schema.members.phone,
    })
    .from(schema.fastRegistrations)
    .innerJoin(schema.members, eq(schema.members.id, schema.fastRegistrations.memberId))
    .where(eq(schema.fastRegistrations.fastId, fast.id))
    .orderBy(asc(schema.members.fullName));

  const perMember = await db
    .select({ memberId: schema.fastCheckins.memberId, n: count() })
    .from(schema.fastCheckins)
    .where(eq(schema.fastCheckins.fastId, fast.id))
    .groupBy(schema.fastCheckins.memberId);
  const todayByMeal = await db
    .select({ meal: schema.fastCheckins.meal, n: count() })
    .from(schema.fastCheckins)
    .where(and(eq(schema.fastCheckins.fastId, fast.id), eq(schema.fastCheckins.date, today)))
    .groupBy(schema.fastCheckins.meal);

  const meals = new Map(perMember.map((p) => [p.memberId, p.n]));
  return {
    fast,
    isOn: isFastOn(fast, today),
    canManage: can(user.role, "fast:manage"),
    today: fast.meals.map((m) => ({ meal: m, n: todayByMeal.find((t) => t.meal === m)?.n ?? 0 })),
    registrants: registrants.map((r) => ({ ...r, meals: meals.get(r.memberId) ?? 0 })),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "fast:manage");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, params.id) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add") {
    // Admins can register someone who can't do it themselves
    const studentId = String(form.get("studentId") ?? "").trim();
    const member = await db.query.members.findFirst({
      where: and(eq(schema.members.studentId, studentId), eq(schema.members.status, "active")),
      columns: { id: true, fullName: true },
    });
    if (!member) return { message: `No active member with student ID "${studentId}".` };
    await db.insert(schema.fastRegistrations).values({ fastId: fast.id, memberId: member.id }).onConflictDoNothing();
    return { message: `${member.fullName} is registered.` };
  }
  if (intent === "remove") {
    await db
      .delete(schema.fastRegistrations)
      .where(and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, String(form.get("memberId")))));
    return { message: "Removed." };
  }
  if (intent === "delete") {
    await db.delete(schema.fasts).where(eq(schema.fasts.id, fast.id));
    throw redirect("/fasts");
  }
  throw new Response("Unknown action", { status: 400 });
}

export default function FastPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { fast, isOn, canManage, today, registrants } = loaderData;

  return (
    <section className="page wide">
      <p className="muted"><Link to="/fasts">← Fasts</Link></p>
      <h1>{fast.name}</h1>
      <p className="muted" lang={lang}>{formatEc(fast.startDate, lang)} – {formatEc(fast.endDate, lang)}</p>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <div className="stat-row">
        <div className="stat"><span className="stat-n">{registrants.length}</span><span className="muted">registered</span></div>
        {today.map((t) => (
          <div key={t.meal} className="stat">
            <span className="stat-n">{t.n}</span>
            <span className="muted" lang={lang}>{MEAL_LABELS[t.meal][lang]} today</span>
          </div>
        ))}
      </div>
      {isOn ? (
        <Link to={`/fasts/${fast.id}/scan`} className="btn btn-primary">Open scanner</Link>
      ) : (
        <p className="muted">The scanner opens on the days of the fast.</p>
      )}

      <h2>Registered ({registrants.length})</h2>
      {canManage && (
        <Form method="post" className="inline-form">
          <input type="hidden" name="intent" value="add" />
          <label className="field">
            <span>Add by student ID</span>
            <input name="studentId" required maxLength={30} placeholder="UGR/1234/16" />
          </label>
          <button className="btn btn-quiet" disabled={busy}>Add</button>
        </Form>
      )}
      {registrants.length === 0 ? (
        <p className="muted">Nobody yet. Members register on the Fasts page.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Student ID</th><th>Phone</th><th>Meals taken</th>{canManage && <th><span className="visually-hidden">Actions</span></th>}</tr></thead>
            <tbody>
              {registrants.map((r) => (
                <tr key={r.memberId}>
                  <td>{r.fullName}</td>
                  <td>{r.studentId}</td>
                  <td><a href={`tel:${r.phone}`}>{r.phone}</a></td>
                  <td>{r.meals}</td>
                  {canManage && (
                    <td>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="memberId" value={r.memberId} />
                        <button className="btn btn-quiet btn-sm" disabled={busy}>Remove</button>
                      </Form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <Form
          method="post"
          className="danger-zone"
          onSubmit={(e) => {
            if (!window.confirm("Delete this fast, its registrations and meal records?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <button className="btn btn-quiet btn-sm" disabled={busy}>Delete fast</button>
        </Form>
      )}
    </section>
  );
}
