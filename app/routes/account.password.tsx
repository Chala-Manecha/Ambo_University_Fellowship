import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.password";
import { z } from "zod";
import { getDb } from "../db";
import { getPasswordHash, setPasswordHash } from "../lib/accounts.server";
import { hashPassword, passwordSchema, verifyPassword } from "../lib/password";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Password · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  return { hasPassword: Boolean(await getPasswordHash(getDb(env.DB), user.id)) };
}

const schema = z
  .object({ current: z.string().optional(), password: passwordSchema, password2: z.string() })
  .refine((d) => d.password === d.password2, { message: "The two passwords don't match", path: ["password2"] });

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const existing = await getPasswordHash(db, user.id);
  // Changing a password needs the current one; setting the first one doesn't
  if (existing && !(await verifyPassword(parsed.data.current ?? "", existing))) {
    return { error: "Your current password is wrong." };
  }
  await setPasswordHash(db, user.id, await hashPassword(parsed.data.password));
  throw redirect("/account?password=1");
}

export default function PasswordPage({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <section className="page narrow">
      <p className="muted"><Link to="/account">← My account</Link></p>
      <h1>{loaderData.hasPassword ? "Change password" : "Set a password"}</h1>
      <p className="muted">You sign in on the website with your student ID and this password.</p>
      {actionData?.error && <p className="form-error" role="alert">{actionData.error}</p>}
      <Form method="post" className="form">
        {loaderData.hasPassword && (
          <label className="field">
            <span>Current password</span>
            <input name="current" type="password" required autoComplete="current-password" />
          </label>
        )}
        <label className="field">
          <span>New password <small>At least 8 characters</small></span>
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Repeat new password</span>
          <input name="password2" type="password" required minLength={8} autoComplete="new-password" />
        </label>
        <button className="btn btn-primary" disabled={busy}>Save password</button>
      </Form>
    </section>
  );
}
