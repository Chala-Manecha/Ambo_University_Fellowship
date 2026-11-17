import { eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/account.details";
import type { loader as rootLoader } from "../root";
import { MemberDetailsFields } from "../components/MemberDetailsFields";
import { PhotoInput } from "../components/PhotoInput";
import { getDb, schema } from "../db";
import { todayInAddis } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { applyTitleRule, checkPhoto, formatYear, formToObject, GRADUATED, memberBasicsSchema, memberDetailsSchema } from "../lib/registration";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "My details · Gibi Gubae" }];
}

async function loadMember(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const member = await getDb(env.DB).query.members.findFirst({
    where: eq(schema.members.userId, user.id),
    columns: {
      id: true,
      fullName: true,
      christianName: true,
      phone: true,
      studentId: true,
      fieldOfStudy: true,
      yearOfStudy: true,
      gender: true,
      birthDate: true,
      title: true,
      services: true,
      otherService: true,
      learning: true,
      photoKey: true,
    },
  });
  if (!member) throw redirect("/register");
  return member;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { photoKey, ...member } = await loadMember(request, context.cloudflare.env);
  return { member, hasPhoto: Boolean(photoKey), today: todayInAddis() };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const member = await loadMember(request, env);
  const db = getDb(env.DB);
  const form = await request.formData();

  // Profile photo: replaces the old one in R2
  if (form.get("intent") === "photo") {
    const photo = checkPhoto(form.get("photo"));
    if (!photo.ok) return { photoError: photo.error };
    const ext = photo.file.type === "image/png" ? "png" : photo.file.type === "image/jpeg" ? "jpg" : "webp";
    const key = `photos/${member.id}-${Date.now().toString(36)}.${ext}`;
    await env.MEDIA.put(key, photo.file.stream(), { httpMetadata: { contentType: photo.file.type } });
    await db.update(schema.members).set({ photoKey: key, updatedAt: new Date() }).where(eq(schema.members.id, member.id));
    if (member.photoKey) await env.MEDIA.delete(member.photoKey);
    throw redirect("/account?updated=1");
  }

  const raw = formToObject(form);
  const basics = memberBasicsSchema.safeParse(raw);
  const details = memberDetailsSchema.safeParse(raw);
  if (!basics.success || !details.success) {
    const fieldErrors: Partial<Record<string, string>> = {};
    for (const issue of [...(basics.error?.issues ?? []), ...(details.error?.issues ?? [])]) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors };
  }
  await db
    .update(schema.members)
    .set({ ...basics.data, phone: basics.data.phone ?? "", ...applyTitleRule(member.gender, details.data), updatedAt: new Date() })
    .where(eq(schema.members.id, member.id));
  throw redirect("/account?updated=1");
}

export default function MyDetails({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { member, hasPhoto, today } = loaderData;
  const errors = (actionData && "fieldErrors" in actionData ? actionData.fieldErrors : {}) ?? {};
  const photoError = actionData && "photoError" in actionData ? actionData.photoError : undefined;

  return (
    <section className="page narrow">
      <p className="muted"><Link to="/account">← My account</Link></p>
      <h1>My details</h1>

      <Form method="post" encType="multipart/form-data" className="card form">
        <input type="hidden" name="intent" value="photo" />
        <h2>Photo</h2>
        <PhotoInput current={hasPhoto ? `/photos/${member.id}` : null} error={photoError} />
        <button className="btn btn-primary btn-sm" disabled={busy}>Save photo</button>
      </Form>

      <Form method="post" className="card form" noValidate>
        <h2>About me</h2>
        <label className="field">
          <span>Full name</span>
          <input name="fullName" defaultValue={member.fullName} required maxLength={80} autoComplete="name" aria-invalid={Boolean(errors.fullName)} />
          {errors.fullName && <span className="field-error">{errors.fullName}</span>}
        </label>
        <label className="field">
          <span>Christian name <small>Optional</small></span>
          <input name="christianName" defaultValue={member.christianName ?? ""} maxLength={60} />
          {errors.christianName && <span className="field-error">{errors.christianName}</span>}
        </label>
        <label className="field">
          <span>Student ID <small>Can't be changed — you sign in with it</small></span>
          <input value={member.studentId} readOnly disabled />
        </label>
        <label className="field">
          <span>Phone <small>Optional</small></span>
          <input name="phone" type="tel" inputMode="tel" placeholder="09XX XXX XXX" defaultValue={member.phone ? member.phone.replace(/^\+251/, "0") : ""} aria-invalid={Boolean(errors.phone)} />
          {errors.phone && <span className="field-error">{errors.phone}</span>}
        </label>
        <label className="field">
          <span>Field of study</span>
          <input name="fieldOfStudy" defaultValue={member.fieldOfStudy} required maxLength={80} aria-invalid={Boolean(errors.fieldOfStudy)} />
          {errors.fieldOfStudy && <span className="field-error">{errors.fieldOfStudy}</span>}
        </label>
        <label className="field">
          <span>Year of study</span>
          <select name="yearOfStudy" defaultValue={String(member.yearOfStudy)}>
            {[1, 2, 3, 4, 5, 6, 7].map((y) => <option key={y} value={y}>{formatYear(y)}</option>)}
            <option value={GRADUATED}>{formatYear(GRADUATED)}</option>
          </select>
        </label>

        <MemberDetailsFields
          lang={lang}
          showTitle={member.gender === "male"}
          today={today}
          defaults={member}
          errors={errors}
        />
        <button className="btn btn-primary" disabled={busy}>Save</button>
      </Form>
    </section>
  );
}
