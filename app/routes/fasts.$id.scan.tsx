import { and, count, eq } from "drizzle-orm";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/fasts.$id.scan";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { todayInAddis } from "../lib/departments";
import { addisHour, checkinDecision, defaultMeal, isFastOn, isMeal, MEAL_LABELS, type CheckinResult, type Meal } from "../lib/fasts";
import { DEFAULT_LANG } from "../lib/lang";
import { verifyMemberQr } from "../lib/member-qr";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Scanner · Gibi Gubae" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "fast:scan");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, params.id) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const today = todayInAddis();
  const served = await db
    .select({ meal: schema.fastCheckins.meal, n: count() })
    .from(schema.fastCheckins)
    .where(and(eq(schema.fastCheckins.fastId, fast.id), eq(schema.fastCheckins.date, today)))
    .groupBy(schema.fastCheckins.meal);
  return {
    fast: { id: fast.id, name: fast.name, meals: fast.meals },
    isOn: isFastOn(fast, today),
    defaultMeal: defaultMeal(fast.meals, addisHour()),
    served: Object.fromEntries(served.map((s) => [s.meal, s.n])) as Partial<Record<Meal, number>>,
  };
}

type Person = { fullName: string; studentId: string; image: string | null };
export type ScanResponse = CheckinResult & { person?: Person };

/** One scan: verify the QR, check the rules, record the meal once. */
export async function action({ request, params, context }: Route.ActionArgs): Promise<ScanResponse> {
  const { env } = context.cloudflare;
  const scanner = await requirePermission(request, env, "fast:scan");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, params.id) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const form = await request.formData();
  const meal = form.get("meal");
  if (!isMeal(meal)) return { kind: "invalid" };

  const memberId = await verifyMemberQr(String(form.get("code") ?? ""), env.BETTER_AUTH_SECRET);
  const row = memberId
    ? await db
        .select({ id: schema.members.id, status: schema.members.status, fullName: schema.members.fullName, studentId: schema.members.studentId, image: schema.user.image })
        .from(schema.members)
        .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
        .where(eq(schema.members.id, memberId))
        .get()
    : undefined;
  const person: Person | undefined = row ? { fullName: row.fullName, studentId: row.studentId, image: row.image } : undefined;
  const registered = row
    ? Boolean(
        await db.query.fastRegistrations.findFirst({
          where: and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, row.id)),
        }),
      )
    : false;

  const today = todayInAddis();
  const blocked = checkinDecision({
    memberFound: Boolean(row),
    memberActive: row?.status === "active",
    registered,
    fastIsOn: isFastOn(fast, today),
    mealAllowed: fast.meals.includes(meal),
  });
  if (blocked) return { ...blocked, person };

  // The primary key (fast, member, date, meal) makes a second scan a no-op
  const inserted = await db
    .insert(schema.fastCheckins)
    .values({ fastId: fast.id, memberId: row!.id, date: today, meal, scannedBy: scanner.id })
    .onConflictDoNothing()
    .returning({ createdAt: schema.fastCheckins.createdAt });
  if (inserted.length > 0) return { kind: "ok", person };

  const prev = await db.query.fastCheckins.findFirst({
    where: and(
      eq(schema.fastCheckins.fastId, fast.id),
      eq(schema.fastCheckins.memberId, row!.id),
      eq(schema.fastCheckins.date, today),
      eq(schema.fastCheckins.meal, meal),
    ),
    columns: { createdAt: true },
  });
  return { kind: "already", at: prev?.createdAt.getTime() ?? Date.now(), person };
}

const RESULT_TEXT: Record<CheckinResult["kind"], { title: string; tone: "ok" | "warn" | "bad" }> = {
  ok: { title: "Serve", tone: "ok" },
  already: { title: "Already served", tone: "warn" },
  not_registered: { title: "Not registered for this fast", tone: "bad" },
  inactive: { title: "Membership not active", tone: "bad" },
  not_today: { title: "This fast isn't on today", tone: "bad" },
  wrong_meal: { title: "This meal isn't served in this fast", tone: "bad" },
  invalid: { title: "Not a fellowship QR code", tone: "bad" },
};

