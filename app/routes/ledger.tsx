import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Form, Link, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/ledger";
import type { loader as rootLoader } from "../root";
import { EcDatePicker } from "../components/EcDatePicker";
import { getDb, schema } from "../db";
import { requireDues } from "../lib/access.server";
import { addMonths, dueMonth, formatMonth, type EcMonth } from "../lib/contributions";
import { todayInAddis } from "../lib/departments";
import { daysInEcMonth, ecToIso, formatEc, isoToEc } from "../lib/ethiopian-date";
import { DEFAULT_LANG } from "../lib/lang";

export function meta() {
  return [{ title: "Money in & out · Gibi Gubae" }];
}

function parseMonth(v: string | null, fallback: EcMonth): EcMonth {
  const m = v?.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : fallback;
}

/** First and last Gregorian day of an EC month (ነሐሴ includes ጳጉሜን). */
function monthRange(m: EcMonth) {
  const last = m.month === 12 ? { year: m.year, month: 13, day: daysInEcMonth(m.year, 13) } : { year: m.year, month: m.month, day: 30 };
  return { from: ecToIso({ year: m.year, month: m.month, day: 1 }), to: ecToIso(last) };
}

/** The ledger: every birr in (approved contributions and gifts) and out (recorded by ሂሳብ እና ንብረት). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { approveMoney } = await requireDues(request, env, db);
  const today = todayInAddis();
  const month = parseMonth(new URL(request.url).searchParams.get("month"), dueMonth(today));
  const { from, to } = monthRange(month);
  const [rows, [all]] = await Promise.all([
    db.select().from(schema.ledger).where(and(gte(schema.ledger.date, from), lte(schema.ledger.date, to))).orderBy(desc(schema.ledger.date), desc(schema.ledger.createdAt)),
    db
      .select({
        totalIn: sql<number>`coalesce(sum(case when ${schema.ledger.direction} = 'in' then ${schema.ledger.amount} end), 0)`,
        totalOut: sql<number>`coalesce(sum(case when ${schema.ledger.direction} = 'out' then ${schema.ledger.amount} end), 0)`,
      })
      .from(schema.ledger),
  ]);
  return {
    month,
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
    today,
    rows: rows.map((r) => ({ id: r.id, direction: r.direction, amount: r.amount, category: r.category, description: r.description, date: r.date, person: r.person })),
    balance: all.totalIn - all.totalOut,
    canEdit: approveMoney,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, approveMoney } = await requireDues(request, env, db);
  if (!approveMoney) return { message: "Only ሂሳብ እና ንብረት records money." };
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    // Only entries typed in by hand; approved payments and gifts stay
    await db.delete(schema.ledger).where(and(eq(schema.ledger.id, String(form.get("id"))), sql`${schema.ledger.refId} is null`));
    return { message: "Entry removed." };
  }
  const direction = form.get("direction") === "in" ? "in" : "out";
  const amount = Number(form.get("amount"));
  const description = String(form.get("description") ?? "").trim().slice(0, 200);
  const date = String(form.get("date") ?? "");
  const person = String(form.get("person") ?? "").trim().slice(0, 80) || null;
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) return { message: "Enter the amount in whole birr." };
  if (description.length < 2) return { message: "Write what the money was for." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { message: "Choose the date." };
  await db.insert(schema.ledger).values({ direction, amount, category: direction === "out" ? "expense" : "other", description, date, person, recordedBy: user.id });
  return { message: "Saved." };
}

const CATEGORY = { contribution: "Monthly contribution", donation: "ለመርዳት", expense: "Expense", other: "Other income" } as const;

export default function Ledger({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const { month, prev, next, today, rows, balance, canEdit } = loaderData;
  const mIn = rows.filter((r) => r.direction === "in").reduce((n, r) => n + r.amount, 0);
  const mOut = rows.filter((r) => r.direction === "out").reduce((n, r) => n + r.amount, 0);
  const mk = (m: EcMonth) => {
    const p = new URLSearchParams(params);
    p.set("month", `${m.year}-${m.month}`);
    return `?${p.toString()}`;
  };
  const birr = (n: number) => n.toLocaleString("en-US");

  return (
    <section className="page wide">
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}
      <div className="card dues-head">
        <div className="dues-month">
          <Link to={mk(prev)} className="btn btn-quiet btn-sm" aria-label="Previous month" preventScrollReset>←</Link>
          <div>
            <strong lang={lang}>{formatMonth(month, lang)}</strong>
            <div className="money-sum">
              <span className="money-in">In {birr(mIn)}</span> · <span className="money-out">Out {birr(mOut)}</span>
            </div>
          </div>
          <Link to={mk(next)} className="btn btn-quiet btn-sm" aria-label="Next month" preventScrollReset>→</Link>
        </div>
        <p className="money-balance">Balance (all time): <b>{birr(balance)} birr</b></p>
      </div>

      {canEdit && (
        <details className="card add-panel">
          <summary>＋ Record money in or out</summary>
          <Form method="post" className="form">
            <div className="segmented" role="radiogroup" aria-label="Direction">
              <label className="seg seg-absent"><input type="radio" name="direction" value="out" defaultChecked /> <span>Money out</span></label>
              <label className="seg seg-present"><input type="radio" name="direction" value="in" /> <span>Money in</span></label>
            </div>
            <label className="field"><span>Amount (birr)</span><input name="amount" type="number" inputMode="numeric" min={1} required /></label>
            <label className="field"><span>For</span><input name="description" required maxLength={200} placeholder="e.g. candles for the fast" /></label>
            <label className="field"><span>Paid to / received from <small>Optional</small></span><input name="person" maxLength={80} /></label>
            <EcDatePicker name="date" label="Date" lang={lang} defaultIso={today} minYear={isoToEc(today).year - 1} maxYear={isoToEc(today).year} />
            <button className="btn btn-primary btn-sm" disabled={busy}>Save</button>
          </Form>
        </details>
      )}

      <div className="card table-card">
        <div className="table-bar">
          <strong>{rows.length} entr{rows.length === 1 ? "y" : "ies"}</strong>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>🖨️ Print</button>
        </div>
        {rows.length === 0 ? (
          <p className="muted table-empty">Nothing recorded this month.</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Date</th><th>For</th><th className="num">In</th><th className="num">Out</th>{canEdit && <th><span className="visually-hidden">Actions</span></th>}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td lang={lang}>{formatEc(r.date, lang)}</td>
                    <td className="wrap">
                      <strong>{r.description}</strong>
                      <span className="who-id">{CATEGORY[r.category]}{r.person ? ` · ${r.person}` : ""}</span>
                    </td>
                    <td className="num money-in">{r.direction === "in" ? birr(r.amount) : ""}</td>
                    <td className="num money-out">{r.direction === "out" ? birr(r.amount) : ""}</td>
                    {canEdit && (
                      <td>
                        {(r.category === "expense" || r.category === "other") && (
                          <Form method="post" preventScrollReset onSubmit={(e) => { if (!window.confirm("Remove this entry?")) e.preventDefault(); }}>
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={r.id} />
                            <button className="link-btn" disabled={busy} aria-label="Remove">✕</button>
                          </Form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
