import { and, asc, eq } from "drizzle-orm";
import { Form, Link, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/departments";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { sendMessage } from "../lib/bot.server";
import { canManageDepartment, departmentName } from "../lib/departments";
import { getDepartmentLeaderTelegramIds, getLeaderDepartmentIds, getMemberByUser } from "../lib/departments.server";
import { DEFAULT_LANG } from "../lib/lang";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Departments · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const member = await getMemberByUser(db, user.id);

  const departments = await db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder) });
  const mine = member
    ? await db
        .select({ departmentId: schema.departmentMembers.departmentId, status: schema.departmentMembers.status, role: schema.departmentMembers.role })
        .from(schema.departmentMembers)
        .where(eq(schema.departmentMembers.memberId, member.id))
    : [];
  const leaderOf = await getLeaderDepartmentIds(db, user.id);

  return {
    memberStatus: member?.status ?? null,
    departments: departments.map((d) => {
      const m = mine.find((x) => x.departmentId === d.id);
      return {
        id: d.id,
        nameOm: d.nameOm,
        nameAm: d.nameAm,
        myStatus: m?.status ?? null,
        isLeader: m?.role === "leader" && m.status === "active",
        canManage: canManageDepartment(user.role, leaderOf, d.id),
      };
    }),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await requireUser(request, env);
  const form = await request.formData();
  const departmentId = String(form.get("departmentId") ?? "");
  const db = getDb(env.DB);

  const member = await getMemberByUser(db, user.id);
  if (!member || member.status !== "active") {
    return { message: "Only approved members can join a department." };
  }
  const dept = await db.query.departments.findFirst({ where: eq(schema.departments.id, departmentId) });
  if (!dept) throw new Response("Department not found", { status: 404 });

  const existing = await db.query.departmentMembers.findFirst({
    where: and(eq(schema.departmentMembers.departmentId, dept.id), eq(schema.departmentMembers.memberId, member.id)),
    columns: { id: true, status: true },
  });
  if (existing && existing.status !== "rejected") return { message: "You've already asked to join this department." };

  if (existing) {
    await db.update(schema.departmentMembers).set({ status: "pending" }).where(eq(schema.departmentMembers.id, existing.id));
  } else {
    await db
      .insert(schema.departmentMembers)
      .values({ departmentId: dept.id, memberId: member.id })
      .onConflictDoNothing();
  }

  ctx.waitUntil(
    getDepartmentLeaderTelegramIds(db, dept.id).then((ids) =>
      Promise.all(
        ids.map((id) =>
          sendMessage(env, id, `${member.fullName} asked to join ${dept.nameOm} / ${dept.nameAm}.\nReview: ${env.PUBLIC_SITE_URL}/departments/${dept.id}`),
        ),
      ),
    ),
  );
  return { message: "Request sent. A department leader will review it." };
}

const STATUS_TEXT = { pending: "Request sent", active: "Member", rejected: "Not approved" } as const;

export default function Departments({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const { departments, memberStatus } = loaderData;
  const canJoin = memberStatus === "active";

  return (
    <section className="page">
      <h1>Departments</h1>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}
      {!canJoin && (
        <p className="muted">
          {memberStatus === "pending"
            ? "You can join departments once your registration is approved."
            : memberStatus === null
              ? "Register as a member to join departments."
              : "Only active members can join departments."}
        </p>
      )}
      <ul className="dept-grid">
        {departments.map((d) => (
          <li key={d.id} className="dept-card">
            <h2 lang={lang}>{departmentName(d, lang)}</h2>
            <div className="dept-card-actions">
              {d.myStatus && d.myStatus !== "rejected" ? (
                <span className={`pill pill-${d.myStatus}`}>{d.isLeader ? "Leader" : STATUS_TEXT[d.myStatus]}</span>
              ) : (
                canJoin && (
                  <Form method="post">
                    <input type="hidden" name="departmentId" value={d.id} />
                    <button className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>
                      {d.myStatus === "rejected" ? "Ask again" : "Join"}
                    </button>
                  </Form>
                )
              )}
              {d.canManage && (
                <Link to={`/departments/${d.id}`} className="btn btn-primary btn-sm">Manage</Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
