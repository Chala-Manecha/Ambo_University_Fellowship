import { count, eq } from "drizzle-orm";
import { Link } from "react-router";
import type { Route } from "./+types/admin";
import { getDb, schema } from "../db";
import { can } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Admin · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  if (!can(user.role, "member:manage")) throw new Response("You don't have access to this page.", { status: 403 });
  const db = getDb(env.DB);
  const [pending] = await db.select({ n: count() }).from(schema.members).where(eq(schema.members.status, "pending"));
  const [active] = await db.select({ n: count() }).from(schema.members).where(eq(schema.members.status, "active"));
  return { pending: pending.n, active: active.n };
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { pending, active } = loaderData;
  const links = [
    { to: "/admin/registrations", title: "Review registrations", note: pending ? `${pending} waiting` : "Nothing waiting" },
    { to: "/admin/members", title: "Members, roles & positions", note: `${active} active members` },
    { to: "/departments", title: "Departments", note: "Join requests, leaders, department attendance" },
    { to: "/attendance", title: "Fellowship attendance", note: "Programs the whole fellowship attends" },
    { to: "/admin/telegram", title: "Telegram bot", note: "Connection status" },
  ];
  return (
    <section className="page">
      <h1>Admin</h1>
      <ul className="dept-grid">
        {links.map((l) => (
          <li key={l.to} className="dept-card">
            <h2><Link to={l.to}>{l.title}</Link></h2>
            <p className="muted">{l.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
