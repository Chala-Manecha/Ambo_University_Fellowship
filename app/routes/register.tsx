import { useEffect, useState } from "react";
import { asc, eq, inArray } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/register";
import type { loader as rootLoader } from "../root";
import { MemberDetailsFields } from "../components/MemberDetailsFields";
import { Turnstile } from "../components/Turnstile";
import { FORM_TEXT } from "../content/member-options";
import { HOME } from "../content/site";
import { getDb, schema, type Db } from "../db";
import { notifyAdmins, sendMemberQr } from "../lib/bot.server";
import { DEFAULT_LANG } from "../lib/lang";
import { departmentName, todayInAddis } from "../lib/departments";
import { ethiopianPhone, formatYear, formToObject, GRADUATED, registrationFormSchema, studentIdKey } from "../lib/registration";
import { createWebUser, setPasswordHash } from "../lib/accounts.server";
import { hashPassword, passwordSchema } from "../lib/password";
import { getUser, safeRedirect, signInWithStudentId } from "../lib/session.server";
import { z } from "zod";
import { verifyTurnstile } from "../lib/turnstile.server";

export function meta() {
  return [{ title: "Register · Gibi Gubae" }];
}

/** A phone number the person shared with the bot earlier, used to prefill the form. */
async function sharedPhone(db: Db, telegramId: string | null) {
  if (!telegramId) return "";
  const contact = await db.query.telegramContacts.findFirst({
    where: eq(schema.telegramContacts.telegramId, telegramId),
    columns: { phone: true },
  });
  return contact?.phone ?? "";
}

