import { and, eq, sql } from "drizzle-orm";
import { Form, Link, redirect, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/fasts.$id";
import type { loader as rootLoader } from "../root";
import { Counts } from "../components/Panel";
import { getDb, schema } from "../db";
import { countBy, matchesSearch, pickParam } from "../lib/dashboard";
import { todayInAddis } from "../lib/departments";
import { memberByStudentId } from "../lib/accounts.server";
import { formatEc } from "../lib/ethiopian-date";
import {
  FAST_TYPE_LABELS,
  FAST_TYPES,
  MAX_SCANNERS,
  MEALS_PER_DAY,
  fastDays,
  isFastOn,
  isFastType,
  isMeal,
  MEAL_LABELS,
  mealsFor,
  pickFastDay,
  type Meal,
} from "../lib/fasts";
import { checkIn, loadRegistrants } from "../lib/fasts.server";
import { DEFAULT_LANG } from "../lib/lang";
import { can } from "../lib/permissions";
import { requirePermission } from "../lib/session.server";

export function meta() {
  return [{ title: "Fast · Gibi Gubae" }];
}

/** Inside a panel the URL is …/fasts/:fastId (the panel's own :id is the department); alone it's /fasts/:id. */
function fastIdOf(params: Record<string, string | undefined>) {
  return params.fastId ?? params.id ?? "";
}

/** The fasts list this page sits under: /departments/miseensa/fasts, /office/fasts or /fasts. */
function listPath(url: string) {
  return new URL(url).pathname.replace(/\/[^/]+\/?$/, "");
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "fast:scan");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, fastIdOf(params)) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const today = todayInAddis();
  const day = pickFastDay(fast, new URL(request.url).searchParams.get("day"), today);
  const days = fastDays(fast.startDate, fast.endDate);
  const i = days.indexOf(day);

  const [registrants, totals] = await Promise.all([
    loadRegistrants(db, fast.id),
    // Every meal each person has eaten in this fast so far (the history behind the daily table)
    db
      .select({ memberId: schema.fastCheckins.memberId, meals: sql<number>`count(*)`, days: sql<number>`count(distinct ${schema.fastCheckins.date})` })
      .from(schema.fastCheckins)
      .where(eq(schema.fastCheckins.fastId, fast.id))
      .groupBy(schema.fastCheckins.memberId),
  ]);
  const totalBy = new Map(totals.map((t) => [t.memberId, t]));
  const eaten = await db
    .select({ memberId: schema.fastCheckins.memberId, meal: schema.fastCheckins.meal })
    .from(schema.fastCheckins)
    .where(and(eq(schema.fastCheckins.fastId, fast.id), eq(schema.fastCheckins.date, day)));
  const eatenSet = new Set(eaten.map((e) => `${e.memberId}:${e.meal}`));
  const todayCount = new Map<string, number>();
  for (const e of eaten) todayCount.set(e.memberId, (todayCount.get(e.memberId) ?? 0) + 1);
  const canManage = can(user.role, "fast:manage");
  const [scanners, activeMembers] = canManage
    ? await Promise.all([
        db
          .select({ memberId: schema.fastScanners.memberId, fullName: schema.members.fullName, studentId: schema.members.studentId })
          .from(schema.fastScanners)
          .innerJoin(schema.members, eq(schema.members.id, schema.fastScanners.memberId))
          .where(eq(schema.fastScanners.fastId, fast.id)),
        db
          .select({ memberId: schema.members.id, fullName: schema.members.fullName, studentId: schema.members.studentId })
          .from(schema.members)
          .where(eq(schema.members.status, "active"))
          .orderBy(schema.members.fullName),
      ])
    : [[], []];

  return {
    fast,
    isOn: isFastOn(fast, today),
    today,
    day,
    prevDay: i > 0 ? days[i - 1] : null,
    nextDay: i >= 0 && i < days.length - 1 ? days[i + 1] : null,
    dayNumber: i + 1,
    totalDays: days.length,
    canManage,
    listPath: listPath(request.url),
    scanners,
    activeMembers,
    registrants: registrants.map((r) => ({
      ...r,
      registeredAt: r.registeredAt.getTime(),
      eatenTotal: totalBy.get(r.memberId)?.meals ?? 0,
      eatenToday: todayCount.get(r.memberId) ?? 0,
      daysTotal: totalBy.get(r.memberId)?.days ?? 0,
      // Any meal counts towards their number a day
      meals: Object.fromEntries(fast.meals.map((m) => [m, eatenSet.has(`${r.memberId}:${m}`)])) as Partial<Record<Meal, boolean>>,
    })),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "fast:scan");
  const db = getDb(env.DB);
  const fast = await db.query.fasts.findFirst({ where: eq(schema.fasts.id, fastIdOf(params)) });
  if (!fast) throw new Response("Fast not found", { status: 404 });
  const form = await request.formData();
  const intent = form.get("intent");

  // Daily table: tick or untick one meal for one person on one day
  if (intent === "mark" || intent === "unmark") {
    const memberId = String(form.get("memberId") ?? "");
    const meal = form.get("meal");
    const day = pickFastDay(fast, String(form.get("day") ?? ""), "");
    if (!isMeal(meal) || day !== form.get("day")) return { message: "That day isn't part of this fast." };
    if (intent === "unmark") {
      await db
        .delete(schema.fastCheckins)
        .where(
          and(
            eq(schema.fastCheckins.fastId, fast.id),
            eq(schema.fastCheckins.memberId, memberId),
            eq(schema.fastCheckins.date, day),
            eq(schema.fastCheckins.meal, meal),
          ),
        );
      return null;
    }
    const r = await checkIn(db, fast, memberId, meal, user.id, day);
    return r.kind === "ok" || r.kind === "already" ? null : { message: `Not recorded: ${r.kind.replace("_", " ")}.` };
  }

  if (!can(user.role, "fast:manage")) throw new Response("Only admins can change registrations.", { status: 403 });

  // Up to 4 members may open the scanner for this fast
  if (intent === "add-scanner" || intent === "remove-scanner") {
    const memberId = String(form.get("memberId") ?? "");
    if (intent === "remove-scanner") {
      await db.delete(schema.fastScanners).where(and(eq(schema.fastScanners.fastId, fast.id), eq(schema.fastScanners.memberId, memberId)));
      return { message: "Scanner removed." };
    }
    const member = await db.query.members.findFirst({ where: and(eq(schema.members.id, memberId), eq(schema.members.status, "active")), columns: { id: true, fullName: true } });
    if (!member) return { message: "Choose a member." };
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.fastScanners).where(eq(schema.fastScanners.fastId, fast.id));
    if (n >= MAX_SCANNERS) return { message: `A fast can have at most ${MAX_SCANNERS} scanners. Remove one first.` };
    await db.insert(schema.fastScanners).values({ fastId: fast.id, memberId: member.id, addedBy: user.id }).onConflictDoNothing();
    return { message: `${member.fullName} can now open the scanner (from their dashboard).` };
  }

  if (intent === "add") {
    const studentId = String(form.get("studentId") ?? "").trim();
    const fastType = form.get("fastType");
    if (!isFastType(fastType)) return { message: "Choose the fast type." };
    const m = await memberByStudentId(db, studentId);
    const member = m ? await db.query.members.findFirst({ where: eq(schema.members.id, m.id), columns: { id: true, fullName: true, status: true } }) : null;
    if (!member || (member.status !== "active" && member.status !== "pending")) {
      return { message: `No member with student ID "${studentId}". They need to register as a member first.` };
    }
    await db
      .insert(schema.fastRegistrations)
      .values({ fastId: fast.id, memberId: member.id, fastType })
      .onConflictDoUpdate({ target: [schema.fastRegistrations.fastId, schema.fastRegistrations.memberId], set: { fastType } });
    return { message: `${member.fullName} is registered.` };
  }
  if (intent === "remove") {
    await db
      .delete(schema.fastRegistrations)
      .where(and(eq(schema.fastRegistrations.fastId, fast.id), eq(schema.fastRegistrations.memberId, String(form.get("memberId")))));
    return { message: "Removed." };
  }
  if (intent === "delete") {
    await db.delete(schema.fasts).where(eq(schema.fasts.id, fast.id));
    throw redirect(listPath(request.url));
  }
  throw new Response("Unknown action", { status: 400 });
}

