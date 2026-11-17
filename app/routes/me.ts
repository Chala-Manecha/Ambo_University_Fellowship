import { redirect } from "react-router";
import type { Route } from "./+types/me";
import { getDb } from "../db";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { hasDashboard } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

/** "My page": staff and department leaders go to the dashboard, everyone else to their account. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  if (hasDashboard(user.role)) throw redirect("/dashboard");
  const leads = await getLeaderDepartmentIds(getDb(env.DB), user.id);
  throw redirect(leads.length ? "/dashboard" : "/account");
}