/**
 * Registration works signed out (website) or signed in (opened from the bot).
 * Everyone sets a password, so they can sign in on the website with student ID + password.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await getUser(request, env);
  const db = getDb(env.DB);
  const next = safeRedirect(new URL(request.url).searchParams.get("next"), "/account");
  if (user) {
    const existing = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { status: true } });
    if (existing) throw redirect(next);
  }
  return {
    signedIn: Boolean(user),
    userName: user?.name ?? "",
    phone: await sharedPhone(db, user?.telegramId ?? null),
    next,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    today: todayInAddis(),
    departments: await db.query.departments.findMany({ orderBy: asc(schema.departments.sortOrder) }),
  };
}

type FieldErrors = Partial<Record<string, string>>;

const extraSchema = z
  .object({
    phone: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), ethiopianPhone.optional()),
    password: passwordSchema,
    password2: z.string(),
  })
  .refine((d) => d.password === d.password2, { message: "The two passwords don't match", path: ["password2"] });

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const user = await getUser(request, env);
  const form = await request.formData();
  const db = getDb(env.DB);
  const next = safeRedirect(form.get("next"), "/account");

  const human = await verifyTurnstile(
    form.get("cf-turnstile-response"),
    env.TURNSTILE_SECRET_KEY,
    request.headers.get("CF-Connecting-IP"),
  );
  if (!human) {
    return { formError: "The security check didn't pass. Complete it and submit again.", fieldErrors: {} as FieldErrors };
  }

  const obj = formToObject(form);
  const parsed = registrationFormSchema.safeParse(obj);
  const extra = extraSchema.safeParse(obj);
  // Every field on the form is required (a title only applies to those who have one)
  const missing: FieldErrors = {};
  const filled = (k: string) => typeof obj[k] === "string" && (obj[k] as string).trim() !== "";
  if (!filled("christianName")) missing.christianName = "Enter your Christian name";
  if (!filled("phone")) missing.phone = "Enter your phone number";
  if (!filled("note")) missing.note = "Write something, even “nothing”";
  if (!(obj.services as string[]).length && !filled("otherService")) missing.services = "Choose at least one";
  if (!(obj.learning as string[]).length) missing.learning = "Choose at least one";
  if (!(obj.departments as string[]).length) missing.departments = "Choose at least one department";
  if (!parsed.success || !extra.success || Object.keys(missing).length) {
    const fieldErrors: FieldErrors = { ...missing };
    for (const issue of [...(parsed.error?.issues ?? []), ...(extra.error?.issues ?? [])]) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { formError: "Fix the highlighted fields.", fieldErrors };
  }

  const key = studentIdKey(parsed.data.studentId);
  if (await db.query.members.findFirst({ where: eq(schema.members.studentIdKey, key), columns: { id: true } })) {
    return { formError: "This student ID is already registered. Sign in instead.", fieldErrors: { studentId: "Already registered" } as FieldErrors };
  }
  if (user && (await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true } }))) {
    throw redirect(next);
  }

  const userId = user?.id ?? (await createWebUser(db, parsed.data.fullName));
  const { departments: chosen, ...memberData } = parsed.data;
  let memberId: string;
  try {
    const [row] = await db
      .insert(schema.members)
      .values({ ...memberData, studentIdKey: key, phone: extra.data.phone ?? "", userId })
      .returning({ id: schema.members.id });
    memberId = row.id;
  } catch {
    // The unique student ID key is the final guard against two people registering the same ID at once
    return { formError: "This student ID is already registered. Sign in instead.", fieldErrors: { studentId: "Already registered" } as FieldErrors };
  }
  await setPasswordHash(db, userId, await hashPassword(extra.data.password));

  // Departments chosen on the form become join requests; leaders see them once the registration is approved
  if (chosen.length > 0) {
    const valid = await db.select({ id: schema.departments.id }).from(schema.departments).where(inArray(schema.departments.id, chosen));
    if (valid.length > 0) {
      await db
        .insert(schema.departmentMembers)
        .values(valid.map((d) => ({ departmentId: d.id, memberId })))
        .onConflictDoNothing();
    }
  }

  const d = parsed.data;
  ctx.waitUntil(
    notifyAdmins(
      env,
      `New registration: ${d.fullName} (${d.fieldOfStudy}, ${formatYear(d.yearOfStudy)}).\nReview: ${env.PUBLIC_SITE_URL}/admin/registrations`,
    ),
  );

  const dest = next === "/account" ? "/account?registered=1" : next;
  // Straight after registering: to the bot. Already on Telegram (registered inside the bot)? Send the QR now.
  const tgId = user ? (await db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { telegramId: true } }))?.telegramId : null;
  if (tgId) {
    ctx.waitUntil(sendMemberQr(env, userId, tgId));
    throw redirect(dest);
  }
  const welcome = `/welcome?next=${encodeURIComponent(dest)}`;
  if (user) throw redirect(welcome);
  // Signed out: sign them in with what they just chose
  const signedIn = await signInWithStudentId(request, env, d.studentId, extra.data.password);
  if ("error" in signedIn) throw redirect("/login");
  throw redirect(welcome, { headers: signedIn.headers });
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const errors = actionData?.fieldErrors ?? {};
  const submitting = nav.state === "submitting";
  const [isMale, setIsMale] = useState(false);
  // A Turnstile token works once. After every server reply, mount a fresh widget.
  const [widgetKey, setWidgetKey] = useState(0);
  useEffect(() => {
    if (actionData) setWidgetKey((k) => k + 1);
  }, [actionData]);

  return (
    <section className="page narrow">
      <h1>Member registration</h1>
      <p lang={lang} className="intro">{HOME[lang].registerIntro}</p>
      <p className="notice">Fill in this form in <strong>English letters</strong> (e.g. Abebe Kebede, Computer Science).</p>

      {actionData?.formError && (
        <p className="form-error" role="alert">{actionData.formError}</p>
      )}

      {!loaderData.signedIn && (
        <p className="muted">Already registered? <Link to={`/login?next=${encodeURIComponent(loaderData.next)}`}>Sign in</Link></p>
      )}

      <Form method="post" className="form" noValidate>
        <input type="hidden" name="next" value={loaderData.next} />
        <Field label="Full name" name="fullName" error={errors.fullName} defaultValue={loaderData.userName} required autoComplete="name" />
        <Field label="Christian name" name="christianName" error={errors.christianName} required />

        <fieldset className="field" aria-invalid={Boolean(errors.gender)}>
          <legend>Gender</legend>
          <div className="choices">
            <label><input type="radio" name="gender" value="male" required onChange={() => setIsMale(true)} /> Male</label>
            <label><input type="radio" name="gender" value="female" onChange={() => setIsMale(false)} /> Female</label>
          </div>
          {errors.gender && <span className="field-error">{errors.gender}</span>}
        </fieldset>

        <Field label="Student ID" name="studentId" error={errors.studentId} required autoCapitalize="characters" placeholder="UGR/1234/16" hint="You'll sign in with this" />
        <Field label="Phone" name="phone" type="tel" inputMode="tel" placeholder="09XX XXX XXX" error={errors.phone} required autoComplete="tel" defaultValue={loaderData.phone} />
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

        <MemberDetailsFields lang={lang} showTitle={isMale} today={loaderData.today} errors={errors} />

        <fieldset className="field">
          <legend>Departments to serve in <small>Choose at least one</small></legend>
          <p lang={lang} className="field-hint">{FORM_TEXT[lang].departments}</p>
          <div className="checks" lang={lang}>
            {loaderData.departments.map((d) => (
              <label key={d.id}>
                <input type="checkbox" name="departments" value={d.id} /> {departmentName(d, lang)}
              </label>
            ))}
          </div>
          {errors.departments && <span className="field-error">{errors.departments}</span>}
        </fieldset>

        <label className="field">
          <span>Anything we should know?</span>
          <textarea name="note" rows={3} maxLength={500} required aria-invalid={Boolean(errors.note)} placeholder="e.g. your church back home, or “nothing”" />
          {errors.note && <span className="field-error">{errors.note}</span>}
        </label>

        <fieldset className="field">
          <legend>Password for the website</legend>
          <p className="field-hint">You'll sign in with your student ID and this password. At least 8 characters.</p>
          <Field label="Password" name="password" type="password" error={errors.password} required minLength={8} autoComplete="new-password" />
          <Field label="Repeat password" name="password2" type="password" error={errors.password2} required minLength={8} autoComplete="new-password" />
        </fieldset>

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
