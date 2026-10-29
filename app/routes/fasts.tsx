import { and, asc, eq, gte } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/fasts";
import type { loader as rootLoader } from "../root";
import { EcDatePicker } from "../components/EcDatePicker";
import { getDb, schema } from "../db";
import { todayInAddis } from "../lib/departments";
import { getMemberByUser } from "../lib/departments.server";
import { formatEc, isoToEc } from "../lib/ethiopian-date";
import { fastSchema, isFastOn, MEAL_LABELS, MEALS } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { can } from "../lib/permissions";
import { formToObject } from "../lib/registration";
import { requireUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Fasts · Gibi Gubae" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const today = todayInAddis();
  const member = await getMemberByUser(db, user.id);

  // Current and upcoming fasts
  const fasts = await db.query.fasts.findMany({ where: gte(schema.fasts.endDate, today), orderBy: asc(schema.fasts.startDate) });
  const mine = member
    ? await db.select({ fastId: schema.fastRegistrations.fastId }).from(schema.fastRegistrations).where(eq(schema.fastRegistrations.memberId, member.id))
    : [];
  const registered = new Set(mine.map((m) => m.fastId));

  return {
    today,
    memberStatus: member?.status ?? null,
    canManage: can(user.role, "fast:manage"),
    canScan: can(user.role, "fast:scan"),
    fasts: fasts.map((f) => ({ ...f, isOn: isFastOn(f, today), registered: registered.has(f.id) })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const form = await request.formData();
  const intent = form.get("intent");
  const db = getDb(env.DB);

  if (intent === "create") {
    if (!can(user.role, "fast:manage")) throw new Response("Only admins create fasts.", { status: 403 });
    const obj = formToObject(form);
    const parsed = fastSchema.safeParse({ ...obj, meals: form.getAll("meals").map(String) });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fast details." };
    const [f] = await db.insert(schema.fasts).values({ ...parsed.data, createdBy: user.id }).returning({ id: schema.fasts.id });
    throw redirect(`/fasts/${f.id}`);
  }

  // Members register themselves
  const fastId = String(form.get("fastId") ?? "");
  const member = await getMemberByUser(db, user.id);
  if (!member || member.status !== "active") return { error: "Only approved members can register for a fast." };
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, fastId) });
  if (!fast || fast.endDate < todayInAddis()) return { error: "This fast has ended." };

  if (intent === "register") {
    await db.insert(schema.fastRegistrations).values({ fastId: fast.id, memberId: member.id }).onConflictDoNothing();
    return { message: `You're registered for ${fast.name}. Show your QR code (My account) at the cafe.` };
  }
  if (intent === "unregister") {
    await db
      .delete(schema.fastRegistrations)
      .where(and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, member.id)));
    return { message: `You're no longer registered for ${fast.name}.` };
  }
  throw new Response("Unknown action", { status: 400 });
}

export default function Fasts({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const { today, memberStatus, canManage, canScan, fasts } = loaderData;
  const ecYear = isoToEc(today).year;
  const message = actionData && "message" in actionData ? actionData.message : null;
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <section className="page">
      <h1>Fasts</h1>
      <p className="muted">Register for a fast to get cafe meals. Show the QR code on My account when you eat.</p>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {memberStatus !== "active" && !canManage && (
        <p className="muted">You can register for fasts once your membership is approved.</p>
      )}

      {fasts.length === 0 ? (
        <p>No fasts are open right now.</p>
      ) : (
        <ul className="dept-grid">
          {fasts.map((f) => (
            <li key={f.id} className="dept-card">
              <div>
                <h2>{f.name}</h2>
                <p className="muted" lang={lang}>
                  {formatEc(f.startDate, lang)} – {formatEc(f.endDate, lang)}
                </p>
                <p className="muted" lang={lang}>
                  {f.meals.map((m) => MEAL_LABELS[m][lang]).join(" · ")}
                  {f.isOn && <> · <span className="pill pill-active">Now</span></>}
                </p>
              </div>
              <div className="dept-card-actions">
                {memberStatus === "active" && (
                  <Form method="post">
                    <input type="hidden" name="fastId" value={f.id} />
                    {f.registered ? (
                      <>
                        <span className="pill pill-active">Registered</span>{" "}
                        <button name="intent" value="unregister" className="btn btn-quiet btn-sm" disabled={busy}>Cancel</button>
                      </>
                    ) : (
                      <button name="intent" value="register" className="btn btn-primary btn-sm" disabled={busy}>Register</button>
                    )}
                  </Form>
                )}
                {canScan && <Link to={`/fasts/${f.id}`} className="btn btn-quiet btn-sm">Manage</Link>}
                {canScan && f.isOn && <Link to={`/fasts/${f.id}/scan`} className="btn btn-primary btn-sm">Scan</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <>
          <h2>New fast</h2>
          <Form method="post" className="form">
            <input type="hidden" name="intent" value="create" />
            <label className="field">
              <span>Name</span>
              <input name="name" required maxLength={80} placeholder="ጾመ ነቢያት / Soomii Nabiyyootaa" />
            </label>
            <div className="date-pair">
              <EcDatePicker name="startDate" label="Starts" lang={lang} defaultIso={today} minYear={ecYear - 1} maxYear={ecYear + 1} />
              <EcDatePicker name="endDate" label="Ends" lang={lang} defaultIso={today} minYear={ecYear - 1} maxYear={ecYear + 1} />
            </div>
            <fieldset className="field">
              <legend>Meals served</legend>
              <div className="checks" lang={lang}>
                {MEALS.map((m) => (
                  <label key={m}>
                    <input type="checkbox" name="meals" value={m} defaultChecked={m === "lunch"} /> {MEAL_LABELS[m][lang]} ({MEAL_LABELS[m].en})
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn btn-primary" disabled={busy}>Create fast</button>
          </Form>
        </>
      )}
    </section>
  );
}