const TABS = ["registered", "daily"] as const;

export default function FastPage({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [params] = useSearchParams();
  const { fast, isOn, today, day, prevDay, nextDay, dayNumber, totalDays, canManage, registrants, scanners, activeMembers, listPath } = loaderData;
  const tab = pickParam(params.get("tab"), TABS) ?? "registered";
  const type = pickParam(params.get("type"), FAST_TYPES);
  const q = params.get("q") ?? "";
  const searched = registrants.filter((r) => matchesSearch(q, [r.fullName, r.studentId]));
  const rows = searched.filter((r) => !type || r.fastType === type);
  const typeCounts = countBy(searched, FAST_TYPES, (r) => r.fastType);
  const keep = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(extra)) (v === null ? p.delete(k) : p.set(k, v));
    return `?${p.toString()}`;
  };

  // Daily numbers: meals served today, and people who've had their number
  const mealTotals = fast.meals.map((m) => ({ meal: m, eaten: rows.filter((r) => r.meals[m] === true).length }));
  const done = rows.filter((r) => r.eatenToday >= MEALS_PER_DAY[r.fastType]).length;

  return (
    <section className="page wide">
      <div className="sub-head">
        <Link to={listPath} className="sub-back">← All fasts</Link>
        <h2>{fast.name}</h2>
        <span className="muted" lang={lang}>{formatEc(fast.startDate, lang)} – {formatEc(fast.endDate, lang)}</span>
        <span className="sub-actions">
          {isOn && <Link to={`/fasts/${fast.id}/scan`} className="btn btn-primary btn-sm">📷 Scanner</Link>}
          {canManage && <Link to={`/fasts/${fast.id}/poster`} className="btn btn-quiet btn-sm">🖨 Poster</Link>}
        </span>
      </div>
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <nav className="seg-tabs" aria-label="View">
        <Link to={keep({ tab: "registered" })} aria-current={tab === "registered" ? "page" : undefined} preventScrollReset>📋 Registered</Link>
        <Link to={keep({ tab: "daily" })} aria-current={tab === "daily" ? "page" : undefined} preventScrollReset>📅 Daily tracker</Link>
      </nav>

      <Counts
        items={[
          { to: keep({ type: null }), n: typeCounts.all, label: "All", active: !type },
          ...FAST_TYPES.map((t) => ({ to: keep({ type: t }), n: typeCounts[t], label: `${MEALS_PER_DAY[t]} a day`, active: type === t })),
        ]}
      />

      <Form method="get" className="card filter-bar" role="search">
        {[...params.entries()].filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Name or student ID" aria-label="Search" className="filter-q" />
      </Form>

      {tab === "registered" && (
        <>
          {canManage && (
            <details className="add-panel">
              <summary>＋ Add someone by student ID</summary>
              <Form method="post" className="inline-form">
                <input type="hidden" name="intent" value="add" />
                <label className="field">
                  <span>Student ID</span>
                  <input name="studentId" required maxLength={40} placeholder="UGR/1234/16" />
                </label>
                <label className="field">
                  <span>Fast type</span>
                  <select name="fastType" required defaultValue="">
                    <option value="" disabled>Choose</option>
                    {FAST_TYPES.map((t) => <option key={t} value={t}>{FAST_TYPE_LABELS[t].en}</option>)}
                  </select>
                </label>
                <button className="btn btn-primary" disabled={busy}>Add</button>
              </Form>
            </details>
          )}
          <div className="card table-card">
          <div className="table-bar">
            <strong>{rows.length} registered</strong>
            <span className="table-bar-buttons">
              <a href={`/fasts/${fast.id}/report.csv`} download className="btn btn-primary btn-sm">⬇ Export for university</a>
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="muted table-empty">Nobody yet. Print the poster so students can scan it and register.</p>
          ) : (
            <div className="table-wrap">
              <table className="table-oneline">
                <thead>
                  <tr><th>#</th><th>Student ID</th><th>Name</th><th className="num">Meals a day</th><th className="num">Eaten so far</th><th>Registered</th>{canManage && <th><span className="visually-hidden">Actions</span></th>}</tr>
                </thead>
                <tbody>
                  {rows.map((r, n) => (
                    <tr key={r.memberId}>
                      <td className="muted">{n + 1}</td>
                      <td>{r.studentId}</td>
                      <td><strong>{r.fullName}</strong></td>
                      <td className="num"><strong>{MEALS_PER_DAY[r.fastType]}</strong></td>
                      <td className="num">{r.eatenTotal} meal{r.eatenTotal === 1 ? "" : "s"} · {r.daysTotal} day{r.daysTotal === 1 ? "" : "s"}</td>
                      <td lang={lang}>{formatEc(new Date(r.registeredAt + 3 * 3600 * 1000).toISOString().slice(0, 10), lang)}</td>
                      {canManage && (
                        <td>
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (!window.confirm(`Remove ${r.fullName} from this fast?`)) e.preventDefault();
                            }}
                          >
                            <input type="hidden" name="intent" value="remove" />
                            <input type="hidden" name="memberId" value={r.memberId} />
                            <button className="btn btn-quiet btn-sm" disabled={busy}>Remove</button>
                          </Form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </>
      )}

      {tab === "daily" && (
        <>
          <div className="day-nav">
            {prevDay ? <Link to={keep({ day: prevDay })} className="btn btn-quiet btn-sm" preventScrollReset>← Prev</Link> : <span className="btn btn-quiet btn-sm" aria-disabled="true">← Prev</span>}
            <div className="day-nav-label">
              <strong lang={lang}>{formatEc(day, lang)}</strong>
              <span className="muted">Day {dayNumber} of {totalDays}{day === today ? " · today" : ""}</span>
            </div>
            {nextDay ? <Link to={keep({ day: nextDay })} className="btn btn-quiet btn-sm" preventScrollReset>Next →</Link> : <span className="btn btn-quiet btn-sm" aria-disabled="true">Next →</span>}
          </div>
          <Counts
            items={[
              ...mealTotals.map((t) => ({ to: keep({}), n: t.eaten, label: MEAL_LABELS[t.meal].en })),
              { to: keep({}), n: done, label: `of ${rows.length} reached their number` },
            ]}
          />
          {rows.length === 0 ? (
            <p className="muted">Nobody to show.</p>
          ) : (
            <div className="table-wrap">
              <table className="table-oneline meal-table">
                <thead>
                  <tr>
                    <th>Student ID</th><th>Name</th><th className="num">A day</th>
                    {fast.meals.map((m) => <th key={m} className="meal-col" lang={lang}>{MEAL_LABELS[m][lang]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.memberId}>
                      <td>{r.studentId}</td>
                      <td><strong>{r.fullName}</strong></td>
                      <td className="num muted">{MEALS_PER_DAY[r.fastType]}</td>
                      {fast.meals.map((m) => {
                        const v = r.meals[m] === true;
                        const full = !v && r.eatenToday >= MEALS_PER_DAY[r.fastType];
                        return (
                          <td key={m} className="meal-col">
                            <Form method="post" preventScrollReset>
                              <input type="hidden" name="intent" value={v ? "unmark" : "mark"} />
                              <input type="hidden" name="memberId" value={r.memberId} />
                              <input type="hidden" name="meal" value={m} />
                              <input type="hidden" name="day" value={day} />
                              <button
                                className={`meal-cell${v ? " is-eaten" : ""}${full ? " is-full" : ""}`}
                                disabled={busy || full}
                                title={full ? "Used today's limit" : undefined}
                                aria-label={`${r.fullName} ${MEAL_LABELS[m].en}: ${v ? "ate (tap to undo)" : full ? "used today's limit" : "not yet (tap to mark)"}`}
                              >
                                {v ? "✓" : full ? "–" : ""}
                              </button>
                            </Form>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {canManage && (
        <div className="card roles-card">
          <h2>Scanners <small className="muted">— up to {MAX_SCANNERS} members who open the cafe scanner for this fast</small></h2>
          <div className="assign-row">
            <div className="assign-what">
              {scanners.length ? (
                scanners.map((sc) => (
                  <span key={sc.memberId} className="assign-holder">
                    {sc.fullName}
                    <Form method="post" preventScrollReset>
                      <input type="hidden" name="intent" value="remove-scanner" />
                      <input type="hidden" name="memberId" value={sc.memberId} />
                      <button className="link-btn" disabled={busy} aria-label={`Remove ${sc.fullName}`}>✕</button>
                    </Form>
                  </span>
                ))
              ) : <span className="muted">No scanners yet</span>}
            </div>
            {scanners.length < MAX_SCANNERS && (
              <Form method="post" className="assign" preventScrollReset>
                <input type="hidden" name="intent" value="add-scanner" />
                <select name="memberId" required defaultValue="" aria-label="Choose a member">
                  <option value="" disabled>Choose a member…</option>
                  {activeMembers.filter((m) => !scanners.some((sc) => sc.memberId === m.memberId)).map((m) => (
                    <option key={m.memberId} value={m.memberId}>{m.fullName} · {m.studentId}</option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" disabled={busy}>Add</button>
              </Form>
            )}
          </div>
        </div>
      )}

      {canManage && (
        <Form
          method="post"
          className="danger-zone"
          onSubmit={(e) => {
            if (!window.confirm("Delete this fast, its registrations and meal records?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <button className="btn btn-quiet btn-sm" disabled={busy}>Delete fast</button>
        </Form>
      )}
    </section>
  );
}
