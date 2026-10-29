import { useEffect, useState } from "react";
import { eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/register";
import type { loader as rootLoader } from "../root";
import { Turnstile } from "../components/Turnstile";
import { botLink } from "../content/bot";
import { HOME } from "../content/site";
import { getDb, schema, type Db } from "../db";
import { notifyAdmins } from "../lib/bot.server";
import { DEFAULT_LANG } from "../lib/lang";
import { formatYear, GRADUATED, registrationFormSchema } from "../lib/registration";
import { requireUser } from "../lib/session.server";
import { verifyTurnstile } from "../lib/turnstile.server";

export function meta() {
  return [{ title: "Register · Gibi Gubae" }];
}

/** The phone number this Telegram account shared with the bot, if any. */
async function verifiedPhone(db: Db, telegramId: string | null) {
  if (!telegramId) return null;
  const contact = await db.query.telegramContacts.findFirst({
    where: eq(schema.telegramContacts.telegramId, telegramId),
    columns: { phone: true },
  });
  return contact?.phone ?? null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const existing = await db.query.members.findFirst({
    where: eq(schema.members.userId, user.id),
    columns: { status: true },
  });
  if (existing) throw redirect("/account");
  return {
    userName: user.name,
    phone: await verifiedPhone(db, user.telegramId),
    botUrl: botLink(env.TELEGRAM_BOT_USERNAME),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  };
}

type FieldErrors = Partial<Record<string, string>>;

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await requireUser(request, env);
  const form = await request.formData();
  const db = getDb(env.DB);

  const phone = await verifiedPhone(db, user.telegramId);
  if (!phone) {
    return { formError: "Share your phone number with the fellowship bot first.", fieldErrors: {} as FieldErrors };
  }

  const human = await verifyTurnstile(
    form.get("cf-turnstile-response"),
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!human) {
    return { formError: "The security check didn't pass. Complete it and submit again.", fieldErrors: {} as FieldErrors };
  }

  const parsed = registrationFormSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { formError: "Fix the highlighted fields.", fieldErrors };
  }

  // userId is UNIQUE: a second submission from the same login is ignored
  const inserted = await db
    .insert(schema.members)
    .values({ ...parsed.data, phone, userId: user.id })
    .onConflictDoNothing({ target: schema.members.userId })
    .returning({ id: schema.members.id });

  if (inserted.length > 0) {
    const d = parsed.data;
    ctx.waitUntil(
      notifyAdmins(
        env,
        `New registration: ${d.fullName} (${d.fieldOfStudy}, ${formatYear(d.yearOfStudy)}).\nReview: ${env.PUBLIC_SITE_URL}/admin/registrations`,
      ),
    );
  }

  throw redirect("/account?registered=1");
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const errors = actionData?.fieldErrors ?? {};
  const submitting = nav.state === "submitting";
  // A Turnstile token works once. After every server reply, mount a fresh widget.
  const [widgetKey, setWidgetKey] = useState(0);
  useEffect(() => {
    if (actionData) setWidgetKey((k) => k + 1);
  }, [actionData]);

  // Registration starts in the bot, which collects a verified phone number.
  if (!loaderData.phone) {
    return (
      <section className="page narrow">
        <h1>Member registration</h1>
        <p>
          Registration starts in Telegram. Open the fellowship bot, share your phone number, then tap{" "}
          <strong>Continue registration</strong>.
        </p>
        <a className="btn btn-primary" href={loaderData.botUrl}>Open the bot</a>
      </section>
    );
  }

  return (
    <section className="page narrow">
      <h1>Member registration</h1>
      <p lang={lang} className="intro">{HOME[lang].registerIntro}</p>

      {actionData?.formError && (
        <p className="form-error" role="alert">{actionData.formError}</p>
      )}

      <Form method="post" className="form" noValidate>
        <Field label="Full name" name="fullName" error={errors.fullName} defaultValue={loaderData.userName} required autoComplete="name" />
        <Field label="Christian name" name="christianName" error={errors.christianName} hint="Optional" />

        <fieldset className="field" aria-invalid={Boolean(errors.gender)}>
          <legend>Gender</legend>
          <div className="choices">
            <label><input type="radio" name="gender" value="male" required /> Male</label>
            <label><input type="radio" name="gender" value="female" /> Female</label>
          </div>
          {errors.gender && <span className="field-error">{errors.gender}</span>}
        </fieldset>

        <div className="field">
          <span>Phone <small>Shared from Telegram</small></span>
          <p className="readonly">{loaderData.phone}</p>
        </div>
        <Field label="Student ID" name="studentId" error={errors.studentId} required />
        <Field label="Field of study" name="fieldOfStudy" error={errors.fieldOfStudy} required />

        <label className="field">
          <span>Year of study</span>
          <select name="yearOfStudy" required defaultValue="" aria-invalid={Boolean(errors.yearOfStudy)}>
            <option value="" disabled>Choose year</option>
            {[1, 2, 3, 4, 5, 6, 7].map((y) => (
              <option key={y} value={y}>{formatYear(y)}</option>
            ))}
            <option value={GRADUATED}>{formatYear(GRADUATED)}</option>
          </select>
          {errors.yearOfStudy && <span className="field-error">{errors.yearOfStudy}</span>}
        </label>

        <fieldset className="field" aria-invalid={Boolean(errors.contentLanguage)}>
          <legend>Preferred language for teaching and messages</legend>
          <p lang={lang} className="field-hint">{HOME[lang].languageQuestion}</p>
          <div className="choices">
            <label><input type="radio" name="contentLanguage" value="om" defaultChecked={lang === "om"} /> <span lang="om">Afaan Oromoo</span></label>
            <label><input type="radio" name="contentLanguage" value="am" defaultChecked={lang === "am"} /> <span lang="am">አማርኛ</span></label>
          </div>
        </fieldset>

        <label className="field">
          <span>Anything we should know? <small>Optional</small></span>
          <textarea name="note" rows={3} maxLength={500} />
        </label>

        <Turnstile key={widgetKey} siteKey={loaderData.turnstileSiteKey} />

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit registration"}
        </button>
      </Form>
      <p className="muted">Already registered? <Link to="/account">Check your status</Link></p>
    </section>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  ...input
}: { label: string; name: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>
        {label} {hint && <small>{hint}</small>}
      </span>
      <input name={name} aria-invalid={Boolean(error)} {...input} />
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
