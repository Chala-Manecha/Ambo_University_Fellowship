import { and, desc, eq } from "drizzle-orm";
import { Form, useNavigation, useRouteLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/donations";
import type { loader as rootLoader } from "../root";
import { Counts } from "../components/Panel";
import { getDb, schema } from "../db";
import { requireDues } from "../lib/access.server";
import { sendMessage } from "../lib/bot.server";
import { matchesSearch, pickParam } from "../lib/dashboard";
import { todayInAddis } from "../lib/departments";
import { formatEc } from "../lib/ethiopian-date";
import { DEFAULT_LANG } from "../lib/lang";
import { ledgerIn } from "../lib/ledger.server";

export function meta() {
  return [{ title: "Gifts · Gibi Gubae" }];
}

/** ለመርዳት gifts. ሂሳብ እና ንብረት (and admins) approve; ባች እና ዲፓርትመንት and ኦዲት see them. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = getDb(env.DB);
  const { approveMoney } = await requireDues(request, env, db);
  const rows = await db
    .select({
      id: schema.donations.id,
      donorName: schema.donations.donorName,
      studentId: schema.members.studentId,
      amount: schema.donations.amount,
      note: schema.donations.note,
      status: schema.donations.status,
      reviewNote: schema.donations.reviewNote,
      createdAt: schema.donations.createdAt,
    })
    .from(schema.donations)
    .leftJoin(schema.members, eq(schema.members.id, schema.donations.memberId))
    .orderBy(desc(schema.donations.createdAt))
    .limit(500);
  return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })), canApprove: approveMoney };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = context.cloudflare;
  const db = getDb(env.DB);
  const { user, approveMoney } = await requireDues(request, env, db);
  if (!approveMoney) return { message: "Only ሂሳብ እና ንብረት approves gifts." };
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "approve" && intent !== "reject") throw new Response("Unknown action", { status: 400 });
  const id = String(form.get("id") ?? "");
  const g = await db.query.donations.findFirst({ where: eq(schema.donations.id, id) });
  if (!g) throw new Response("Not found", { status: 404 });
  if (g.status !== "pending") return { message: "This gift was already reviewed." };
  const next = intent === "approve" ? ("approved" as const) : ("rejected" as const);
  const note = String(form.get("reviewNote") ?? "").trim().slice(0, 300) || null;
  const update = db
    .update(schema.donations)
    .set({ status: next, reviewNote: note, reviewedBy: user.id, reviewedAt: new Date() })
    .where(and(eq(schema.donations.id, id), eq(schema.donations.status, "pending")));
  if (next === "approved") {
    await db.batch([
      update,
      ledgerIn(db, { amount: g.amount, category: "donation", description: g.note ? `ለመርዳት · ${g.note}` : "ለመርዳት", date: todayInAddis(), person: g.donorName, refId: id, by: user.id }),
    ]);
  } else {
    await update;
  }
  // Tell the giver
  if (g.memberId) {
    const m = await db
      .select({ telegramId: schema.user.telegramId, lang: schema.members.contentLanguage })
      .from(schema.members)
      .innerJoin(schema.user, eq(schema.user.id, schema.members.userId))
      .where(eq(schema.members.id, g.memberId))
      .get();
    if (m?.telegramId) {
      const text =
        next === "approved"
          ? m.lang === "am" ? `የ${g.amount} ብር ስጦታዎ ደርሷል። እግዚአብሔር ይስጥልን!` : `Kennaan keessan birrii ${g.amount} nu ga'eera. Waaqayyo isin haa eebbisu!`
          : m.lang === "am" ? `የ${g.amount} ብር ስጦታዎ አልተረጋገጠም።${note ? ` ምክንያት፦ ${note}` : ""}` : `Kennaan keessan birrii ${g.amount} hin mirkanoofne.${note ? ` Sababa: ${note}` : ""}`;
      ctx.waitUntil(sendMessage(env, m.telegramId, text));
    }
  }
  return { message: next === "approved" ? "Gift approved and added to the ledger." : "Gift rejected." };
}

const STATUS = { pending: "Waiting review", approved: "Approved", rejected: "Rejected" } as const;

export default function Gifts({ loaderData, actionData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const lang = root?.lang ?? DEFAULT_LANG;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const { rows, canApprove } = loaderData;
  const q = params.get("q") ?? "";
  const status = pickParam(params.get("status"), ["pending", "approved", "rejected"] as const);
  const searched = rows.filter((r) => matchesSearch(q, [r.donorName, r.studentId]));
  const shown = searched.filter((r) => !status || r.status === status);
  const total = searched.filter((r) => r.status === "approved").reduce((n, r) => n + r.amount, 0);
  const href = (v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set("status", v);
    else p.delete("status");
    return `?${p.toString()}`;
  };
  const day = (ms: number) => formatEc(new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10), lang);

  return (
    <section className="page wide">
      {actionData?.message && <p className="notice" role="status">{actionData.message}</p>}
      <Counts
        items={[
          { to: href(null), n: searched.length, label: "All", active: !status },
          { to: href("pending"), n: searched.filter((r) => r.status === "pending").length, label: "Waiting review", active: status === "pending", alert: true },
          { to: href("approved"), n: total, label: "birr received", active: status === "approved" },
        ]}
      />
      <Form method="get" className="card filter-bar" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <input type="search" name="q" defaultValue={q} placeholder="🔍 Name or student ID" aria-label="Search" className="filter-q" />
      </Form>
      <div className="card table-card">
        <div className="table-bar"><strong>{shown.length} gift{shown.length === 1 ? "" : "s"}</strong></div>
        {shown.length === 0 ? (
          <p className="muted table-empty">No gifts here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table-oneline">
              <thead><tr><th>Date</th><th>From</th><th className="num">Birr</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td lang={lang}>{day(r.createdAt)}</td>
                    <td><strong>{r.donorName}</strong>{r.studentId && <span className="who-id">{r.studentId}</span>}{r.note && <span className="muted"> · {r.note}</span>}</td>
                    <td className="num"><strong>{r.amount}</strong></td>
                    <td><span className={`pill pill-pay-${r.status === "approved" ? "approved" : r.status === "pending" ? "pending" : "unpaid"}`}>{STATUS[r.status]}</span></td>
                    <td>
                      <span className="pay-cell">
                        <a href={`/donations/${r.id}/receipt`} target="_blank" rel="noreferrer">🧾 View</a>
                        {r.status === "pending" && canApprove && (
                          <Form method="post" className="row-actions" preventScrollReset>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="reviewNote" defaultValue="" />
                            <button name="intent" value="approve" className="btn btn-primary btn-sm" disabled={busy}>Approve</button>
                            <button
                              name="intent"
                              value="reject"
                              className="btn btn-quiet btn-sm"
                              disabled={busy}
                              onClick={(e) => {
                                const note = window.prompt("Reason (sent to the giver, optional):");
                                if (note === null) return e.preventDefault();
                                const input = e.currentTarget.form?.elements.namedItem("reviewNote") as HTMLInputElement | null;
                                if (input) input.value = note;
                              }}
                            >
                              Reject
                            </button>
                          </Form>
                        )}
                      </span>
                    </td>
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
