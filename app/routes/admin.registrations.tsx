import { asc, eq } from "drizzle-orm";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/admin.registrations";
import { getDb, schema } from "../db";
import { reviewRegistration } from "../lib/registrations.server";
import { formatYear } from "../lib/registration";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Review registrations · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "registration:review");
  const db = getDb(env.DB);
  const pending = await db
    .select({
      id: schema.members.id,
      fullName: schema.members.fullName,
      christianName: schema.members.christianName,
      gender: schema.members.gender,
      phone: schema.members.phone,
      studentId: schema.members.studentId,
      fieldOfStudy: schema.members.fieldOfStudy,
      yearOfStudy: schema.members.yearOfStudy,
      note: schema.members.note,
      createdAt: schema.members.createdAt,
      telegramUsername: schema.user.telegramUsername,
    })
    .from(schema.members)
    .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
    .where(eq(schema.members.status, "pending"))
    .orderBy(asc(schema.members.createdAt));
  return { pending };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const reviewer = await requirePermission(request, env, "registration:review");
  const form = await request.formData();
  const id = String(form.get("memberId") ?? "");
  const decision = form.get("decision");
  if (decision !== "approve" && decision !== "reject") {
    throw new Response("Unknown decision", { status: 400 });
  }

  return reviewRegistration(env, ctx, getDb(env.DB), reviewer.id, id, decision);
}

export default function ReviewRegistrations({ loaderData, actionData }: Route.ComponentProps) {
  const { pending } = loaderData;
  const nav = useNavigation();
  return (
    <section className="page wide">
      <p className="muted"><Link to="/dashboard">← Dashboard</Link></p>
      <h1>Review registrations</h1>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}
      {pending.length === 0 ? (
        <p>No registrations are waiting. New ones appear here as members submit the form.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Gender</th>
                <th>Phone</th>
                <th>Telegram</th>
                <th>Student ID</th>
                <th>Field / year</th>
                <th>Submitted</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.fullName}
                    {m.christianName && <small className="muted"> ({m.christianName})</small>}
                    {m.note && <p className="row-note">{m.note}</p>}
                  </td>
                  <td>{m.gender === "male" ? "Male" : "Female"}</td>
                  <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                  <td>{m.telegramUsername ? `@${m.telegramUsername}` : "—"}</td>
                  <td>{m.studentId}</td>
                  <td>{m.fieldOfStudy} · {formatYear(m.yearOfStudy)}</td>
                  <td>{new Date(m.createdAt).toLocaleDateString("en-GB")}</td>
                  <td>
                    <Form method="post" className="row-actions">
                      <input type="hidden" name="memberId" value={m.id} />
                      <button name="decision" value="approve" className="btn btn-primary btn-sm" disabled={nav.state !== "idle"}>Approve</button>
                      <button name="decision" value="reject" className="btn btn-quiet btn-sm" disabled={nav.state !== "idle"}>Reject</button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