const RESUME_MS = 2500;
/** The same QR held in front of the camera is ignored for this long after it was handled. */
const SAME_CODE_MS = 6000;

export default function Scanner({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const { fast, isOn, served } = loaderData;
  const [meal, setMeal] = useState<Meal>(loaderData.defaultMeal);
  // `wanted` drives the camera effect; `camera` is only the status shown on screen
  const [wanted, setWanted] = useState(false);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "error">("off");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fetcher = useFetcher<ScanResponse>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const paused = useRef(false);
  const last = useRef<{ code: string; at: number } | null>(null);
  const mealRef = useRef(meal);
  mealRef.current = meal;
  const [shown, setShown] = useState<ScanResponse | null>(null);

  // Show each answer, buzz, then go back to scanning
  useEffect(() => {
    if (!fetcher.data) return;
    setShown(fetcher.data);
    navigator.vibrate?.(fetcher.data.kind === "ok" ? 80 : [60, 60, 60]);
    const t = setTimeout(() => {
      setShown(null);
      paused.current = false;
    }, RESUME_MS);
    return () => clearTimeout(t);
  }, [fetcher.data]);

  useEffect(() => {
    if (!wanted) return;
    setCamera("starting");
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setCamera("on");
        const tick = () => {
          if (stopped) return;
          if (!paused.current && video.readyState >= 2 && ctx) {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            const repeat = code?.data && last.current?.code === code.data && Date.now() - last.current.at < SAME_CODE_MS;
            if (code?.data && !repeat) {
              last.current = { code: code.data, at: Date.now() };
              paused.current = true;
              fetcher.submit({ code: code.data, meal: mealRef.current }, { method: "post" });
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : String(err));
        setCamera("error");
        setWanted(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const r = shown ? RESULT_TEXT[shown.kind] : null;

  return (
    <section className="page narrow scanner">
      <p className="muted"><Link to={`/fasts/${fast.id}`}>← {fast.name}</Link></p>
      <h1>Scanner</h1>
      {!isOn && <p className="form-error">This fast isn't on today. Scans will be refused.</p>}

      <div className="segmented meal-switch" role="radiogroup" aria-label="Meal">
        {fast.meals.map((m) => (
          <label key={m} className="seg seg-present">
            <input type="radio" name="meal" value={m} checked={meal === m} onChange={() => setMeal(m)} />
            <span lang={lang}>{MEAL_LABELS[m][lang]} · {served[m] ?? 0}</span>
          </label>
        ))}
      </div>

      <div className="scan-box">
        <video ref={videoRef} playsInline muted className={camera === "on" ? "" : "hidden"} />
        {camera !== "on" && (
          <div className="scan-start">
            <button className="btn btn-primary" onClick={() => setWanted(true)} disabled={camera === "starting"}>
              {camera === "starting" ? "Starting camera…" : "Start camera"}
            </button>
            {camera === "error" && (
              <p className="form-error">Couldn't open the camera: {cameraError}. Allow camera access for this site and try again.</p>
            )}
          </div>
        )}
        {r && shown && (
          <button className={`scan-result tone-${r.tone}`} onClick={() => { setShown(null); paused.current = false; }}>
            <strong>{r.title}</strong>
            {shown.person && (
              <span className="scan-person">
                {shown.person.image && <img src={shown.person.image} alt="" width={72} height={72} />}
                <span>{shown.person.fullName}<br /><small>{shown.person.studentId}</small></span>
              </span>
            )}
            {shown.kind === "already" && (
              <small>at {new Date(shown.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Addis_Ababa" })}</small>
            )}
            <small>Tap to continue</small>
          </button>
        )}
        {fetcher.state !== "idle" && <div className="scan-busy">Checking…</div>}
      </div>
    </section>
  );
}
