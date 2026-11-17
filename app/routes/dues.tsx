import { and, eq } from "drizzle-orm";
import { Form, Link, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/dues";
import type { loader as rootLoader } from "../root";
import { Chips, PageHead, TabBar, Tile, Tiles } from "../components/Dash";
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

const TABS = ["review", "month", "settings"] as const;

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
  const tab = pickParam(params.get("tab"), TABS) ?? (pending.length ? "review" : "month");
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

  return (
    <section className="page wide">
      <PageHead back={{ to: "/dashboard", label: "Dashboard" }} title="Monthly contributions" sub={<span lang={lang}>{formatMonth(month, lang)}</span>} />
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}

      <Tiles>
        <Tile to={keep({ tab: "review" })} n={pending.length} label="To review" tone={pending.length ? "gold" : "slate"} />
        <Tile to={keep({ tab: "month", status: "approved" })} n={statusCounts.approved} label="Paid" tone="green" />
        <Tile to={keep({ tab: "month", status: "pending" })} n={statusCounts.pending} label="Waiting review" tone="slate" />
        <Tile to={keep({ tab: "month", status: "unpaid" })} n={statusCounts.unpaid} label="Not paid" tone={statusCounts.unpaid ? "red" : "slate"} />
        <Tile to={keep({ tab: "month", status: null })} n={`${collected.toLocaleString("en-US")} birr`} label="Collected" tone="green" />
      </Tiles>

      <TabBar
        active={tab}
        tabs={[
          { key: "review", to: keep({ tab: "review" }), label: "To review", icon: "🧾", count: pending.length, alert: true },
          { key: "month", to: keep({ tab: "month" }), label: "Who paid", icon: "📅" },
          { key: "settings", to: keep({ tab: "settings" }), label: "Amounts & account", icon: "⚙️" },
        ]}
      />

      {tab === "review" && (
        pending.length === 0 ? (
          <div className="card"><p className="muted">No payments waiting. Members submit them from their dashboard.</p></div>
        ) : (
          <div className="review-list">
            {pending.map((p) => {
              const expected = p.monthlyRate * p.months.length;
              return (
                <div key={p.id} className="card review-item">
                  <a href={`/receipts/${p.id}`} target="_blank" rel="noreferrer" className="receipt-thumb">
                    <img src={`/receipts/${p.id}`}  alt={`Receipt from ${p.fullName}`} />
                  </a>
                  <div className="review-body">
                    <p><strong>{p.fullName}</strong> <span className="muted">{p.studentId} · {p.memberKind === "graduate" ? "Graduated" : "Student"}</span></p>
                    <p lang={lang}>{p.months.map(([y, m]) => formatMonth({ year: y, month: m }, lang)).join(", ")}</p>
                    <p>
                      <strong>{p.amount} birr</strong>{" "}
                      {p.amount !== expected && <span className="pill pill-pending">expected {expected}</span>}
                    </p>
                    {p.note && <p className="row-note">“{p.note}”</p>}
                    <Form method="post" className="row-actions review-actions">
                      <input type="hidden" name="id" value={p.id} />
                      <input name="reviewNote" placeholder="Note (optional, sent if rejected)" maxLength={300} />
                      <button name="intent" value="approve" className="btn btn-primary btn-sm" disabled={busy}>Approve</button>
                      <button name="intent" value="reject" className="btn btn-quiet btn-sm" disabled={busy}>Reject</button>
                    </Form>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === "month" && (
        <>
          <div className="day-nav">
            <Link to={keep({ month: mk(prev) })} className="btn btn-quiet btn-sm" preventScrollReset>← Prev</Link>
            <div className="day-nav-label">
              <strong lang={lang}>{formatMonth(month, lang)}</strong>
              {monthKey(month) === monthKey(current) && <span className="muted">this month</span>}
            </div>
            {next ? <Link to={keep({ month: mk(next) })} className="btn btn-quiet btn-sm" preventScrollReset>Next →</Link> : <span className="btn btn-quiet btn-sm" aria-disabled="true">Next →</span>}
          </div>
          <div className="card filter-card">
            <div className="filter-top">
              <Form method="get" className="list-tools" role="search">
                {[...params.entries()].filter(([k]) => k !== "q").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <input type="search" name="q" defaultValue={q} placeholder="Search name, ID, phone" aria-label="Search" />
                <button className="btn btn-quiet btn-sm" aria-label="Search">🔍</button>
              </Form>
            </div>
            <Chips label="Status" param="status" value={status} counts={statusCounts} options={[["approved", "Paid"], ["pending", "Waiting review"], ["unpaid", "Not paid"]]} />
            <Chips label="Member" param="kind" value={kind} counts={kindCounts} options={[["student", `Students · ${dues.student} birr`], ["graduate", `Graduated · ${dues.graduate} birr`]]} />
          </div>
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Name</th><th>Student ID</th><th>Member</th><th>Phone</th><th>Telegram</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.fullName}</strong></td>
                    <td>{r.studentId}</td>
                    <td>{r.kind === "graduate" ? "Graduated" : "Student"}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : "—"}</td>
                    <td>{r.telegramUsername ? <a href={`https://t.me/${r.telegramUsername}`} target="_blank" rel="noreferrer">@{r.telegramUsername}</a> : "—"}</td>
                    <td><span className={`pill pill-pay-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "settings" && (
        <div className="card">
          <Form method="post" className="form">
            <input type="hidden" name="intent" value="settings" />
            <h2>Monthly amount (birr)</h2>
            <div className="date-pair">
              <label className="field"><span>Students</span><input name="student" type="number" min={0} max={10000} required defaultValue={dues.student} /></label>
              <label className="field"><span>Graduated</span><input name="graduate" type="number" min={0} max={10000} required defaultValue={dues.graduate} /></label>
            </div>
            <h2>Fellowship account</h2>
            <p className="muted">Members see this on their dashboard when they pay.</p>
            <div className="date-pair">
              <label className="field"><span>Bank / service</span><input name="bank" maxLength={60} defaultValue={account.bank} placeholder="CBE / Telebirr" /></label>
              <label className="field"><span>Account number</span><input name="number" maxLength={40} defaultValue={account.number} /></label>
            </div>
            <label className="field"><span>Account name</span><input name="name" maxLength={80} defaultValue={account.name} /></label>
            <label className="field"><span>Note <small>Optional</small></span><input name="note" maxLength={200} defaultValue={account.note} placeholder="e.g. write your student ID in the reason" /></label>
            <button className="btn btn-primary" disabled={busy}>Save</button>
          </Form>
        </div>
      )}
    </section>
  );
}
