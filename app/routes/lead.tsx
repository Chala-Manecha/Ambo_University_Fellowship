import { asc, eq, and, inArray } from "drizzle-orm";
import { Link, redirect, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/lead";
import type { loader as rootLoader } from "../root";
import { PageHead } from "../components/Dash";
import { getDb, schema } from "../db";
import { departmentName } from "../lib/departments";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { DEFAULT_LANG } from "../lib/lang";
import { can, hasDashboard } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Leadership · Gibi Gubae" }];
}

/** Leadership home: ጽህፈት ቤት (admins) and the departments this person runs (admins: all of them). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const leads = await getLeaderDepartmentIds(db, user.id);
  const isAdmin = can(user.role, "department:manage");
  if (!isAdmin && leads.length === 0 && !hasDashboard(user.role)) throw redirect("/account");

  const departments = await db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder) });
  const shown = isAdmin ? departments : departments.filter((d) => leads.includes(d.id));
  const ids = shown.map((d) => d.id);
  const rows = ids.length
    ? await db
        .select({ departmentId: schema.departmentMembers.departmentId, status: schema.departmentMembers.status })
        .from(schema.departmentMembers)
        .innerJoin(schema.members, eq(schema.members.id, schema.departmentMembers.memberId))
        .where(and(inArray(schema.departmentMembers.departmentId, ids), inArray(schema.departmentMembers.status, ["pending", "active"]), eq(schema.members.status, "active")))
    : [];
  return {
    office: can(user.role, "member:manage"),
    departments: shown.map((d) => ({
      id: d.id,
      nameOm: d.nameOm,
      nameAm: d.nameAm,
      members: rows.filter((r) => r.departmentId === d.id && r.status === "active").length,
      requests: rows.filter((r) => r.departmentId === d.id && r.status === "pending").length,
    })),
  };
}

export default function Lead({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const { office, departments } = loaderData;
  return (
    <section className="page wide">
      <PageHead title="All departments" sub="Open one to manage it." />
      <div className="dept-grid">
        {office && (
          <Link to="/office" className="dept-card dept-card--office">
            <strong lang="am">ጽህፈት ቤት</strong>
            <span>Members, registrations, roles, contributions, fasts</span>
          </Link>
        )}
        {departments.map((d) => (
          <Link key={d.id} to={`/departments/${d.id}`} className="dept-card">
            <strong lang={lang}>{departmentName(d, lang)}</strong>
            <span>
              {d.members} member{d.members === 1 ? "" : "s"}
              {d.requests > 0 && <b className="dept-card-alert"> · {d.requests} request{d.requests === 1 ? "" : "s"}</b>}
            </span>
          </Link>
        ))}
      </div>
      {departments.length === 0 && !office && <p className="muted">You don't lead a department yet.</p>}
    </section>
  );
}
