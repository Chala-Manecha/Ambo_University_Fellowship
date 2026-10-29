import { eq } from "drizzle-orm";
import { Form, Link } from "react-router";
import type { Route } from "./+types/account";
import { getDb, schema } from "../db";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "My account · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const member = await getDb(env.DB).query.members.findFirst({
    where: eq(schema.members.userId, user.id),
    columns: { status: true, fullName: true, createdAt: true },
  });
  const justRegistered = new URL(request.url).searchParams.has("registered");
  return { user, member: member ?? null, justRegistered };
}

const STATUS_TEXT = {
  pending: "Your registration is waiting for review by the fellowship leaders.",
  active: "You're a registered member.",
  rejected: "Your registration wasn't approved. Contact a fellowship leader on Telegram.",
  alumni: "You're listed as an alumnus. Thank you for your service.",
} as const;

export default function Account({ loaderData }: Route.ComponentProps) {
  const { user, member, justRegistered } = loaderData;
  return (
    <section className="page narrow">
      <h1>My account</h1>
      {justRegistered && <p className="notice" role="status">Registration submitted.</p>}
      <div className="account-id">
        {user.image && <img src={user.image} alt="" width={56} height={56} />}
        <div>
          <strong>{user.name}</strong>
          {user.telegramUsername && <span className="muted">@{user.telegramUsername}</span>}
        </div>
      </div>

      {member ? (
        <p className={`status status-${member.status}`}>{STATUS_TEXT[member.status]}</p>
      ) : (
        <p>
          You haven't registered as a member yet. <Link to="/register">Register now</Link>
        </p>
      )}

      <Form method="post" action="/logout">
        <button className="btn btn-quiet">Sign out</button>
      </Form>
    </section>
  );
}
