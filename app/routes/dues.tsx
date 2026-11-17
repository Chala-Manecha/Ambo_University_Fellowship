import { and, eq } from "drizzle-orm";
import { Form, Link, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/dues";
import type { loader as rootLoader } from "../root";
import { getDb, schema } from "../db";
import { requireDues } from "../lib/access.server";
import {
  accountSchema,
  addMonths,
  dueMonth,
  duesSchema,
  formatMonth,
  monthKey,
  reviewContributionTransition,
  type EcMonth,
} from "../lib/contributions";
import { monthPayRows, pendingContributions } from "../lib/contributions.server";
import { sendMessage } from "../lib/bot.server";
import { countBy, matchesSearch, pickParam } from "../lib/dashboard";
import { todayInAddis } from "../lib/departments";
import { DEFAULT_LANG } from "../lib/lang";
import { getDues, getPayAccount, setSetting } from "../lib/settings.server";

export function meta() {
  return [{ title: "Contributions · Gibi Gubae" }];
}

function parseMonth(v: string | null, fallback: EcMonth): EcMonth {
  const m = v?.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : fallback;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  await requireDues(request, env, db);
  const current = dueMonth(todayInAddis());
  const month = parseMonth(new URL(request.url).searchParams.get("month"), current);
  const [pending, pay, dues, account] = await Promise.all([pendingContributions(db), monthPayRows(db, month), getDues(db), getPayAccount(db)]);
  return {
    month,
    current,
    prev: addMonths(month, -1),
    next: monthKey(month) < monthKey(current) + 3 ? addMonths(month, 1) : null,
    pending: pending.map((p) => ({ ...p, createdAt: p.createdAt.getTime() })),
    rows: pay.rows,
    collected: pay.collected,
    dues,
    account,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const db = getDb(env.DB);
  const { user } = await requireDues(request, env, db);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "settings") {
    const dues = duesSchema.safeParse({ student: form.get("student"), graduate: form.get("graduate") });
    const account = accountSchema.safeParse({ bank: form.get("bank"), number: form.get("number"), name: form.get("name"), note: form.get("note") });
    if (!dues.success || !account.success) return { message: "Check the amounts (whole birr) and account details." };
    await setSetting(db, "dues", dues.data, user.id);
    await setSetting(db, "pay_account", account.data, user.id);
    return { message: "Saved. Members see the new amounts and account on their dashboard." };
  }

  if (intent === "approve" || intent === "reject") {
    const id = String(form.get("id") ?? "");
    const c = await db.query.contributions.findFirst({ where: eq(schema.contributions.id, id), columns: { status: true, memberId: true, months: true, amount: true } });
    if (!c) throw new Response("Not found", { status: 404 });
    const next = reviewContributionTransition(c.status, intent);
    if (!next) return { message: "This payment was already reviewed." };
    const note = String(form.get("reviewNote") ?? "").trim().slice(0, 300) || null;
    const statements = [
      db
        .update(schema.contributions)
        .set({ status: next, reviewNote: note, reviewedBy: user.id, reviewedAt: new Date() })
        .where(and(eq(schema.contributions.id, id), eq(schema.contributions.status, "pending"))),
    ];
    // A rejected payment frees its months so the member can submit again
    if (next === "rejected") statements.push(db.delete(schema.contributionMonths).where(eq(schema.contributionMonths.contributionId, id)) as never);
    await db.batch(statements as [(typeof statements)[number], ...typeof statements]);

    const m = await db
      .select({ telegramId: schema.user.telegramId, lang: schema.members.contentLanguage })
      .from(schema.members)
      .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
      .where(eq(schema.members.id, c.memberId))
      .get();
    if (m?.telegramId) {
      const months = c.months.map(([y, mo]) => formatMonth({ year: y, month: mo }, m.lang)).join(", ");
      const text =
        next === "approved"
          ? m.lang === "am" ? `የ${c.amount} ብር ክፍያዎ (${months}) ጸድቋል። እናመሰግናለን!` : `Kaffaltiin keessan birrii ${c.amount} (${months}) mirkanaa'eera. Galatoomaa!`
          : m.lang === "am" ? `የ${c.amount} ብር ክፍያዎ (${months}) አልጸደቀም።${note ? ` ምክንያት፦ ${note}` : ""} እባክዎ እንደገና ያስገቡ።` : `Kaffaltiin keessan birrii ${c.amount} (${months}) hin mirkanoofne.${note ? ` Sababa: ${note}` : ""} Irra deebi'aa galchaa.`;
      ctx.waitUntil(sendMessage(env, m.telegramId, text));
    }
    return { message: next === "approved" ? "Payment approved." : "Payment rejected; the member can submit again." };
  }
  throw new Response("Unknown action", { status: 400 });
}

const STATUS_LABEL = { approved: "Paid", pending: "Waiting review", unpaid: "Not paid" } as const;

export default function Dues({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const { month, current, prev, next, pending, rows, collected, dues, account } = loaderData;
  const status = pickParam(params.get("status"), ["approved", "pending", "unpaid"] as const);
  const kind = pickParam(params.get("kind"), ["student", "graduate"] as const);
  const q = params.get("q") ?? "";
  const searched = rows.filter((r) => matchesSearch(q, [r.fullName, r.studentId, r.phone, r.telegramUsername]));
  const statusCounts = countBy(searched.filter((r) => !kind || r.kind === kind), ["approved", "pending", "unpaid"] as const, (r) => r.status);
  const kindCounts = countBy(searched.filter((r) => !status || r.status === status), ["student", "graduate"] as const, (r) => r.kind);
  const shown = searched.filter((r) => (!status || r.status === status) && (!kind || r.kind === kind));
  const mk = (m: EcMonth) => `${m.year}-${m.month}`;
  const keep = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(extra)) (v === null ? p.delete(k) : p.set(k, v));
    return `?${p.toString()}`;
  };
  // Payments waiting in other months: a link to the first one
  const waitingElsewhere = pending.filter((p) => !p.months.some(([y, m]) => y === month.year && m === month.month));
  const firstOther = waitingElsewhere[0]?.months[0];
  const submitOnChange = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();

  return (
    <section className="page wide">
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <div className="card dues-head">
        <div className="dues-month">
          <Link to={keep({ month: mk(prev) })} className="btn btn-quiet btn-sm" aria-label="Previous month" preventScrollReset>←</Link>
          <div>
            <strong lang={lang}>{formatMonth(month, lang)}</strong>
            {monthKey(month) === monthKey(current) && <span className="muted"> · this month</span>}
            <div className="dues-collected">Collected <b>{collected.toLocaleString("en-US")} birr</b></div>
          </div>
          {next ? <Link to={keep({ month: mk(next) })} className="btn btn-quiet btn-sm" aria-label="Next month" preventScrollReset>→</Link> : <span className="btn btn-quiet btn-sm" aria-disabled="true">→</span>}
        </div>
        <details className="dues-settings">
          <summary>
            Students <b>{dues.student} birr</b> · Graduated <b>{dues.graduate} birr</b> · {account.number ? <>{account.bank} <b>{account.number}</b> ({account.name})</> : <span className="pill pill-pay-unpaid">No account set</span>} <span className="dues-edit">✏️ Edit</span>
          </summary>
          <Form method="post" className="form">
            <input type="hidden" name="intent" value="settings" />
            <div className="date-pair">
              <label className="field"><span>Students (birr / month)</span><input name="student" type="number" min={0} max={10000} required defaultValue={dues.student} /></label>
              <label className="field"><span>Graduated (birr / month)</span><input name="graduate" type="number" min={0} max={10000} required defaultValue={dues.graduate} /></label>
            </div>
            <div className="date-pair">
              <label className="field"><span>Bank / service</span><input name="bank" maxLength={60} defaultValue={account.bank} placeholder="CBE / Telebirr" /></label>
              <label className="field"><span>Account number</span><input name="number" maxLength={40} defaultValue={account.number} /></label>
            </div>
            <label className="field"><span>Account name</span><input name="name" maxLength={80} defaultValue={account.name} /></label>
            <label className="field"><span>Note <small>Optional</small></span><input name="note" maxLength={200} defaultValue={account.note} placeholder="e.g. write your student ID in the reason" /></label>
            <button className="btn btn-primary btn-sm" disabled={busy}>Save</button>
          </Form>
        </details>
      </div>

      {firstOther && (
        <p className="notice">
          {waitingElsewhere.length} payment{waitingElsewhere.length === 1 ? "" : "s"} waiting for review in other months.{" "}
          <Link to={keep({ month: `${firstOther[0]}-${firstOther[1]}`, status: "pending" })}>Show</Link>
        </p>
      )}

      <Form method="get" className="card filter-bar" role="search">
        <input type="hidden" name="month" value={mk(month)} />
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Name, ID, phone" aria-label="Search" className="filter-q" />
        <select name="status" defaultValue={status ?? ""} onChange={submitOnChange} aria-label="Status">
          <option value="">All ({statusCounts.all})</option>
          <option value="approved">Paid ({statusCounts.approved})</option>
          <option value="pending">Waiting review ({statusCounts.pending})</option>
          <option value="unpaid">Not paid ({statusCounts.unpaid})</option>
        </select>
        <select name="kind" defaultValue={kind ?? ""} onChange={submitOnChange} aria-label="Member">
          <option value="">Everyone ({kindCounts.all})</option>
          <option value="student">Students ({kindCounts.student})</option>
          <option value="graduate">Graduated ({kindCounts.graduate})</option>
        </select>
        <button className="btn btn-primary btn-sm">Filter</button>
      </Form>

      <div className="card table-card">
        <div className="table-bar"><strong>{shown.length} {shown.length === 1 ? "member" : "members"}</strong></div>
        {shown.length === 0 ? (
          <p className="muted table-empty">Nobody matches.</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Member</th><th>Status</th><th>Payment</th><th>Phone</th><th>Telegram</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong><span className="who-id">{r.studentId} · {r.kind === "graduate" ? "Graduated" : "Student"}</span></td>
                    <td><span className={`pill pill-pay-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td>
                      {r.payment ? (
                        <span className="pay-cell">
                          <a href={`/receipts/${r.payment.id}`} target="_blank" rel="noreferrer">🧾 {r.payment.amount} birr</a>
                          {r.payment.months.length > 1 && <span className="muted" lang={lang}> · {r.payment.months.length} months</span>}
                          {r.status === "pending" && (
                            <Form method="post" className="row-actions" preventScrollReset>
                              <input type="hidden" name="id" value={r.payment.id} />
                              <button name="intent" value="approve" className="btn btn-primary btn-sm" disabled={busy}>Approve</button>
                              <button
                                name="intent"
                                value="reject"
                                className="btn btn-quiet btn-sm"
                                disabled={busy}
                                onClick={(e) => {
                                  const note = window.prompt("Reason (sent to the member, optional):");
                                  if (note === null) return e.preventDefault();
                                  const input = e.currentTarget.form?.elements.namedItem("reviewNote") as HTMLInputElement | null;
                                  if (input) input.value = note;
                                }}
                              >
                                Reject
                              </button>
                              <input type="hidden" name="reviewNote" defaultValue="" />
                            </Form>
                          )}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : "—"}</td>
                    <td>{r.telegramUsername ? <a href={`https://t.me/${r.telegramUsername}`} target="_blank" rel="noreferrer">@{r.telegramUsername}</a> : "—"}</td>
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
