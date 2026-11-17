import { asc } from "drizzle-orm";
import type { Route } from "./+types/members.csv";
import { LEARNING, SERVICES, TITLES } from "../content/member-options";
import { getDb, schema } from "../db";
import { departmentName } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { langFromCookie } from "../lib/lang";
import { filterMembers, toCsv } from "../lib/member-filters";
import { loadMemberList } from "../lib/members.server";
import { can } from "../lib/permissions";
import { formatYear } from "../lib/registration";
import { requireMemberList } from "../lib/access.server";

/** The members list as CSV, with the same filters as the page. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user } = await requireMemberList(request, env, db);
  const lang = langFromCookie(request.headers.get("Cookie"));
  const [members, departments] = await Promise.all([
    loadMemberList(db),
    db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder) }),
  ]);
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const { rows, status } = filterMembers(members, new URL(request.url).searchParams, [...deptById.keys()], can(user.role, "registration:review"));

  const csv = toCsv(
    ["Name", "Christian name", "Title", "Gender", "Student ID", "Field", "Year", "Birth date (EC)", "Phone", "Telegram", "Departments", "Wants to serve", "Other", "Wants to learn"],
    rows.map((m) => [
      m.fullName,
      m.christianName,
      m.title && m.title in TITLES ? TITLES[m.title as keyof typeof TITLES][lang] : "",
      m.gender,
      m.studentId,
      m.fieldOfStudy,
      formatYear(m.yearOfStudy),
      m.birthDate ? formatEc(m.birthDate, lang) : "",
      m.phone,
      m.telegramUsername ? `@${m.telegramUsername}` : "",
      m.departments.map((id) => { const d = deptById.get(id); return d ? departmentName(d, lang) : id; }).join("; "),
      (m.services ?? []).map((k) => SERVICES[k as keyof typeof SERVICES]?.[lang] ?? k).join("; "),
      m.otherService,
      (m.learning ?? []).map((k) => LEARNING[k as keyof typeof LEARNING]?.[lang] ?? k).join("; "),
    ]),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="members-${status}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
