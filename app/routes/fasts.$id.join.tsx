import { and, eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { renderSVG } from "uqr";
import type { Route } from "./+types/fasts.$id.join";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { todayInAddis } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { FAST_TYPE_LABELS, FAST_TYPE_MEALS, FAST_TYPES, isFastType, MEAL_LABELS, mealsFor } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { memberQrText } from "../lib/member-qr";
import { getUser } from "../lib/session.server";

export function meta() {
  return [{ title: "Fast registration · Gibi Gubae" }];
}

const TEXT = {
  am: { intro: "ጾሙን እንዴት ይጾማሉ? ይምረጡ።", done: "ተመዝግበዋል። ይህን QR በካፌ ያሳዩ (ስክሪንሾት ያድርጉት)።" },
  om: { intro: "Soomana kana akkamitti soomtu? Filadhaa.", done: "Galmooftaniittu. QR kana kaafee irratti agarsiisaa (suuraa isaa kaasaa)." },
} as const;

/** The page the fast poster's QR opens. Members only: signed-out students sign in or register first. */
async function load(request: Request, env: Env, fastId: string) {
  const user = await getUser(request, env);
  const here = new URL(request.url).pathname;
  if (!user) throw redirect(`/login?next=${encodeURIComponent(here)}`);
  const db = getDb(env.DB);
  const member = await db.query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { id: true, status: true } });
  if (!member) throw redirect(`/register?next=${encodeURIComponent(here)}`);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, fastId) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  return { db, member, fast };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { db, member, fast } = await load(request, env, params.id);
  const reg = await db.query.fastRegistrations.findFirst({
    where: and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, member.id)),
    columns: { fastType: true },
  });
  const allowed = member.status === "active" || member.status === "pending";
  return {
    fast: { id: fast.id, name: fast.name, startDate: fast.startDate, endDate: fast.endDate, meals: fast.meals },
    ended: fast.endDate < todayInAddis(),
    allowed,
    fastType: reg?.fastType ?? null,
    qrSvg: reg && allowed ? renderSVG(await memberQrText(member.id, env.BETTER_AUTH_SECRET), { border: 2 }) : null,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const { db, member, fast } = await load(request, env, params.id);
  if (member.status !== "active" && member.status !== "pending") return { error: "Your membership isn't active. Contact a fellowship leader." };
  if (fast.endDate < todayInAddis()) return { error: "This fast has ended." };
  const fastType = (await request.formData()).get("fastType");
  if (!isFastType(fastType)) return { error: "Choose how you fast." };
  await db
    .insert(schema.fastRegistrations)
    .values({ fastId: fast.id, memberId: member.id, fastType })
    .onConflictDoUpdate({
      target: [schema.fastRegistrations.fastId, schema.fastRegistrations.memberId],
      set: { fastType, updatedAt: new Date() },
    });
  throw redirect(`/fasts/${fast.id}/join?saved=1`);
}

export default function JoinFast({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const { fast, ended, allowed, fastType, qrSvg } = loaderData;

  return (
    <section className="page narrow">
      <h1>{fast.name}</h1>
      <p className="muted" lang={lang}>{formatEc(fast.startDate, lang)} – {formatEc(fast.endDate, lang)}</p>
      {actionData?.error && <p className="form-error" role="alert">{actionData.error}</p>}

      {qrSvg && (
        <div className="member-card">
          <p className="notice" lang={lang}>{TEXT[lang].done}</p>
          <div className="member-qr" role="img" aria-label="Your cafe QR code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          {fastType && (
            <p lang={lang}>
              <strong>{FAST_TYPE_LABELS[fastType][lang]}</strong>
              <br />
              <span className="muted">{mealsFor(fast.meals, fastType).map((m) => MEAL_LABELS[m][lang]).join(" · ")}</span>
            </p>
          )}
        </div>
      )}

      {!allowed ? (
        <p className="form-error">Your membership isn't active. Contact a fellowship leader.</p>
      ) : ended ? (
        <p className="muted">This fast has ended.</p>
      ) : (
        <Form method="post" className="form">
          <fieldset className="field">
            <legend lang={lang}>{TEXT[lang].intro}</legend>
            <div className="fast-types">
              {FAST_TYPES.map((t) => (
                <label key={t} className="fast-type">
                  <input type="radio" name="fastType" value={t} defaultChecked={fastType === t} required />
                  <span className="fast-type-body">
                    <strong lang={lang}>{FAST_TYPE_LABELS[t][lang]}</strong>
                    <span className="fast-type-meals" lang={lang}>
                      {(["breakfast", "lunch", "dinner"] as const).map((m) => (
                        <span key={m} className={FAST_TYPE_MEALS[t].includes(m) ? "meal-on" : "meal-off"}>{MEAL_LABELS[m][lang]}</span>
                      ))}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary" disabled={busy}>{fastType ? "Save" : "Register for this fast"}</button>
        </Form>
      )}
      <p className="muted"><Link to="/account">My account</Link></p>
    </section>
  );
}
