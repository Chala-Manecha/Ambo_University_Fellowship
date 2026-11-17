import { redirect } from "react-router";
import type { Route } from "./+types/me";
import { getDb } from "../db";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { hasDashboard } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

/** Where sign-in lands: ordinary members go to their dashboard; anyone with a leadership job chooses. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  if (hasDashboard(user.role)) throw redirect("/portal");
  const leads = await getLeaderDepartmentIds(getDb(env.DB), user.id);
  throw redirect(leads.length ? "/portal" : "/account");
}
