import { Link, redirect } from "react-router";
import type { Route } from "./+types/portal";
import { getDb } from "../db";
import { getLeaderDepartmentIds } from "../lib/departments.server";
import { hasDashboard } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Choose · Gibi Gubae" }];
}

/** After sign-in, people with a leadership job choose where to go. Everyone else goes to their account. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const leads = await getLeaderDepartmentIds(getDb(env.DB), user.id);
  if (!hasDashboard(user.role) && leads.length === 0) throw redirect("/account");
  return { name: user.name };
}

export default function Portal({ loaderData }: Route.ComponentProps) {
  return (
    <section className="page narrow">
      <p className="portal-intro">Welcome, {loaderData.name}. Where would you like to go? You can switch any time from the top of the page.</p>
      <div className="portal">
        <Link to="/account" className="portal-card">
          <span className="portal-icon" aria-hidden="true">🙋</span>
          <strong>Member</strong>
          <span>My dashboard — QR code, contributions, fasts, my details</span>
        </Link>
        <Link to="/lead" className="portal-card">
          <span className="portal-icon" aria-hidden="true">🗂️</span>
          <strong>Leadership</strong>
          <span>The departments I lead, and ጽህፈት ቤት for its three officers</span>
        </Link>
      </div>
    </section>
  );
}
